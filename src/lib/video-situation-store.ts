import { createSituationVideoStore } from "./situation-video-store";
import { useVideoGenerationQueueStore } from "./video-generation-queue-store";
import { useVideoPaimonStore } from "./video-paimon-store";
import { useVideoStore } from "./video-store";
import { videoDurationPatch, type DurationPipeline } from "./video-duration";
import { toAbsoluteImageUrl } from "./video-reference";

interface DurationPipelineOption extends DurationPipeline {
  id: string;
}

// Which pair of fields carries the clip length depends on the selected pipeline,
// so the metadata is needed to turn "5초" into params. Fetched once and cached at
// module scope: a batch of 20 situations must not refetch it 20 times.
let pipelineCache: DurationPipelineOption[] | null = null;

async function loadDurationPipelines(): Promise<DurationPipelineOption[]> {
  if (pipelineCache) return pipelineCache;
  try {
    const res = await fetch("/api/video/pipelines", { cache: "no-store" });
    const data = (await res.json()) as { pipelines?: DurationPipelineOption[] };
    pipelineCache = Array.isArray(data.pipelines) ? data.pipelines : [];
  } catch {
    pipelineCache = [];
  }
  return pipelineCache;
}

// The ComfyUI video screen's situation runner. The start frame must be an
// absolute URL: generation only uploads the image into ComfyUI when it looks
// remote, and a bare `/api/images/<file>.png` would reach the LoadImage node
// verbatim and fail its validation (see toAbsoluteImageUrl).
export const useVideoSituationStore = createSituationVideoStore({
  paimon: useVideoPaimonStore,
  withNegativePrompt: true,

  hasStartFrame: () => Boolean(useVideoStore.getState().params.source_image),

  applyStartFrame: async (imageUrl) => {
    useVideoStore.getState().setParams((current) => ({
      ...current,
      source_image: toAbsoluteImageUrl(imageUrl),
    }));
    return true;
  },

  applyDuration: async (seconds) => {
    const pipelines = await loadDurationPipelines();
    const { params, setParams } = useVideoStore.getState();
    const pipeline =
      pipelines.find((entry) => entry.id === params.video_pipeline) ??
      pipelines.find((entry) => entry.id === params.video_model);
    const patch = videoDurationPatch(pipeline, params, seconds);
    setParams((current) => ({ ...current, ...patch }));
  },

  // The global queue reads the params back from the store itself: the composing
  // turn wrote the new prompt and start frame there already, and the queue's
  // pump keeps draining with the video page unmounted. The character/situation
  // link rides along so the finished clip registers into that situation.
  enqueue: (link) =>
    useVideoGenerationQueueStore.getState().enqueue(undefined, link),

  requiresStartFrame: () =>
    useVideoGenerationQueueStore.getState().config.requiresSourceImage,
});
