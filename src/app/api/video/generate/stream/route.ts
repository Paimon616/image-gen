import { access, mkdir, readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { isAbsolute, join } from "path";
import { NextRequest } from "next/server";
import {
  COMFYUI_BASE_URL,
  cancelComfyPrompt,
  fetchComfyMedia,
  queueComfyAudioPrompt,
  queueComfyVideoPrompt,
  waitForComfyAudioRefs,
  waitForComfyVideoRefs,
  type ComfyGeneratedMedia,
} from "@/lib/comfyui";
import {
  DEFAULT_VIDEO_PARAMS,
  normalizeGenerationSeed,
  normalizeImageDimension,
  type VideoModelPreset,
  type VideoGenerationParams,
} from "@/lib/types";
import { getRunpodPod } from "@/lib/settings";
import {
  defaultVideoPipelineId,
  resolveVideoPipeline,
  resolveVideoWorkflowPath,
} from "@/lib/video-pipelines";

const VIDEO_OUTPUT_DIR = join(process.cwd(), "output", "videos");
const AUDIO_OUTPUT_DIR = join(process.cwd(), "output", "audios");

const VIDEO_MODEL_PRESETS = new Set<VideoModelPreset>([
  "wan-smoothmix",
  "wan-base",
  "ltx-10eros",
]);

interface ComfyWsMessage {
  type?: string;
  data?: {
    value?: number;
    max?: number;
    prompt_id?: string;
    node?: string | null;
    display_node?: string | null;
  };
}

type VideoStage =
  | "queued"
  | "waiting"
  | "executing"
  | "sampling"
  | "audio"
  | "fetching"
  | "saving"
  | "complete";

const VIDEO_NODE_LABELS: Record<string, string> = {
  UNETLoader: "Loading video diffusion model",
  CLIPLoader: "Loading text encoder",
  VAELoader: "Loading VAE",
  CLIPTextEncode: "Encoding prompt",
  LoadImage: "Loading start image",
  WanImageToVideo: "Preparing image-to-video latents",
  KSampler: "Sampling",
  KSamplerAdvanced: "Sampling",
  VAEDecode: "Decoding frames",
  VAEDecodeTiled: "Decoding frames",
  CreateVideo: "Encoding video",
  SaveVideo: "Saving video",
  EmptyLatentAudio: "Preparing audio latents",
  VAEDecodeAudio: "Decoding audio",
  SaveAudio: "Saving audio",
};

async function ensureVideoOutputDir() {
  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true });
}

async function ensureAudioOutputDir() {
  await mkdir(AUDIO_OUTPUT_DIR, { recursive: true });
}

function extensionForMedia(media: ComfyGeneratedMedia) {
  const ext = media.filename.split(".").pop()?.toLowerCase();
  if (ext && ["mp4", "webm", "gif"].includes(ext)) return ext;
  if (media.contentType === "video/webm") return "webm";
  if (media.contentType === "image/gif") return "gif";
  return "mp4";
}

function extensionForAudio(media: ComfyGeneratedMedia) {
  const ext = media.filename.split(".").pop()?.toLowerCase();
  if (ext && ["wav", "mp3", "flac", "m4a", "aac", "ogg", "opus"].includes(ext)) {
    return ext;
  }
  if (media.contentType === "audio/mpeg") return "mp3";
  if (media.contentType === "audio/flac") return "flac";
  if (media.contentType === "audio/mp4") return "m4a";
  if (media.contentType === "audio/ogg") return "ogg";
  return "wav";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
}

