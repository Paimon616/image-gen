import { create } from "zustand";
import { useStore } from "./store";
import {
  randomGenerationSeed,
  UNGROUPED_WORKSPACE_ID,
  type CivitaiOrigin,
  type GeneratedImage,
  type GenerationParams,
  type ImportedCivitaiResource,
} from "./types";

export interface GenerationQueueItem {
  id: string;
  params: GenerationParams;
  resources?: ImportedCivitaiResource[];
  civitaiOrigin?: CivitaiOrigin;
  workspaceId?: string;
  generationTarget: "local" | "runpod";
  runpodPodId?: string;
  // Links the generated image back to the saved character/situation it was
  // composed from (set when generation is triggered from the Paimon picker).
  characterId?: string;
  situationId?: string;
}

export interface RunpodMissingFile {
  folder: string;
  path: string;
  resource: {
    type: "checkpoint" | "lora" | "embedding" | "vae" | "upscaler" | "other";
    name: string;
    versionName?: string;
    baseModel?: string;
    url: string;
    modelId?: number;
    modelVersionId?: number;
  };
  // Server-computed: whether the pod can fetch this file automatically. Mirrors
  // getRunpodDownloadPlan's eligibility so the client never re-derives it.
  downloadable?: boolean;
}

// Links a composed prompt to the character/situation it came from so a manual
// Generate press (after picking a situation without auto-generate) can still tag
// the image. Only used while the prompt still matches what was composed.
export interface CharacterContext {
  characterId?: string;
  situationId?: string;
  prompt: string;
}

// Target/validation context the generator page publishes. Held here (not in the
// page) so a background enqueue — a Paimon batch that outlives the page — still
// knows where to generate and what to pre-check.
export interface GenerationRuntimeConfig {
  generationTarget: "local" | "runpod";
  runpodPodId: string;
  ko: boolean;
  // Why the current params can't generate at all (missing source image, etc.).
  modeError: string;
}

// Page-side side effects for an enqueue the user is watching. A background
// enqueue simply omits them.
export interface EnqueueHooks {
  onRunpodBusy?: (busy: "" | "check") => void;
  onRunpodStatus?: (message: string) => void;
  onMissingFiles?: (missing: RunpodMissingFile[]) => void;
}

interface GenerationQueueState {
  queue: GenerationQueueItem[];
  active: GenerationQueueItem | null;
  config: GenerationRuntimeConfig;
  characterContext: CharacterContext | null;

  setConfig: (config: Partial<GenerationRuntimeConfig>) => void;
  setCharacterContext: (context: CharacterContext | null) => void;
  enqueue: (
    sourceParams: GenerationParams,
    meta?: { characterId?: string; situationId?: string },
    hooks?: EnqueueHooks
  ) => Promise<void>;
  cancel: (imageId?: string) => void;
}

// The in-flight job's runtime. Kept at module scope (outside both React and
// zustand) so the running generation and the queue pump survive navigating away
// from the generator page, and so touching them never triggers a render.
const runtime = {
  activePromptId: "",
  abortController: null as AbortController | null,
  pumping: false,
};

function cloneGenerationParams(params: GenerationParams) {
  return JSON.parse(JSON.stringify(params)) as GenerationParams;
}

function parseSseEvent(rawEvent: string) {
  const event =
    rawEvent
      .split("\n")
      .find((line) => line.startsWith("event: "))
      ?.slice("event: ".length)
      .trim() ?? "message";
  const data = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");

  return {
    event,
    data: data ? JSON.parse(data) : null,
  };
}

function importedCivitaiResources(): ImportedCivitaiResource[] {
  return useStore
    .getState()
    .civitaiImport.missingResources.map((resource): ImportedCivitaiResource => ({
      type: resource.type,
      name: resource.name,
      versionName: resource.versionName,
      baseModel: resource.baseModel,
      weight: resource.weight,
      hash: resource.hash,
      modelId: resource.modelId,
      modelVersionId: resource.modelVersionId,
      url: resource.url,
    }));
}

