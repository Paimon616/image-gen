import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { NextRequest } from "next/server";
import {
  COMFYUI_BASE_URL,
  cancelComfyPrompt,
  fetchComfyImages,
  queueComfyPrompt,
  waitForComfyImageRefs,
  type ComfyClientOptions,
  type ComfyGeneratedImage,
} from "@/lib/comfyui";
import {
  acquireGpuWorker,
  forgetGpuWorkerProbe,
  getGpuWorkers,
  type GpuWorkerLease,
} from "@/lib/gpu-workers";
import {
  getModelConfig,
  normalizeGenerationSeed,
  normalizeImageDimension,
} from "@/lib/types";
import type { CivitaiOrigin, GenerationParams } from "@/lib/types";
import { imageUrl, OUTPUT_DIR, thumbnailUrl } from "@/lib/server-images";
import { buildGenerationResources } from "@/lib/generation-resource-links";
import { generateWithA1111, interruptA1111 } from "@/lib/a1111";
import { toggleImageWorkspace, workspaceExists } from "@/lib/workspaces";
import { notifyWorkspaceChanged } from "@/lib/runpod-share";
import { getRunpodPod, readSettings } from "@/lib/settings";
import { getCharacter, isValidCharacterId } from "@/lib/characters";
import { applyReferenceSheet, shouldApplyReferenceSheet } from "@/lib/character-sheet";
import { resolveCheckpointFamily } from "@/lib/comfyui-model-files";
import {
  checkRunpodGenerationFiles,
  ensureRunpodComfyCatalogReady,
} from "@/lib/runpod";
import type { ImportedCivitaiResource } from "@/lib/types";

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
  workspaceId,
  characterId,
  situationId,
  workflow,
}: {
  images: ComfyGeneratedImage[];
  params: GenerationParams;
  endpoint: string;
  civitaiOrigin?: CivitaiOrigin;
  workspaceId?: string;
  characterId?: string;
  situationId?: string;
  workflow?: unknown;
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
            size_semantics: "final",
            resources,
            endpoint,
            timestamp,
            original_url: img.originalUrl,
            index: i,
            civitai_origin: civitaiOrigin,
            ...(characterId ? { character_id: characterId } : {}),
            ...(situationId ? { situation_id: situationId } : {}),
            ...(workflow ? { workflow } : {}),
          },
          null,
          2
        )
      );

      // Auto-register the fresh image into the active workspace so it shows up
      // in that workspace's filtered gallery view immediately.
      const workspaces = workspaceId
        ? await toggleImageWorkspace(filename, workspaceId, true).catch(() => [])
        : [];
      // A new image in a shared workspace is pushed to the pod on its own.
      if (workspaceId) void notifyWorkspaceChanged(workspaceId).catch(() => {});

      return {
        id,
        url: imageUrl(filename),
        thumbnailUrl: thumbnailUrl(filename),
        filename,
        params,
        sizeSemantics: "final" as const,
        timestamp,
        civitaiOrigin,
        workspaces,
        ...(characterId ? { characterId } : {}),
        ...(situationId ? { situationId } : {}),
      };
    })
  );
}

function comfyWebSocketUrl(clientId: string, baseUrl = COMFYUI_BASE_URL) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.searchParams.set("clientId", clientId);
  return url.toString();
}