function normalizeVideoParams(rawBody: Partial<VideoGenerationParams>) {
  const videoModel = VIDEO_MODEL_PRESETS.has(rawBody.video_model as VideoModelPreset)
    ? (rawBody.video_model as VideoModelPreset)
    : DEFAULT_VIDEO_PARAMS.video_model;
  const fps = Math.round(clampNumber(rawBody.fps, DEFAULT_VIDEO_PARAMS.fps, 1, 60));
  const durationSeconds = clampNumber(
    rawBody.duration_seconds,
    DEFAULT_VIDEO_PARAMS.duration_seconds,
    1,
    30
  );
  const soundDurationSeconds = clampNumber(
    rawBody.sound_duration_seconds,
    durationSeconds,
    1,
    300
  );
  const vaeTileSize = Math.round(
    clampNumber(rawBody.vae_tile_size, DEFAULT_VIDEO_PARAMS.vae_tile_size, 128, 1024) / 32
  ) * 32;
  const vaeTileOverlap = Math.min(
    Math.round(
      clampNumber(rawBody.vae_tile_overlap, DEFAULT_VIDEO_PARAMS.vae_tile_overlap, 0, 256) / 16
    ) * 16,
    Math.floor(vaeTileSize / 2)
  );
  const vaeTemporalSize = Math.round(
    clampNumber(rawBody.vae_temporal_size, DEFAULT_VIDEO_PARAMS.vae_temporal_size, 8, 256)
  );
  const vaeTemporalOverlap = Math.min(
    Math.round(
      clampNumber(rawBody.vae_temporal_overlap, DEFAULT_VIDEO_PARAMS.vae_temporal_overlap, 0, 128)
    ),
    Math.max(0, vaeTemporalSize - 1)
  );

  return {
    ...DEFAULT_VIDEO_PARAMS,
    ...rawBody,
    video_model: videoModel,
    video_pipeline: String(
      rawBody.video_pipeline || rawBody.video_model || defaultVideoPipelineId()
    ).trim(),
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
    vae_tile_size: vaeTileSize,
    vae_tile_overlap: vaeTileOverlap,
    vae_temporal_size: vaeTemporalSize,
    vae_temporal_overlap: vaeTemporalOverlap,
    smooth_xxx_strength: clampNumber(rawBody.smooth_xxx_strength, DEFAULT_VIDEO_PARAMS.smooth_xxx_strength, 0, 2),
    mating_press_strength: clampNumber(rawBody.mating_press_strength, DEFAULT_VIDEO_PARAMS.mating_press_strength, 0, 2),
    lightx2v_high_strength: clampNumber(rawBody.lightx2v_high_strength, DEFAULT_VIDEO_PARAMS.lightx2v_high_strength, 0, 4),
    lightx2v_low_strength: clampNumber(rawBody.lightx2v_low_strength, DEFAULT_VIDEO_PARAMS.lightx2v_low_strength, 0, 4),
    ltx_dr34_strength: clampNumber(rawBody.ltx_dr34_strength, DEFAULT_VIDEO_PARAMS.ltx_dr34_strength, 0, 2),
    ltx_dasiwa_strength: clampNumber(rawBody.ltx_dasiwa_strength, DEFAULT_VIDEO_PARAMS.ltx_dasiwa_strength, 0, 2),
    seed: normalizeGenerationSeed(rawBody.seed),
    source_image: rawBody.source_image?.trim() || null,
    enable_sound: Boolean(rawBody.enable_sound),
    sound_prompt: String(rawBody.sound_prompt ?? "").trim(),
    negative_sound_prompt: String(rawBody.negative_sound_prompt ?? ""),
    sound_duration_seconds: soundDurationSeconds,
  } satisfies VideoGenerationParams;
}

async function selectedVideoWorkflowPath(params: VideoGenerationParams) {
  return (await resolveVideoWorkflowPath(params.video_pipeline || params.video_model))
    .absolutePath;
}

async function assertVideoWorkflowConfigured(params: VideoGenerationParams) {
  await access(await selectedVideoWorkflowPath(params));
}

async function configuredVideoWorkflowRequiresSourceImage(params: VideoGenerationParams) {
  const pipeline = await resolveVideoPipeline(params.video_pipeline || params.video_model);
  const rawWorkflow = JSON.parse(
    await readFile(await selectedVideoWorkflowPath(params), "utf-8")
  ) as unknown;
  return pipeline.mode === "i2v" || JSON.stringify(rawWorkflow).includes("{{source_image}}");
}

async function assertAudioWorkflowConfigured() {
  const workflowPath = process.env.COMFYUI_AUDIO_WORKFLOW_PATH?.trim();

  if (!workflowPath) {
    throw new Error(
      "Set COMFYUI_AUDIO_WORKFLOW_PATH to a ComfyUI API workflow JSON file before generating sound."
    );
  }

  const resolvedPath = isAbsolute(workflowPath)
    ? workflowPath
    : join(/*turbopackIgnore: true*/ process.cwd(), workflowPath);

  await access(resolvedPath);
}

type SavedAudio = {
  id: string;
  url: string;
  filename: string;
  params: VideoGenerationParams;
  timestamp: number;
  contentType: string;
};

