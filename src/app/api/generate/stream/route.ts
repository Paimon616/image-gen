import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import {
  COMFYUI_BASE_URL,
  cancelComfyPrompt,
  fetchComfyImages,
  queueComfyPrompt,
  waitForComfyImageRefs,
  type ComfyGeneratedImage,
} from "@/lib/comfyui";
import {
  getModelConfig,
  normalizeGenerationSeed,
  normalizeImageDimension,
} from "@/lib/types";
import type { CivitaiOrigin, GenerationParams } from "@/lib/types";
import { imageUrl, OUTPUT_DIR, thumbnailUrl } from "@/lib/server-images";
import { buildGenerationResources } from "@/lib/generation-resource-links";
import { generateWithA1111, interruptA1111 } from "@/lib/a1111";

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
  civitaiOrigin,
}: {
  images: ComfyGeneratedImage[];
  params: GenerationParams;
  endpoint: string;
  civitaiOrigin?: CivitaiOrigin;
}) {
  await ensureOutputDir();

  return Promise.all(
    images.map(async (img, i) => {
      const id = randomUUID();
      const filename = `${id}.${extensionForContentType(img.contentType)}`;

      await writeFile(`${OUTPUT_DIR}/${filename}`, img.buffer);
      const timestamp = Date.now();
      const resources = await buildGenerationResources(params);

      await writeFile(
        `${OUTPUT_DIR}/${id}.json`,
        JSON.stringify(
          {
            id,
            filename,
            params,
            resources,
            endpoint,
            timestamp,
            original_url: img.originalUrl,
            index: i,
            civitai_origin: civitaiOrigin,
          },
          null,
          2
        )
      );

      return {
        id,
        url: imageUrl(filename),
        thumbnailUrl: thumbnailUrl(filename),
        filename,
        params,
        timestamp,
        civitaiOrigin,
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
  const { civitaiOrigin, ...rawBody } = (await req.json()) as GenerationParams & {
    civitaiOrigin?: CivitaiOrigin;
  };
  const body: GenerationParams = {
    ...rawBody,
    width: normalizeImageDimension(rawBody.width),
    height: normalizeImageDimension(rawBody.height),
    seed: normalizeGenerationSeed(rawBody.seed),
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

    if (body.backend === "a1111" || body.backend === "forge") {
      void interruptA1111(body.backend).catch(() => {});
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
        if (body.backend === "a1111" || body.backend === "forge") {
          const webuiLabel = body.backend === "forge" ? "Forge" : "A1111";
          send("progress", { progress: 5, message: `Waiting for ${webuiLabel}...` });
          const progressBaseUrl =
            body.backend === "forge"
              ? process.env.FORGE_BASE_URL?.replace(/\/$/, "") ??
                "http://127.0.0.1:7861"
              : process.env.A1111_BASE_URL?.replace(/\/$/, "") ??
                "http://127.0.0.1:7860";
          const progressUrl =
            progressBaseUrl + "/sdapi/v1/progress?skip_current_image=true";
          const progressTimer = setInterval(async () => {
            try {
              const response = await fetch(progressUrl, {
                cache: "no-store",
                signal: AbortSignal.timeout(2_000),
              });
              if (!response.ok) return;
              const status = (await response.json()) as {
                progress?: number;
                eta_relative?: number;
                state?: { sampling_step?: number; sampling_steps?: number };
              };
              send("progress", {
                progress: Math.max(
                  1,
                  Math.min(99, Math.round((status.progress ?? 0) * 100))
                ),
                step: status.state?.sampling_step,
                total_steps: status.state?.sampling_steps,
                eta_seconds: status.eta_relative,
                message: `Generating with ${webuiLabel}...`,
              });
            } catch {
              // Backend not answering yet (still booting). ensureWebUiReady drives
              // the startup status messages, so stay quiet here to avoid conflicts.
            }
          }, 5_000);
          let images: Awaited<ReturnType<typeof generateWithA1111>>;
          try {
            images = await generateWithA1111(
              body,
              abortController.signal,
              (message) => send("progress", { progress: 4, message })
            );
          } finally {
            clearInterval(progressTimer);
          }
          const savedImages = await saveBufferedImages({
            images,
            params: body,
            endpoint: `${body.backend}/local`,
            civitaiOrigin,
          });
          send("progress", { progress: 100, message: "Done" });
          send("complete", { images: savedImages });
          return;
        }

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
        const queued = await queueComfyPrompt(body, clientId);
        promptId = queued.prompt_id;
        lastComfyActivityAt = Date.now();
        send("queued", { prompt_id: promptId });
        send("progress", { progress: 2, message: "Waiting for ComfyUI..." });

        const imageRefs = await waitForComfyImageRefs(promptId, {
          signal: abortController.signal,
          getLastActivityAt: () => lastComfyActivityAt,
        });
        const images = await fetchComfyImages(imageRefs);
        const savedImages = await saveBufferedImages({
          images,
          params: body,
          endpoint: modelConfig.id,
          civitaiOrigin,
        });

        send("progress", { progress: 100, message: "Done" });
        send("complete", { images: savedImages });
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
