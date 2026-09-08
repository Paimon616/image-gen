import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  buildConsistencySheetPrompt,
  CONSISTENCY_SHEET_MAX_REFERENCES,
  CONSISTENCY_SHEET_RESOLUTIONS,
  CONSISTENCY_SHEET_SIZES,
  DEFAULT_CONSISTENCY_SHEET_PARAMS,
  type ConsistencySheetImage,
  type ConsistencySheetParams,
  type ConsistencySheetResolution,
} from "@/lib/consistency-sheet";
import { readSettings } from "@/lib/settings";

export const runtime = "nodejs";
// A 4K GPT-Image-2 render can take a few minutes; keep the function alive.
export const maxDuration = 600;

const OUTPUT_DIR = join(process.cwd(), "output", "consistency-sheet");

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const MODEL = process.env.CONSISTENCY_SHEET_MODEL?.trim() || "gpt-image-2";

// Heartbeat cadence while the single long OpenAI request is in flight, so the
// client can show progress and proxies don't kill the idle SSE stream.
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
  };
}

// data:image/jpeg;base64,… → { blob, filename } for the multipart form.
function dataUrlToBlob(dataUrl: string, index: number) {
  const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const [, mime, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return {
    blob: new Blob([new Uint8Array(bytes)], { type: mime }),
    filename: `reference-${index}.${ext}`,
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
    settings.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim() || "";

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
            "OpenAI API 키가 없습니다. 설정 화면에서 OpenAI 키를 입력하세요.",
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

      const size = CONSISTENCY_SHEET_SIZES[params.resolution];
      const prompt = buildConsistencySheetPrompt(params);

      // One long request — heartbeat so the client sees liveness.
      const ticker = setInterval(() => send("tick", { id: clientId }), TICK_INTERVAL_MS);

      try {
        let res: Response;
        if (params.references.length > 0) {
          // Reference-guided generation: images/edits with image[] parts.
          const form = new FormData();
          form.append("model", MODEL);
          form.append("prompt", prompt);
          form.append("size", size);
          form.append("n", "1");
          for (const [index, reference] of params.references.entries()) {
            const part = dataUrlToBlob(reference, index);
            if (part) form.append("image[]", part.blob, part.filename);
          }
          res = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: abortSignal,
          });
        } else {
          res = await fetch(`${OPENAI_BASE_URL}/images/generations`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: MODEL, prompt, size, n: 1 }),
            signal: abortSignal,
          });
        }

        const json = (await res.json().catch(() => null)) as {
          data?: { b64_json?: string }[];
        } | null;
        if (!res.ok) {
          send("error", {
            id: clientId,
            message: openaiErrorMessage(json, `이미지 생성 실패 (HTTP ${res.status})`),
          });
          close();
          return;
        }

        const b64 = json?.data?.[0]?.b64_json;
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
            resolution: params.resolution,
            size,
            referenceCount: params.references.length,
          },
        };

        await writeFile(join(OUTPUT_DIR, filename), buffer);
        await writeFile(
          join(OUTPUT_DIR, `${fileId}.json`),
          JSON.stringify(image, null, 2),
          "utf-8"
        );

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