async function saveBufferedAudios({
  audios,
  params,
}: {
  audios: ComfyGeneratedMedia[];
  params: VideoGenerationParams;
}) {
  await ensureAudioOutputDir();

  return Promise.all(
    audios.map(async (audio, index) => {
      const id = randomUUID();
      const filename = `${id}.${extensionForAudio(audio)}`;
      const timestamp = Date.now();

      await writeFile(join(AUDIO_OUTPUT_DIR, filename), audio.buffer);
      await writeFile(
        join(AUDIO_OUTPUT_DIR, `${id}.json`),
        JSON.stringify(
          {
            id,
            filename,
            params,
            timestamp,
            original_url: audio.originalUrl,
            original_filename: audio.filename,
            contentType: audio.contentType,
            index,
          },
          null,
          2
        )
      );

      return {
        id,
        url: `/api/audios/${filename}`,
        filename,
        params,
        timestamp,
        contentType: audio.contentType,
      } satisfies SavedAudio;
    })
  );
}

async function saveBufferedVideos({
  videos,
  params,
  audios = [],
}: {
  videos: ComfyGeneratedMedia[];
  params: VideoGenerationParams;
  audios?: SavedAudio[];
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
            audios,
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
        audios,
      };
    })
  );
}

function comfyWebSocketUrl(clientId: string, baseUrl = COMFYUI_BASE_URL) {
  const url = new URL(baseUrl.replace(/\/$/, ""));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

function openComfyWebSocket(clientId: string, baseUrl = COMFYUI_BASE_URL) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(comfyWebSocketUrl(clientId, baseUrl));
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

function nodeClass(prompt: Record<string, unknown>, nodeId: string | null | undefined) {
  if (!nodeId) return "";

  const node = prompt[nodeId];
  if (!node || typeof node !== "object" || Array.isArray(node)) return "";

  const classType = (node as { class_type?: unknown }).class_type;
  return typeof classType === "string" ? classType : "";
}

function nodeLabel(prompt: Record<string, unknown>, nodeId: string | null | undefined) {
  const classType = nodeClass(prompt, nodeId);
  if (!classType) return nodeId ? `Running node ${nodeId}` : "Running workflow";

  return VIDEO_NODE_LABELS[classType] ?? classType;
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const rawBody = (await req.json()) as Partial<VideoGenerationParams> & {
    generationTarget?: "local" | "runpod";
    runpodPodId?: string;
  };
  const body = normalizeVideoParams(rawBody);
  const generationTarget = rawBody.generationTarget === "runpod" ? "runpod" : "local";
  let comfyBaseUrl = COMFYUI_BASE_URL;

  if (!body.prompt) {
    return Response.json({ error: "Prompt is required." }, { status: 400 });
  }

  const requiresSourceImage = await configuredVideoWorkflowRequiresSourceImage(body);

  if (requiresSourceImage && !body.source_image) {
    return Response.json(
      { error: "A start image is required for the configured video workflow." },
      { status: 400 }
    );
  }

  try {
    await assertVideoWorkflowConfigured(body);
    if (body.enable_sound) {
      await assertAudioWorkflowConfigured();
    }

    if (generationTarget === "runpod") {
      const runpodPodId = String(rawBody.runpodPodId ?? "").trim();
      const pod = runpodPodId ? await getRunpodPod(runpodPodId) : null;

      if (!pod) {
        return Response.json({ error: "RunPod target is not configured." }, { status: 400 });
      }

      if (!pod.comfyUrl) {
        return Response.json(
          { error: "Selected RunPod pod has no ComfyUI URL configured." },
          { status: 400 }
        );
      }

      comfyBaseUrl = pod.comfyUrl.replace(/\/$/, "");
    }
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Generation workflow is not configured.",
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
      void cancelComfyPrompt(promptId, { baseUrl: comfyBaseUrl }).catch(() => {});
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
        ws = await openComfyWebSocket(clientId, comfyBaseUrl);
        let queuedPrompt: Record<string, unknown> = {};
        let startedAt = Date.now();
        let lastNodeId = "";

        ws.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;

          try {
            const message = JSON.parse(event.data) as ComfyWsMessage;
            if (!promptId || message.data?.prompt_id !== promptId) return;

            lastComfyActivityAt = Date.now();

            if (message.type === "executing") {
              const nodeId = String(message.data?.node ?? "");
              if (!nodeId) {
                send("detail", {
                  stage: "waiting" satisfies VideoStage,
                  message: "Waiting for final output...",
                  elapsed_ms: Date.now() - startedAt,
                });
                return;
              }

              if (nodeId !== lastNodeId) {
                lastNodeId = nodeId;
                send("detail", {
                  stage: "executing" satisfies VideoStage,
                  node_id: nodeId,
                  node_type: nodeClass(queuedPrompt, nodeId),
                  message: nodeLabel(queuedPrompt, nodeId),
                  elapsed_ms: Date.now() - startedAt,
                });
              }
              return;
            }

            if (message.type !== "progress") return;

            const value = Number(message.data.value ?? 0);
            const max = Number(message.data.max ?? body.num_inference_steps);
            const progress =
              max > 0 ? Math.min(99, Math.max(1, Math.round((value / max) * 100))) : 1;

            send("progress", {
              progress,
              stage: "sampling" satisfies VideoStage,
              node_id: lastNodeId || undefined,
              node_type: lastNodeId ? nodeClass(queuedPrompt, lastNodeId) : undefined,
              step: value,
              total_steps: max,
              message: `Step ${value}/${max}`,
              elapsed_ms: Date.now() - startedAt,
            });
          } catch {
            // Ignore malformed websocket messages from ComfyUI extensions.
          }
        });

        send("progress", {
          progress: 1,
          stage: "queued" satisfies VideoStage,
          message: "Queued...",
          elapsed_ms: 0,
        });
        const queued = await queueComfyVideoPrompt(body, clientId, { baseUrl: comfyBaseUrl });
        promptId = queued.prompt_id;
        queuedPrompt = (queued as { prompt?: Record<string, unknown> }).prompt ?? {};
        startedAt = Date.now();
        lastComfyActivityAt = Date.now();
        send("queued", { prompt_id: promptId, started_at: startedAt });
        send("progress", {
          progress: 2,
          stage: "waiting" satisfies VideoStage,
          message: "Waiting for ComfyUI...",
          elapsed_ms: 0,
        });

        const videoRefs = await waitForComfyVideoRefs(promptId, {
          baseUrl: comfyBaseUrl,
          signal: abortController.signal,
          getLastActivityAt: () => lastComfyActivityAt,
        });
        send("detail", {
          stage: "fetching" satisfies VideoStage,
          message: "Fetching generated video from ComfyUI...",
          elapsed_ms: Date.now() - startedAt,
        });
        const videos = await fetchComfyMedia(videoRefs, { baseUrl: comfyBaseUrl });
        send("detail", {
          stage: "saving" satisfies VideoStage,
          message: "Saving video locally...",
          elapsed_ms: Date.now() - startedAt,
        });
        let savedAudios: SavedAudio[] = [];

        if (body.enable_sound) {
          send("detail", {
            stage: "audio" satisfies VideoStage,
            message: "Queueing sound generation...",
            elapsed_ms: Date.now() - startedAt,
          });

          const audioQueued = await queueComfyAudioPrompt(body, clientId, {
            baseUrl: comfyBaseUrl,
          });
          promptId = audioQueued.prompt_id;
          queuedPrompt = (audioQueued as { prompt?: Record<string, unknown> }).prompt ?? {};
          lastNodeId = "";
          lastComfyActivityAt = Date.now();
          send("detail", {
            stage: "audio" satisfies VideoStage,
            message: "Generating sound...",
            elapsed_ms: Date.now() - startedAt,
          });

          const audioRefs = await waitForComfyAudioRefs(promptId, {
            baseUrl: comfyBaseUrl,
            signal: abortController.signal,
            getLastActivityAt: () => lastComfyActivityAt,
          });
          send("detail", {
            stage: "fetching" satisfies VideoStage,
            message: "Fetching generated sound from ComfyUI...",
            elapsed_ms: Date.now() - startedAt,
          });
          const audios = await fetchComfyMedia(audioRefs, { baseUrl: comfyBaseUrl });
          send("detail", {
            stage: "saving" satisfies VideoStage,
            message: "Saving sound locally...",
            elapsed_ms: Date.now() - startedAt,
          });
          savedAudios = await saveBufferedAudios({ audios, params: body });
        }

        const savedVideos = await saveBufferedVideos({
          videos,
          params: body,
          audios: savedAudios,
        });

        send("progress", {
          progress: 100,
          stage: "complete" satisfies VideoStage,
          message: "Done",
          elapsed_ms: Date.now() - startedAt,
        });
        send("complete", { videos: savedVideos, audios: savedAudios });
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