// Asks the pod which files the given params still need. Throws on a failed
// check so the caller can surface it instead of generating into a broken pod.
async function checkRunpodFiles(
  podId: string,
  params: GenerationParams
): Promise<RunpodMissingFile[]> {
  const response = await fetch(`/api/runpod/pods/${podId}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ params, resources: importedCivitaiResources() }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "RunPod file check failed");

  return Array.isArray(data.missing) ? (data.missing as RunpodMissingFile[]) : [];
}

async function runGenerationJob(job: GenerationQueueItem) {
  const {
    id,
    params: jobParams,
    civitaiOrigin,
    workspaceId,
    generationTarget: jobGenerationTarget,
    runpodPodId,
    characterId,
    situationId,
  } = job;
  const { addImages, setStatus, updateImage } = useStore.getState();

  const abortController = new AbortController();
  runtime.activePromptId = "";
  runtime.abortController = abortController;
  updateImage(id, {
    generation: {
      state: "waiting",
      progress: 1,
      message: "Queued...",
    },
  });

  try {
    const res = await fetch("/api/generate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...jobParams,
        resources: job.resources ?? [],
        civitaiOrigin,
        workspaceId,
        generationTarget: jobGenerationTarget,
        runpodPodId,
        characterId,
        situationId,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Generation failed");
    }

    if (!res.body) {
      throw new Error("Generation stream did not start");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completed = false;

    while (!completed) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const rawEvent of events) {
        if (!rawEvent.trim()) continue;
        const { event, data } = parseSseEvent(rawEvent);

        if (event === "queued") {
          runtime.activePromptId = String(data?.prompt_id ?? "");
          updateImage(id, {
            generation: {
              state: "waiting",
              progress: 1,
              message: "Waiting for ComfyUI...",
            },
          });
        }

        if (event === "progress") {
          const progress = Number(data?.progress ?? 0);
          const message = String(data?.message ?? "Generating...");
          const isStepProgress = data?.step != null && data?.total_steps != null;
          updateImage(id, {
            generation: {
              state: isStepProgress ? "generating" : "waiting",
              progress,
              message,
            },
          });
        }

        if (event === "complete") {
          const generatedImages: GeneratedImage[] = Array.isArray(data?.images)
            ? data.images
            : [];

          if (generatedImages.length === 0) {
            throw new Error("Generation completed without an image.");
          }

          const [firstImage, ...additionalImages] = generatedImages;
          updateImage(id, {
            ...firstImage,
            params: firstImage.params ?? jobParams,
            generation: {
              state: "completed",
              progress: 100,
              message: "Done",
            },
          });

          if (additionalImages.length > 0) {
            addImages(
              additionalImages.map((image) => ({
                ...image,
                generation: {
                  state: "completed" as const,
                  progress: 100,
                  message: "Done",
                },
              }))
            );
          }

          // Refresh workspace image counts after auto-registering the result.
          if (workspaceId) {
            void useStore.getState().fetchWorkspaces();
          }

          completed = true;
        }

        if (event === "error") {
          throw new Error(data?.error || "Generation failed");
        }
      }
    }

    setStatus({ state: "completed", progress: 100, message: "Done!" });
    setTimeout(() => {
      setStatus({ state: "idle", progress: 0, message: "" });
    }, 2000);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      updateImage(id, {
        generation: {
          state: "canceled",
          progress: 0,
          message: "Canceled.",
        },
      });
      setStatus({ state: "canceled", progress: 0, message: "Canceled." });
      return;
    }

    const message = err instanceof Error ? err.message : "Unknown error";
    updateImage(id, {
      generation: {
        state: "error",
        progress: 0,
        message,
      },
    });
    setStatus({ state: "error", progress: 0, message });
  } finally {
    runtime.abortController = null;
    runtime.activePromptId = "";
  }
}

// Drains the queue one job at a time. Driven imperatively (not by a React
// effect) so an enqueue keeps the queue moving even with no page mounted.
async function pump() {
  if (runtime.pumping) return;
  runtime.pumping = true;

  try {
    for (;;) {
      const [next] = useGenerationQueueStore.getState().queue;
      if (!next) break;

      useGenerationQueueStore.setState((state) => ({
        queue: state.queue.filter((job) => job.id !== next.id),
        active: next,
      }));
      await runGenerationJob(next);
      useGenerationQueueStore.setState({ active: null });
    }
  } finally {
    runtime.pumping = false;
  }
}

export const useGenerationQueueStore = create<GenerationQueueState>(
  (set, get) => ({
    queue: [],
    active: null,
    config: {
      generationTarget: "local",
      runpodPodId: "",
      ko: true,
      modeError: "",
    },
    characterContext: null,

    setConfig: (config) =>
      set((state) => ({ config: { ...state.config, ...config } })),

    setCharacterContext: (context) => set({ characterContext: context }),

    enqueue: async (sourceParams, meta, hooks) => {
      if (!sourceParams.prompt.trim()) return;

      const { config, characterContext } = get();
      const { addImage, setStatus } = useStore.getState();
      // Resolve the character/situation link. An explicit meta (Paimon auto-gen
      // or batch) wins; otherwise fall back to the last composed context if the
      // prompt still matches, so a manual Generate after picking a situation
      // still tags.
      const linkedMeta =
        meta ??
        (characterContext && characterContext.prompt === sourceParams.prompt
          ? {
              characterId: characterContext.characterId,
              situationId: characterContext.situationId,
            }
          : undefined);

      if (config.modeError) {
        setStatus({ state: "error", progress: 0, message: config.modeError });
        return;
      }
      if (config.generationTarget === "runpod" && !config.runpodPodId) {
        setStatus({
          state: "error",
          progress: 0,
          message: "RunPod target is not configured.",
        });
        return;
      }
      if (config.generationTarget === "runpod") {
        hooks?.onRunpodBusy?.("check");
        hooks?.onRunpodStatus?.(
          config.ko
            ? "RunPod 파일을 확인 중입니다..."
            : "Checking RunPod files..."
        );
        try {
          const missing = await checkRunpodFiles(
            config.runpodPodId,
            sourceParams
          );
          hooks?.onMissingFiles?.(missing);
          if (missing.length > 0) {
            hooks?.onRunpodStatus?.(
              config.ko
                ? `RunPod에 누락 파일 ${missing.length}개가 있어 생성하지 않았습니다. 다운로드 후 다시 생성하세요.`
                : `${missing.length} file(s) are missing on RunPod. Download them before generating.`
            );
            setStatus({
              state: "error",
              progress: 0,
              message: config.ko
                ? `RunPod 누락 파일 ${missing.length}개`
                : `${missing.length} RunPod file(s) missing`,
            });
            return;
          }
          hooks?.onRunpodStatus?.(
            config.ko ? "RunPod 파일 준비 완료." : "RunPod files are ready."
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "RunPod file check failed";
          hooks?.onRunpodStatus?.(message);
          setStatus({ state: "error", progress: 0, message });
          return;
        } finally {
          hooks?.onRunpodBusy?.("");
        }
      }

      const jobParams = cloneGenerationParams(sourceParams);
      if (jobParams.seed == null || jobParams.seed < 0) {
        jobParams.seed = randomGenerationSeed();
      }
      const id = crypto.randomUUID();
      const civitaiOrigin = useStore.getState().civitaiReference ?? undefined;
      // The sentinel "ungrouped" filter is not a real workspace: tagging the
      // placeholder with it would make the card fail the ungrouped view's
      // "no workspaces" test, so the queued card stays invisible until the
      // finished image (which the server saves unassigned) replaces it.
      const activeWorkspaceId = useStore.getState().activeWorkspaceId;
      const workspaceId =
        activeWorkspaceId && activeWorkspaceId !== UNGROUPED_WORKSPACE_ID
          ? activeWorkspaceId
          : undefined;

      addImage({
        id,
        url: "",
        filename: "",
        params: jobParams,
        timestamp: Date.now(),
        civitaiOrigin,
        workspaces: workspaceId ? [workspaceId] : [],
        characterId: linkedMeta?.characterId,
        situationId: linkedMeta?.situationId,
        generation: {
          state: "queued",
          progress: 0,
          message: "Queued",
        },
      });
      set((state) => ({
        queue: [
          ...state.queue,
          {
            id,
            params: jobParams,
            resources: importedCivitaiResources(),
            civitaiOrigin,
            workspaceId,
            generationTarget: config.generationTarget,
            runpodPodId:
              config.generationTarget === "runpod"
                ? config.runpodPodId
                : undefined,
            characterId: linkedMeta?.characterId,
            situationId: linkedMeta?.situationId,
          },
        ],
      }));
      setStatus({ state: "idle", progress: 0, message: "" });
      void pump();
    },

    cancel: (imageId) => {
      const { queue, active } = get();
      const { setStatus, updateImage } = useStore.getState();
      const targetId = imageId ?? active?.id;

      if (!targetId) return;

      const canceled = () => {
        updateImage(targetId, {
          generation: {
            state: "canceled",
            progress: 0,
            message: "Canceled.",
          },
        });
        setStatus({ state: "canceled", progress: 0, message: "Canceled." });
      };

      if (queue.some((job) => job.id === targetId)) {
        set((state) => ({
          queue: state.queue.filter((job) => job.id !== targetId),
        }));
        canceled();
        return;
      }

      if (active?.id !== targetId) return;

      const promptId = runtime.activePromptId;
      runtime.abortController?.abort();

      if (promptId) {
        void fetch("/api/generate/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt_id: promptId }),
        }).catch(() => {});
      }

      canceled();
    },
  })
);
