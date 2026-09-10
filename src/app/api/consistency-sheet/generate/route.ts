import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  buildConsistencySheetPrompt,
  consistencySheetReferences,
  consistencySheetSize,
  consistencySheetSizeLabel,
  CONSISTENCY_SHEET_MAX_REFERENCES,
  CONSISTENCY_SHEET_RESOLUTIONS,
  DEFAULT_CONSISTENCY_SHEET_PARAMS,
  type ConsistencySheetImage,
  type ConsistencySheetMode,
  type ConsistencySheetParams,
  type ConsistencySheetResolution,
} from "@/lib/consistency-sheet";
import { isValidWorkspaceId, setFileWorkspaces } from "@/lib/workspaces";

export const runtime = "nodejs";
// A 4K sheet with sixteen references can take a few minutes; keep the function
// alive for the whole poll loop.
export const maxDuration = 600;

const OUTPUT_DIR = join(process.cwd(), "output", "consistency-sheet");

// fal's queue API. The edit endpoint takes the reference images; without any
// reference there is nothing to edit, so the plain text-to-image endpoint runs.
const FAL_QUEUE_URL = "https://queue.fal.run";
const MODEL = process.env.CONSISTENCY_SHEET_MODEL?.trim() || "openai/gpt-image-2";
const EDIT_MODEL = `${MODEL}/edit`;

// Poll cadence for the queued request. Each poll also emits an SSE tick, so the
// client sees liveness and proxies don't kill the idle stream.
const POLL_INTERVAL_MS = 3000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function asDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.startsWith("data:image/") ? trimmed : null;
}

const MODES: ConsistencySheetMode[] = ["character", "background", "scene"];

function normalizeParams(raw: Record<string, unknown>): ConsistencySheetParams {
  const mode = MODES.includes(raw.mode as ConsistencySheetMode)
    ? (raw.mode as ConsistencySheetMode)
    : "character";
  const resolution = CONSISTENCY_SHEET_RESOLUTIONS.includes(
    raw.resolution as ConsistencySheetResolution
  )
    ? (raw.resolution as ConsistencySheetResolution)
    : DEFAULT_CONSISTENCY_SHEET_PARAMS.resolution;

  const references = Array.isArray(raw.references)
    ? raw.references
        .map(asDataUrl)
        .filter((v): v is string => Boolean(v))
        .slice(0, CONSISTENCY_SHEET_MAX_REFERENCES)
    : [];

  return {
    mode,
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    resolution,
    references,
    characterReference:
      mode === "scene" ? asDataUrl(raw.characterReference) : null,
    backgroundReference:
      mode === "scene" ? asDataUrl(raw.backgroundReference) : null,
    workspaceId: isValidWorkspaceId(raw.workspaceId) ? raw.workspaceId : "",
  };
}

// fal reports validation problems as a `detail` array (FastAPI style) and other
// failures as `{ error }` or a bare `{ detail: "…" }`.
function falErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as {
    detail?: unknown;
    error?: unknown;
    message?: unknown;
  };
  if (typeof record.detail === "string" && record.detail) return record.detail;
  if (Array.isArray(record.detail)) {
    const messages = record.detail
      .map((item) =>
        item && typeof item === "object"
          ? (item as { msg?: unknown }).msg
          : undefined
      )
      .filter((msg): msg is string => typeof msg === "string" && msg.length > 0);
    if (messages.length > 0) return messages.join(" / ");
  }
  if (typeof record.error === "string" && record.error) return record.error;
  if (typeof record.message === "string" && record.message) return record.message;
  return fallback;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

