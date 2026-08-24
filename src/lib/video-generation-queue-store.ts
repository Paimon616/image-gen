import { create } from "zustand";
import { useMediaWorkspaceStore } from "./media-workspace-store";
import {
  UNGROUPED_WORKSPACE_ID,
  type GeneratedVideo,
  type GenerationStatus,
  type VideoGenerationParams,
} from "./types";
import type { SituationVideoLink } from "./situation-video-store";
import { toAbsoluteImageUrl } from "./video-reference";
import { useVideoStore } from "./video-store";

// The ComfyUI video generation queue, held at module scope — not in the video
// page — so a queued Paimon situation batch keeps generating after the user
// navigates away. Mirrors the image generator's generation-queue-store: the
// page publishes its target/validation context via setConfig, subscribes to
// status/progress/details for its UI, and enqueue/cancel drive the queue from
// anywhere (the page's Generate button and the background situation runner
// share the same path).

export interface VideoQueueItem {
  id: string;
  params: VideoGenerationParams;
  generationTarget: "local" | "runpod";
  runpodPodId?: string;
  /** Workspace the gallery was filtered to when the job was queued; the finished
   *  clip is filed under it, mirroring the image generator. */
  workspaceId?: string;
  /** Character/situation a Paimon situation run composed this clip for; the
   *  server tags the finished clip's sidecar with it so the video registers
   *  into that situation in the character studio. */
  link?: SituationVideoLink;
}

export interface VideoGenerationDetail {
  id: string;
  stage: string;
  message: string;
  node_id?: string;
  node_type?: string;
  step?: number;
  total_steps?: number;
  elapsed_ms?: number;
}

// Target/validation context the video page publishes. Held here (not in the
// page) so a background enqueue — a Paimon batch that outlives the page — still
// knows where to generate and which pre-checks apply.
export interface VideoGenerationRuntimeConfig {
  generationTarget: "local" | "runpod";
  runpodPodId: string;
  // The selected pod has a ComfyUI URL to generate against.
  runpodReady: boolean;
  // The selected pipeline is i2v, so a job without a start image must not queue.
  requiresSourceImage: boolean;
  workflowReady: boolean;
  workflowMessage: string;
  soundWorkflowReady: boolean;
  soundMessage: string;
  // The selected pipeline renders its own audio, so the separate sound pass is
  // dropped from queued params.
  includesAudio: boolean;
  ko: boolean;
}

interface VideoGenerationQueueState {
  queue: VideoQueueItem[];
  active: VideoQueueItem | null;
  status: GenerationStatus;
  buttonProgress: number;
  details: VideoGenerationDetail[];
  config: VideoGenerationRuntimeConfig;

  setConfig: (config: Partial<VideoGenerationRuntimeConfig>) => void;
  enqueue: (override?: VideoGenerationParams, link?: SituationVideoLink) => void;
  cancel: (videoId?: string) => void;
  // One-time restore of the sessionStorage snapshot after a full reload.
  restoreStoredState: () => void;
}

const VIDEO_GENERATION_STATE_KEY = "image-gen-video-generation-state";

interface StoredVideoGenerationState {
  status: GenerationStatus;
  buttonProgress: number;
  activePromptId: string;
  details: VideoGenerationDetail[];
}

// The in-flight job's runtime. Kept at module scope (outside both React and
// zustand) so the running generation and the queue pump survive navigating away
// from the video page, and so touching them never triggers a render.
const runtime = {
  activePromptId: "",
  abortController: null as AbortController | null,
  pumping: false,
  restored: false,
};

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

function detailKey(detail: Omit<VideoGenerationDetail, "id">) {
  return [
    detail.stage,
    detail.node_id ?? "",
    detail.node_type ?? "",
    detail.step ?? "",
    detail.total_steps ?? "",
    detail.message,
  ].join(":");
}

function readStoredGenerationState(): StoredVideoGenerationState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(VIDEO_GENERATION_STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredVideoGenerationState>;
    if (!parsed.status || !Array.isArray(parsed.details)) return null;

    return {
      status: parsed.status,
      buttonProgress: Number(
        parsed.buttonProgress ?? parsed.status.progress ?? 0
      ),
      activePromptId: String(parsed.activePromptId ?? ""),
      details: parsed.details,
    };
  } catch {
    return null;
  }
}

