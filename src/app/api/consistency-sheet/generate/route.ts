import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  buildConsistencySheetPrompt,
  CONSISTENCY_SHEET_MAX_REFERENCES,
  type ConsistencySheetImage,
  type ConsistencySheetParams,
} from "@/lib/consistency-sheet";
import { readSettings } from "@/lib/settings";
import { isValidWorkspaceId, setFileWorkspaces } from "@/lib/workspaces";

export const runtime = "nodejs";
// A sheet render can take a few minutes; keep the function alive.
export const maxDuration = 600;

const OUTPUT_DIR = join(process.cwd(), "output", "consistency-sheet");

// Image generation on the chat-completions path, not OpenRouter's /api/v1/images
// endpoint: that one routes OpenAI models through the account's own OpenAI
// integration key, which this account's key is rejected on.
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL =
  process.env.CONSISTENCY_SHEET_MODEL?.trim() || "openai/gpt-5.4-image-2";

// Heartbeat cadence while the single long OpenRouter request is in flight, so
// the client can show progress and proxies don't kill the idle SSE stream.
const TICK_INTERVAL_MS = 3000;

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function asDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.startsWith("data:image/") ? trimmed : null;
}

function normalizeParams(raw: Record<string, unknown>): ConsistencySheetParams {
  const mode = raw.mode === "background" ? "background" : "character";

  const references = Array.isArray(raw.references)
    ? raw.references
        .map(asDataUrl)
        .filter((v): v is string => Boolean(v))
        .slice(0, CONSISTENCY_SHEET_MAX_REFERENCES)
    : [];

  return {
    mode,
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    references,
    workspaceId: isValidWorkspaceId(raw.workspaceId) ? raw.workspaceId : "",
  };
}

function openaiErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const err = (payload as { error?: { message?: string } }).error;
    if (err?.message) return err.message;
  }
  return fallback;
}

export async function POST(req: NextRequest) {
  const settings = await readSettings();
  const apiKey =
    settings.openrouterApiKey?.trim() ||
    process.env.OPENROUTER_API_KEY?.trim() ||
    "";

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
          message:
            "OpenRouter API 키가 없습니다. 설정 화면에서 OpenRouter 키를 입력하세요.",
        });
        close();
        return;
      }
      if (!params.prompt.trim() && params.references.length === 0) {
        send("error", {
          id: clientId,
          message: "프롬프트를 입력하거나 레퍼런스 이미지를 추가하세요.",
        });
        close();
        return;
      }

      send("queued", { id: clientId });

      const prompt = buildConsistencySheetPrompt(params);

      // One long request — heartbeat so the client sees liveness.
      const ticker = setInterval(() => send("tick", { id: clientId }), TICK_INTERVAL_MS);

      try {
        // Reference images ride along as image_url parts of the single user
        // message, so one call covers both the with- and without-references
        // cases.
        const res = await fetch(OPENROUTER_CHAT_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Image Gen Consistency Sheet",
          },
          body: JSON.stringify({
            model: MODEL,
            modalities: ["image", "text"],
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  ...params.references.map((url) => ({
                    type: "image_url",
                    image_url: { url },
                  })),
                ],
              },
            ],
          }),
          signal: abortSignal,
        });

        const json = (await res.json().catch(() => null)) as {
          error?: { message?: string };
          choices?: {
            message?: { images?: { image_url?: { url?: string } }[] };
          }[];
        } | null;
        // OpenRouter reports upstream provider failures in an error body that
        // can arrive with a 200, so don't gate this on res.ok.
        if (!res.ok || json?.error) {
          send("error", {
            id: clientId,
            message: openaiErrorMessage(json, `이미지 생성 실패 (HTTP ${res.status})`),
          });
          close();
          return;
        }

        // message.images[].image_url.url is a data:image/png;base64,… payload.
        const b64 = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url
          ?.split(",")
          .at(1);
        if (!b64) {
          send("error", { id: clientId, message: "응답에 이미지가 없습니다." });
          close();
          return;
        }

        send("saving", { id: clientId });

        const buffer = Buffer.from(b64, "base64");
        await mkdir(OUTPUT_DIR, { recursive: true });
        const fileId = randomUUID();
        const filename = `${fileId}.png`;
        const timestamp = Date.now();

        const image: ConsistencySheetImage = {
          id: fileId,
          url: `/api/consistency-sheet/images/${filename}`,
          filename,
          timestamp,
          contentType: "image/png",
          prompt: params.prompt,
          params: {
            mode: params.mode,
            prompt: params.prompt,
            model: MODEL,
            referenceCount: params.references.length,
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
        clearInterval(ticker);
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
