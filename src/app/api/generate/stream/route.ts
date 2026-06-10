import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  COMFYUI_BASE_URL,
  fetchComfyImages,
  queueComfyPrompt,
  waitForComfyImageRefs,
  type ComfyGeneratedImage,
} from "@/lib/comfyui";
import { getModelConfig, normalizeImageDimension } from "@/lib/types";
import type { GenerationParams } from "@/lib/types";

const OUTPUT_DIR = join(process.cwd(), "output");

interface ComfyWsMessage {
  type?: string;
  data?: {
    value?: number;
    max?: number;
    prompt_id?: string;
    node?: string | null;
  };
}

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

function extensionForContentType(contentType: string) {
  return contentType === "image/png" ? "png" : "jpeg";
}

async function saveBufferedImages({
  images,
  params,
  endpoint,
}: {
  images: ComfyGeneratedImage[];
  params: GenerationParams;
  endpoint: string;
}) {
  await ensureOutputDir();

  return Promise.all(
    images.map(async (img, i) => {
      const id = randomUUID();
      const filename = `${id}.${extensionForContentType(img.contentType)}`;

      await writeFile(join(OUTPUT_DIR, filename), img.buffer);
      await writeFile(
        join(OUTPUT_DIR, `${id}.json`),
        JSON.stringify(
          {
            id,
            filename,
            params,
            endpoint,
            timestamp: Date.now(),
            original_url: img.originalUrl,
            index: i,
          },
          null,
          2
        )
      );

      return {
        id,
        url: `/api/images/${filename}`,
        filename,
        params,
        timestamp: Date.now(),
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
  const rawBody = (await req.json()) as GenerationParams;
  const body: GenerationParams = {
    ...rawBody,
    width: normalizeImageDimension(rawBody.width),
    height: normalizeImageDimension(rawBody.height),
  };
  const modelConfig = getModelConfig(body.model);

  if (
    body.generation_mode === "pose_reference" &&
    (!body.pose_reference_image || !body.pose_reference_model?.trim())
  ) {
    return Response.json(
      { error: "Pose Reference mode requires an image and a ControlNet model." },
      { status: 400 }
    );
  }

  if (body.generation_mode === "image_to_image" && !body.source_image) {
    return Response.json(
      { error: "Image to Image mode requires a source image." },
      { status: 400 }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      let ws: WebSocket | null = null;
      let promptId = "";

      const send = (event: string, data: unknown) => {
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
        const queued = await queueComfyPrompt(body, clientId);
        promptId = queued.prompt_id;
        send("progress", { progress: 2, message: "Waiting for ComfyUI..." });

        const imageRefs = await waitForComfyImageRefs(promptId);
        const images = await fetchComfyImages(imageRefs);
        const savedImages = await saveBufferedImages({
          images,
          params: body,
          endpoint: modelConfig.id,
        });

        send("progress", { progress: 100, message: "Done" });
        send("complete", { images: savedImages });
      } catch (error) {
        send("error", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        ws?.close();
        controller.close();
      }
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
