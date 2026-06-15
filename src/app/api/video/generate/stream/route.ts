import { access, mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { isAbsolute, join } from "path";
import { NextRequest } from "next/server";
import {
  COMFYUI_BASE_URL,
  cancelComfyPrompt,
  fetchComfyMedia,
  queueComfyVideoPrompt,
  waitForComfyVideoRefs,
  type ComfyGeneratedMedia,
} from "@/lib/comfyui";
import {
  DEFAULT_VIDEO_PARAMS,
  normalizeGenerationSeed,
  normalizeImageDimension,
  type VideoGenerationParams,
} from "@/lib/types";

const VIDEO_OUTPUT_DIR = join(process.cwd(), "output", "videos");

interface ComfyWsMessage {
  type?: string;
  data?: {
    value?: number;
    max?: number;
    prompt_id?: string;
  };
}

async function ensureVideoOutputDir() {
  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
}

function extensionForMedia(media: ComfyGeneratedMedia) {
  const ext = media.filename.split(".").pop()?.toLowerCase();
  if (ext && ["mp4", "webm", "gif"].includes(ext)) return ext;
  if (media.contentType === "video/webm") return "webm";
  if (media.contentType === "image/gif") return "gif";
  return "mp4";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeVideoParams(rawBody: Partial<VideoGenerationParams>) {
  const fps = Math.round(clampNumber(rawBody.fps, DEFAULT_VIDEO_PARAMS.fps, 1, 60));
  const durationSeconds = clampNumber(
    rawBody.duration_seconds,
    DEFAULT_VIDEO_PARAMS.duration_seconds,
    1,
    30
  );

  return {
    ...DEFAULT_VIDEO_PARAMS,
    ...rawBody,
    prompt: String(rawBody.prompt ?? "").trim(),
    negative_prompt: String(
      rawBody.negative_prompt ?? DEFAULT_VIDEO_PARAMS.negative_prompt
    ),
    width: normalizeImageDimension(rawBody.width),
    height: normalizeImageDimension(rawBody.height),
    fps,
    duration_seconds: durationSeconds,
    num_frames: Math.round(
      clampNumber(rawBody.num_frames, Math.round(fps * durationSeconds), 1, 240)
    ),
    num_inference_steps: Math.round(
      clampNumber(
        rawBody.num_inference_steps,
        DEFAULT_VIDEO_PARAMS.num_inference_steps,
        1,
        150
      )
    ),
    guidance_scale: clampNumber(
      rawBody.guidance_scale,
      DEFAULT_VIDEO_PARAMS.guidance_scale,
      0,
      30
    ),
    seed: normalizeGenerationSeed(rawBody.seed),
    source_image: rawBody.source_image?.trim() || null,
  } satisfies VideoGenerationParams;
}

async function assertVideoWorkflowConfigured() {
  const workflowPath = process.env.COMFYUI_VIDEO_WORKFLOW_PATH?.trim();

  if (!workflowPath) {
    throw new Error(
      "Set COMFYUI_VIDEO_WORKFLOW_PATH to a ComfyUI API workflow JSON file before generating video."
    );
  }

  const resolvedPath = isAbsolute(workflowPath)
    ? workflowPath
    : join(/*turbopackIgnore: true*/ process.cwd(), workflowPath);

  await access(resolvedPath);
}

async function saveBufferedVideos({
  videos,
  params,
}: {
  videos: ComfyGeneratedMedia[];
  params: VideoGenerationParams;
}) {
  await ensureVideoOutputDir();

  return Promise.all(
    videos.map(async (video, index) => {
      const id = randomUUID();
      const filename = `${id}.${extensionForMedia(video)}`;
      const timestamp = Date.now();

      await writeFile(join(VIDEO_OUTPUT_DIR, filename), video.buffer);
      await writeFile(
        join(VIDEO_OUTPUT_DIR, `${id}.json`),
        JSON.stringify(
          {
            id,
            filename,
            params,
            timestamp,
            original_url: video.originalUrl,
            original_filename: video.filename,
            contentType: video.contentType,
            index,
          },
          null,
          2
        )
      );

      return {
        id,
        url: `/api/videos/${filename}`,
        filename,
        params,
        timestamp,
        contentType: video.contentType,
      };
    })
  );
}

function comfyWebSocketUrl(clientId: string) {
  const url = new URL(COMFYUI_BASE_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

function openComfyWebSocket(clientId: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(comfyWebSocketUrl(clientId));
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timed out connecting to ComfyUI progress stream"));
    }, 10_000);

    ws.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve(ws);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Failed to connect to ComfyUI progress stream"));
    });
  });
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const body = normalizeVideoParams((await req.json()) as Partial<VideoGenerationParams>);

  if (!body.prompt) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }

  if (!body.source_image) {
    return Response.json(
      { error: "A start image is required for the configured Wan I2V workflow." },
      { status: 400 }
    );
  }

  try {
    await assertVideoWorkflowConfigured();
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Video workflow is not configured.",
      },
      { status: 400 }
    );
  }

  let ws: WebSocket | null = null;
  let promptId = "";
  let clientDisconnected = false;
  let lastComfyActivityAt = Date.now();
  const abortController = new AbortController();

  const abortComfyPrompt = () => {
    clientDisconnected = true;
    abortController.abort();
    ws?.close();

    if (promptId) {
      void cancelComfyPrompt(promptId).catch(() => {});
    }
  };

  req.signal.addEventListener("abort", abortComfyPrompt, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (clientDisconnected) return;
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        const clientId = randomUUID();
        ws = await openComfyWebSocket(clientId);

        ws.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;

          try {
            const message = JSON.parse(event.data) as ComfyWsMessage;
            if (message.type !== "progress") return;
            if (!promptId || message.data?.prompt_id !== promptId) return;

            lastComfyActivityAt = Date.now();
            const value = Number(message.data.value ?? 0);
            const max = Number(message.data.max ?? body.num_inference_steps);
            const progress =
              max > 0 ? Math.min(99, Math.max(1, Math.round((value / max) * 100))) : 1;

            send("progress", {
              progress,
              step: value,
              total_steps: max,
              message: `Step ${value}/${max}`,
            });
          } catch {
            // Ignore malformed websocket messages from ComfyUI extensions.
          }
        });

        send("progress", { progress: 1, message: "Queued..." });
        const queued = await queueComfyVideoPrompt(body, clientId);
        promptId = queued.prompt_id;
        lastComfyActivityAt = Date.now();
        send("queued", { prompt_id: promptId });
        send("progress", { progress: 2, message: "Waiting for ComfyUI..." });

        const videoRefs = await waitForComfyVideoRefs(promptId, {
          signal: abortController.signal,
          getLastActivityAt: () => lastComfyActivityAt,
        });
        const videos = await fetchComfyMedia(videoRefs);
        const savedVideos = await saveBufferedVideos({ videos, params: body });

        send("progress", { progress: 100, message: "Done" });
        send("complete", { videos: savedVideos });
      } catch (error) {
        if (!clientDisconnected) {
          send("error", {
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        req.signal.removeEventListener("abort", abortComfyPrompt);
        ws?.close();
        if (!clientDisconnected) {
          controller.close();
        }
      }
    },
    cancel() {
      abortComfyPrompt();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