function writeStoredGenerationState(state: StoredVideoGenerationState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      VIDEO_GENERATION_STATE_KEY,
      JSON.stringify(state)
    );
  } catch {}
}

function clearStoredGenerationState() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(VIDEO_GENERATION_STATE_KEY);
  } catch {}
}

function setStatus(status: GenerationStatus) {
  useVideoGenerationQueueStore.setState({ status });
}

function setButtonProgress(buttonProgress: number) {
  useVideoGenerationQueueStore.setState({ buttonProgress });
}

function appendGenerationDetail(detail: Omit<VideoGenerationDetail, "id">) {
  const key = detailKey(detail);

  useVideoGenerationQueueStore.setState((state) => {
    if (state.details[0]?.id === key) {
      return {
        details: [
          { ...state.details[0], ...detail, id: key },
          ...state.details.slice(1),
        ],
      };
    }
    return { details: [{ ...detail, id: key }, ...state.details].slice(0, 8) };
  });
}

async function runGenerationJob(job: VideoQueueItem) {
  const {
    id,
    params: jobParams,
    generationTarget: jobTarget,
    runpodPodId,
    workspaceId,
    link,
  } = job;
  const { updatePendingVideo, removePendingVideo, setVideos } =
    useVideoStore.getState();

  const abortController = new AbortController();
  runtime.activePromptId = "";
  runtime.abortController = abortController;
  useVideoGenerationQueueStore.setState({ details: [] });
  setButtonProgress(1);
  setStatus({ state: "generating", progress: 1, message: "Queued..." });
  updatePendingVideo(id, {
    generation: { state: "waiting", progress: 1, message: "Queued..." },
  });
  appendGenerationDetail({
    stage: "queued",
    message: "Queued request in Image Gen.",
    elapsed_ms: 0,
  });

  let generated = false;

  try {
    const res = await fetch("/api/video/generate/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...jobParams,
        generationTarget: jobTarget,
        runpodPodId: jobTarget === "runpod" ? runpodPodId : undefined,
        workspaceId,
        characterId: link?.characterId,
        situationId: link?.situationId,
      }),
      signal: abortController.signal,
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Video generation failed");
    }

    if (!res.body) {
      throw new Error("Video generation stream did not start");
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
          updatePendingVideo(id, {
            generation: {
              state: "waiting",
              progress: 1,
              message: "Waiting for ComfyUI...",
            },
          });
        }

        if (event === "progress") {
          const progress = Number(data?.progress ?? 0);
          const message = String(data?.message ?? "Generating video...");
          const isStepProgress = data?.step != null && data?.total_steps != null;
          setButtonProgress(progress);
          setStatus({ state: "generating", progress, message });
          updatePendingVideo(id, {
            generation: {
              state: isStepProgress ? "generating" : "waiting",
              progress,
              message,
            },
          });
          appendGenerationDetail({
            stage: String(data?.stage ?? "progress"),
            message,
            node_id: data?.node_id ? String(data.node_id) : undefined,
            node_type: data?.node_type ? String(data.node_type) : undefined,
            step: typeof data?.step === "number" ? Number(data.step) : undefined,
            total_steps:
              typeof data?.total_steps === "number"
                ? Number(data.total_steps)
                : undefined,
            elapsed_ms:
              typeof data?.elapsed_ms === "number"
                ? Number(data.elapsed_ms)
                : undefined,
          });
        }

        if (event === "detail") {
          const message = String(data?.message ?? "Working...");
          useVideoGenerationQueueStore.setState((state) => ({
            status: { ...state.status, message },
          }));
          // Keep the card's progress/state, just refresh the message.
          const detailCard = useVideoStore
            .getState()
            .pendingVideos.find((video) => video.id === id);
          if (detailCard?.generation) {
            updatePendingVideo(id, {
              generation: { ...detailCard.generation, message },
            });
          }
          appendGenerationDetail({
            stage: String(data?.stage ?? "detail"),
            message,
            node_id: data?.node_id ? String(data.node_id) : undefined,
            node_type: data?.node_type ? String(data.node_type) : undefined,
            elapsed_ms:
              typeof data?.elapsed_ms === "number"
                ? Number(data.elapsed_ms)
                : undefined,
          });
        }

        if (event === "complete") {
          const generatedVideos = (data?.videos ?? []) as GeneratedVideo[];
          if (generatedVideos.length > 0) {
            setVideos((current) => [...generatedVideos, ...current]);
            // Refresh the chip counts after the auto-registration above.
            if (workspaceId) {
              void useMediaWorkspaceStore.getState().fetchWorkspaces("videos");
            }
          }
          // The finished video moves into the server-backed list, so drop the
          // pending card.
          removePendingVideo(id);
          generated = true;
          completed = true;
        }

        if (event === "error") {
          throw new Error(data?.error || "Video generation failed");
        }
      }
    }

    if (!generated) {
      throw new Error("Video generation stream ended without a result.");
    }

    setButtonProgress(100);
    setStatus({ state: "completed", progress: 100, message: "Done!" });
    appendGenerationDetail({
      stage: "complete",
      message: jobParams.enable_sound
        ? "Video and sound saved locally."
        : "Video saved locally.",
    });
    setTimeout(() => {
      setButtonProgress(0);
      setStatus({ state: "idle", progress: 0, message: "" });
      clearStoredGenerationState();
    }, 2000);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      setButtonProgress(0);
      setStatus({ state: "canceled", progress: 0, message: "Canceled." });
      updatePendingVideo(id, {
        generation: { state: "canceled", progress: 0, message: "Canceled." },
      });
      clearStoredGenerationState();
      return;
    }

    const message =
      error instanceof Error ? error.message : "Video generation failed";
    setButtonProgress(0);
    setStatus({ state: "error", progress: 0, message });
    updatePendingVideo(id, {
      generation: { state: "error", progress: 0, message },
    });
  } finally {
    runtime.abortController = null;
    runtime.activePromptId = "";
  }
}