function openComfyWebSocket(clientId: string, baseUrl?: string) {
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

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const {
    civitaiOrigin,
    workspaceId: rawWorkspaceId,
    generationTarget,
    runpodPodId,
    resources,
    characterId,
    situationId,
    workload,
    ...rawBody
  } = (await req.json()) as GenerationParams & {
    civitaiOrigin?: CivitaiOrigin;
    workspaceId?: string;
    generationTarget?: "local" | "runpod" | "workers";
    // GPU worker pool hint: "light" (preview/upscale) may go to the slower card.
    workload?: "full" | "light";
    runpodPodId?: string;
    resources?: ImportedCivitaiResource[];
    characterId?: string;
    situationId?: string;
  };
  let body: GenerationParams = {
    ...rawBody,
    width: normalizeImageDimension(rawBody.width),
    height: normalizeImageDimension(rawBody.height),
    seed: normalizeGenerationSeed(rawBody.seed),
    // Only this route sets the sheet reference (below); a client-sent value is
    // dropped so the beta toggle and per-character switch stay authoritative.
    character_sheet_image: null,
    // A gallery pick is an app-relative URL; resolveControlNetImage uploads
    // only absolute refs to the ComfyUI that runs the job.
    style_image: rawBody.style_image?.startsWith("/api/")
      ? new URL(rawBody.style_image, req.nextUrl.origin).toString()
      : rawBody.style_image,
  };
  // BETA 캐릭터 기준 시트: a render linked to a sheet-confirmed character gets
  // the sheet as IP-Adapter reference. Off (beta or per-character) = unchanged.
  if (characterId && isValidCharacterId(characterId) && body.backend === "comfyui") {
    const [settings, character] = await Promise.all([
      readSettings(),
      getCharacter(characterId),
    ]);
    if (
      character?.referenceSheet &&
      shouldApplyReferenceSheet({
        betaEnabled: settings.betaCharacterSheet,
        sheet: character.referenceSheet,
        situationId,
        backend: body.backend,
      })
    ) {
      // Absolute URL: resolveControlNetImage uploads only http(s) refs to the
      // ComfyUI that runs the job (local, pod or GPU worker), like /api/upload.
      const sheet = character.referenceSheet;
      const absolute = (url: string) => new URL(url, req.nextUrl.origin).toString();
      body = applyReferenceSheet(body, {
        ...sheet,
        url: absolute(sheet.url),
        crop: sheet.crop ? { ...sheet.crop, url: absolute(sheet.crop.url) } : null,
        regions: (sheet.regions ?? []).map((region) => ({ ...region, url: absolute(region.url) })),
      });
      // Krea 2 has no IP-Adapter path: the chosen sheet view becomes its
      // character reference (Identity Edit) unless the user set one already.
      if (
        body.character_sheet_image &&
        !body.character_image?.trim() &&
        (await resolveCheckpointFamily(body.model_name ?? "")) === "krea2"
      ) {
        body = { ...body, character_image: body.character_sheet_image };
      }
    }
  }
  const modelConfig = getModelConfig(body.model);
  const runpodPod =
    generationTarget === "runpod" && runpodPodId
      ? await getRunpodPod(runpodPodId)
      : undefined;
  // Reassigned once a GPU worker is leased for the "workers" target.
  let comfyOptions: ComfyClientOptions | undefined = runpodPod?.comfyUrl
    ? { baseUrl: runpodPod.comfyUrl, remoteKind: "runpod" }
    : undefined;
  const useGpuWorkers = generationTarget === "workers";
  let workerLease: GpuWorkerLease | null = null;

  if (useGpuWorkers && body.backend !== "comfyui") {
    return Response.json(
      { error: "GPU worker generation supports the ComfyUI backend only." },
      { status: 400 }
    );
  }

  if (generationTarget === "runpod") {
    if (!runpodPod) {
      return Response.json(
        { error: "Select a registered RunPod target first." },
        { status: 400 }
      );
    }
    if (!runpodPod.comfyUrl) {
      return Response.json(
        { error: "Selected RunPod target needs a ComfyUI URL." },
        { status: 400 }
      );
    }
    if (body.backend !== "comfyui") {
      return Response.json(
        { error: "RunPod generation currently supports ComfyUI backend only." },
        { status: 400 }
      );
    }
    const missing = await checkRunpodGenerationFiles(
      runpodPod,
      body,
      Array.isArray(resources) ? resources : []
    );
    if (missing.length > 0) {
      return Response.json(
        {
          error: `RunPod is missing ${missing.length} required model file(s). Run file check/download before generating.`,
          missing,
        },
        { status: 400 }
      );
    }
    await ensureRunpodComfyCatalogReady(runpodPod, body);
  }
  // Only honor a workspace target that still exists, so a stale id from the
  // client can't create dangling assignments.
  const workspaceId =
    rawWorkspaceId && (await workspaceExists(rawWorkspaceId))
      ? rawWorkspaceId
      : undefined;

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
      void cancelComfyPrompt(promptId, comfyOptions).catch(() => {});
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
            workspaceId,
            characterId,
            situationId,
          });
          send("progress", { progress: 100, message: "Done" });
          send("complete", { images: savedImages });
          return;
        }

        const clientId = randomUUID();
        if (useGpuWorkers) {
          send("progress", { progress: 1, message: "Picking a GPU worker..." });
          // A worker that answered the probe can still drop the socket (PC
          // just turned off). Nothing has been queued yet, so moving to the
          // next worker cannot duplicate the job.
          const tried = new Set<string>();
          const attempts = Math.max(1, (await getGpuWorkers()).length);
          for (let attempt = 0; attempt < attempts; attempt++) {
            const lease = await acquireGpuWorker(
              { ...body, workload },
              {
                exclude: tried,
                signal: abortController.signal,
                onWait: (waitedMs) =>
                  send("progress", {
                    progress: 1,
                    message: `All GPU workers busy, waiting ${Math.round(waitedMs / 1000)}s...`,
                  }),
              }
            );
            try {
              ws = await openComfyWebSocket(clientId, lease.worker.url);
              workerLease = lease;
              comfyOptions = { baseUrl: lease.worker.url, remoteKind: "gpu-worker" };
              break;
            } catch (error) {
              lease.release();
              forgetGpuWorkerProbe(lease.worker.id);
              tried.add(lease.worker.id);
              if (attempt === attempts - 1) throw error;
            }
          }
          if (!workerLease) throw new Error("No GPU worker accepted the job.");
          send("worker", {
            id: workerLease.worker.id,
            label: workerLease.worker.label,
            workload: workerLease.workload,
          });
          send("progress", {
            progress: 1,
            message: `GPU worker: ${workerLease.worker.label}`,
          });
        } else {
          ws = await openComfyWebSocket(clientId, comfyOptions?.baseUrl);
        }
        if (!ws) throw new Error("ComfyUI progress stream did not open");

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
        const queued = await queueComfyPrompt(body, clientId, comfyOptions);
        promptId = queued.prompt_id;
        workerLease?.bindPrompt(promptId);
        lastComfyActivityAt = Date.now();
        send("queued", { prompt_id: promptId });
        send("progress", { progress: 2, message: "Waiting for ComfyUI..." });

        const imageRefs = await waitForComfyImageRefs(promptId, {
          signal: abortController.signal,
          getLastActivityAt: () => lastComfyActivityAt,
          baseUrl: comfyOptions?.baseUrl,
        });
        const images = await fetchComfyImages(imageRefs, comfyOptions);
        const savedImages = await saveBufferedImages({
          images,
          params: body,
          endpoint: workerLease
            ? `worker/${workerLease.worker.label}`
            : runpodPod
              ? `runpod/${runpodPod.label || runpodPod.podId}`
              : modelConfig.id,
          civitaiOrigin,
          workspaceId,
          characterId,
          situationId,
          workflow: queued.workflow,
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
        workerLease?.release();
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