export async function POST(req: NextRequest) {
  const apiKey = process.env.FAL_KEY?.trim() || "";

  let rawBody: Record<string, unknown>;
  try {
    rawBody = (await req.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const params = normalizeParams(rawBody);
  const clientId =
    typeof rawBody.clientId === "string" ? rawBody.clientId : randomUUID();

  const encoder = new TextEncoder();
  const abortSignal = req.signal;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      if (!apiKey) {
        send("error", {
          id: clientId,
          message: "fal.ai 키가 없습니다. .env.local에 FAL_KEY를 넣으세요.",
        });
        close();
        return;
      }
      const references = consistencySheetReferences(params);
      if (!params.prompt.trim() && references.length === 0) {
        send("error", {
          id: clientId,
          message: "프롬프트를 입력하거나 레퍼런스 이미지를 추가하세요.",
        });
        close();
        return;
      }

      send("queued", { id: clientId });

      const authHeaders = {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      };
      const size = consistencySheetSize(params.mode, params.resolution);
      const endpoint = references.length > 0 ? EDIT_MODEL : MODEL;
      let cancelUrl: string | null = null;

      try {
        // The references go up as base64 data URIs — fal accepts those in place
        // of hosted URLs, which keeps the gallery pictures from needing a
        // round-trip through fal's CDN first.
        const submitRes = await fetch(`${FAL_QUEUE_URL}/${endpoint}`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            prompt: buildConsistencySheetPrompt(params),
            image_size: size,
            num_images: 1,
            output_format: "png",
            ...(references.length > 0 ? { image_urls: references } : {}),
          }),
          signal: abortSignal,
        });

        const submitJson = (await submitRes.json().catch(() => null)) as {
          status_url?: string;
          response_url?: string;
          cancel_url?: string;
        } | null;

        if (!submitRes.ok || !submitJson?.status_url) {
          send("error", {
            id: clientId,
            message: falErrorMessage(
              submitJson,
              `시트 생성 요청 실패 (HTTP ${submitRes.status})`
            ),
          });
          close();
          return;
        }

        cancelUrl = submitJson.cancel_url ?? null;

        // Poll the queue. `status_url` / `response_url` are used verbatim as
        // returned rather than rebuilt from the request id.
        let polls = 0;
        let responseUrl: string | null = null;

        while (!abortSignal.aborted) {
          const statusRes = await fetch(
            `${submitJson.status_url}?logs=0`,
            { headers: authHeaders, cache: "no-store", signal: abortSignal }
          );
          const statusJson = (await statusRes.json().catch(() => null)) as {
            status?: string;
            queue_position?: number;
            response_url?: string;
          } | null;

          if (!statusRes.ok) {
            send("error", {
              id: clientId,
              message: falErrorMessage(
                statusJson,
                `상태 조회 실패 (HTTP ${statusRes.status})`
              ),
            });
            close();
            return;
          }

          if (statusJson?.status === "COMPLETED") {
            responseUrl =
              statusJson.response_url ?? submitJson.response_url ?? null;
            break;
          }

          polls += 1;
          send("tick", {
            id: clientId,
            state: statusJson?.status ?? "IN_QUEUE",
            queuePosition: statusJson?.queue_position ?? null,
            polls,
          });

          await sleep(POLL_INTERVAL_MS, abortSignal);
        }

        if (abortSignal.aborted) {
          send("canceled", { id: clientId });
          close();
          return;
        }
        if (!responseUrl) {
          send("error", { id: clientId, message: "결과 주소를 받지 못했습니다." });
          close();
          return;
        }

        const resultRes = await fetch(responseUrl, {
          headers: authHeaders,
          cache: "no-store",
          signal: abortSignal,
        });
        const resultJson = (await resultRes.json().catch(() => null)) as {
          images?: { url?: string }[];
        } | null;

        if (!resultRes.ok) {
          send("error", {
            id: clientId,
            message: falErrorMessage(
              resultJson,
              `결과 조회 실패 (HTTP ${resultRes.status})`
            ),
          });
          close();
          return;
        }

        const imageUrl = resultJson?.images?.[0]?.url;
        if (!imageUrl) {
          send("error", { id: clientId, message: "응답에 이미지가 없습니다." });
          close();
          return;
        }

        send("saving", { id: clientId });

        // The render lands on fal's CDN, so pull the bytes down and keep the
        // sheet locally like every other output in this app.
        const fileRes = await fetch(imageUrl, { signal: abortSignal });
        if (!fileRes.ok) {
          send("error", {
            id: clientId,
            message: `이미지 다운로드 실패 (HTTP ${fileRes.status})`,
          });
          close();
          return;
        }
        const buffer = Buffer.from(await fileRes.arrayBuffer());

        await mkdir(OUTPUT_DIR, { recursive: true });
        const fileId = randomUUID();
        const filename = `${fileId}.png`;

        const image: ConsistencySheetImage = {
          id: fileId,
          url: `/api/consistency-sheet/images/${filename}`,
          filename,
          timestamp: Date.now(),
          contentType: "image/png",
          prompt: params.prompt,
          params: {
            mode: params.mode,
            prompt: params.prompt,
            resolution: params.resolution,
            size: consistencySheetSizeLabel(params.mode, params.resolution),
            model: endpoint,
            referenceCount: references.length,
          },
        };

        await writeFile(join(OUTPUT_DIR, filename), buffer);
        await writeFile(
          join(OUTPUT_DIR, `${fileId}.json`),
          JSON.stringify(image, null, 2),
          "utf-8"
        );

        // File the sheet under the chosen workspace. Membership lives in
        // workspaces.json, not the sidecar, and an id for a workspace that has
        // since been deleted is dropped there.
        if (params.workspaceId) {
          image.workspaces = await setFileWorkspaces(
            "consistencySheet",
            filename,
            [params.workspaceId]
          ).catch(() => [] as string[]);
        }

        send("complete", { id: clientId, image });
        close();
      } catch (error) {
        if (abortSignal.aborted) {
          send("canceled", { id: clientId });
        } else {
          send("error", {
            id: clientId,
            message: error instanceof Error ? error.message : "알 수 없는 오류",
          });
        }
        close();
      } finally {
        // A canceled run would otherwise keep burning credits in fal's queue.
        if (abortSignal.aborted && cancelUrl) {
          void fetch(cancelUrl, {
            method: "PUT",
            headers: { Authorization: `Key ${apiKey}` },
          }).catch(() => {});
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