// Drains the queue one job at a time (video generation is GPU-heavy, so running
// several at once would just thrash VRAM). Driven imperatively — not by a React
// effect — so an enqueue keeps the queue moving even with no page mounted.
async function pump() {
  if (runtime.pumping) return;
  runtime.pumping = true;

  try {
    for (;;) {
      const [next] = useVideoGenerationQueueStore.getState().queue;
      if (!next) break;

      useVideoGenerationQueueStore.setState((state) => ({
        queue: state.queue.filter((job) => job.id !== next.id),
        active: next,
      }));
      await runGenerationJob(next);
      useVideoGenerationQueueStore.setState({ active: null });
    }
  } finally {
    runtime.pumping = false;
  }
}

export const useVideoGenerationQueueStore = create<VideoGenerationQueueState>(
  (set, get) => ({
    queue: [],
    active: null,
    status: { state: "idle", progress: 0, message: "" },
    buttonProgress: 0,
    details: [],
    config: {
      generationTarget: "local",
      runpodPodId: "",
      runpodReady: false,
      requiresSourceImage: true,
      workflowReady: false,
      workflowMessage: "",
      soundWorkflowReady: false,
      soundMessage: "",
      includesAudio: false,
      ko: true,
    },

    setConfig: (config) =>
      set((state) => ({ config: { ...state.config, ...config } })),

    enqueue: (override, link) => {
      const { config } = get();
      const source = override ?? useVideoStore.getState().params;
      if (!source.prompt.trim()) return;
      if (config.requiresSourceImage && !source.source_image) {
        setStatus({
          state: "error",
          progress: 0,
          message: "Add a start image before generating video.",
        });
        return;
      }
      if (!config.workflowReady) {
        setStatus({
          state: "error",
          progress: 0,
          message: config.workflowMessage || "Video workflow is not configured.",
        });
        return;
      }
      if (config.generationTarget === "runpod" && !config.runpodReady) {
        setStatus({
          state: "error",
          progress: 0,
          message:
            "Select a RunPod pod with a ComfyUI URL before generating video.",
        });
        return;
      }
      const soundPassActive = source.enable_sound && !config.includesAudio;
      if (soundPassActive && !config.soundWorkflowReady) {
        setStatus({
          state: "error",
          progress: 0,
          message: config.soundMessage || "Sound workflow is not configured.",
        });
        return;
      }

      const jobParams: VideoGenerationParams = {
        ...source,
        // Generation only uploads the start image into ComfyUI when it looks
        // remote, so a relative `/api/images/...` would reach LoadImage verbatim
        // and fail validation. Absolutize here — the last gate every entry point
        // (gallery import, handoff, Paimon, the situation picker) passes through.
        source_image: source.source_image
          ? toAbsoluteImageUrl(source.source_image)
          : source.source_image,
        // A pipeline that renders its own audio never needs the separate pass;
        // drop any stale toggle so the backend doesn't queue a redundant audio
        // workflow.
        enable_sound: source.enable_sound && !config.includesAudio,
        video_pipeline_settings: { ...source.video_pipeline_settings },
      };
      const id = crypto.randomUUID();
      // The sentinel "ungrouped" filter is not a real workspace, so it queues
      // as no target at all.
      const activeWorkspaceId =
        useMediaWorkspaceStore.getState().byMedia.videos.activeWorkspaceId;

      useVideoStore.getState().addPendingVideo({
        id,
        url: "",
        filename: "",
        contentType: "",
        params: jobParams,
        timestamp: Date.now(),
        generation: {
          state: "queued",
          progress: 0,
          message: config.ko ? "대기열에 추가됨" : "Queued",
        },
      });
      set((state) => ({
        queue: [
          ...state.queue,
          {
            id,
            params: jobParams,
            generationTarget: config.generationTarget,
            runpodPodId:
              config.generationTarget === "runpod"
                ? config.runpodPodId
                : undefined,
            workspaceId:
              activeWorkspaceId && activeWorkspaceId !== UNGROUPED_WORKSPACE_ID
                ? activeWorkspaceId
                : undefined,
            link,
          },
        ],
      }));
      setStatus({ state: "idle", progress: 0, message: "" });
      void pump();
    },

    cancel: (videoId) => {
      const { queue, active } = get();
      const { updatePendingVideo } = useVideoStore.getState();
      const targetId = videoId ?? active?.id;
      if (!targetId) return;

      // A job that is still waiting in the queue can be dropped without
      // touching the running stream.
      if (queue.some((job) => job.id === targetId)) {
        set((state) => ({
          queue: state.queue.filter((job) => job.id !== targetId),
        }));
        updatePendingVideo(targetId, {
          generation: { state: "canceled", progress: 0, message: "Canceled." },
        });
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

      setButtonProgress(0);
      setStatus({ state: "canceled", progress: 0, message: "Canceled." });
      updatePendingVideo(targetId, {
        generation: { state: "canceled", progress: 0, message: "Canceled." },
      });
      appendGenerationDetail({
        stage: "canceled",
        message: "Cancel requested.",
      });
      clearStoredGenerationState();
    },

    restoreStoredState: () => {
      // Only meaningful after a full reload; navigating within the app keeps
      // this store alive, and overwriting live progress would clobber it.
      if (runtime.restored) return;
      runtime.restored = true;
      if (get().active || get().queue.length > 0) return;

      const stored = readStoredGenerationState();
      if (!stored) return;

      set({
        status: stored.status,
        buttonProgress: stored.buttonProgress,
        details: stored.details,
      });
      runtime.activePromptId = stored.activePromptId;

      if (stored.status.state === "generating") {
        appendGenerationDetail({
          stage: "restored",
          message: "Restored local progress after returning to this page.",
        });
      }
    },
  })
);

// Snapshot the generation progress into sessionStorage whenever it changes, so
// a full reload can restore what the user was looking at (the page used to do
// this from a React effect; the store does it now so a run that outlives the
// page keeps its snapshot current too).
useVideoGenerationQueueStore.subscribe((state, prev) => {
  if (
    state.status === prev.status &&
    state.buttonProgress === prev.buttonProgress &&
    state.details === prev.details
  ) {
    return;
  }
  if (
    state.status.state !== "generating" &&
    state.status.state !== "canceled" &&
    state.status.state !== "error"
  ) {
    return;
  }

  writeStoredGenerationState({
    status: state.status,
    buttonProgress: state.buttonProgress,
    activePromptId: runtime.activePromptId,
    details: state.details,
  });
});
