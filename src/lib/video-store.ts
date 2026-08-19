import { create } from "zustand";
import { DEFAULT_VIDEO_PARAMS, type GeneratedVideo, type VideoGenerationParams } from "./types";

type VideoListUpdate =
  | GeneratedVideo[]
  | ((prev: GeneratedVideo[]) => GeneratedVideo[]);

type VideoParamsUpdate =
  | VideoGenerationParams
  | ((prev: VideoGenerationParams) => VideoGenerationParams);

interface VideoState {
  // Server-backed, finished videos. Refetched on mount, but held in the store
  // (not component state) so a generation that finishes in a detached stream —
  // after the user navigated away and back — still lands in the list instead of
  // being lost to the old, unmounted component.
  videos: GeneratedVideo[];

  // Client-only in-flight generation cards (queued / generating / error /
  // canceled) that have not been persisted to disk yet. Kept in a module-level
  // store — not component state — so navigating away from the video page and
  // back never drops an in-flight generation, mirroring the image gallery's
  // `pendingImages`. The running SSE stream writes to this store directly, so a
  // stream detached by an unmount keeps its card current in the background.
  pendingVideos: GeneratedVideo[];

  // The video form's inputs. Held here rather than in the page so they survive
  // navigating away and back — and so a Paimon answer that lands while the page
  // is unmounted still applies its patch to the params the user comes back to.
  params: VideoGenerationParams;

  // Accepts an array or an updater, mirroring React's setState signature.
  setVideos: (update: VideoListUpdate) => void;
  addPendingVideo: (video: GeneratedVideo) => void;
  updatePendingVideo: (id: string, update: Partial<GeneratedVideo>) => void;
  removePendingVideo: (id: string) => void;
  setParams: (update: VideoParamsUpdate) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  videos: [],
  pendingVideos: [],
  params: DEFAULT_VIDEO_PARAMS,

  setVideos: (update) =>
    set((s) => ({
      videos: typeof update === "function" ? update(s.videos) : update,
    })),

  addPendingVideo: (video) =>
    set((s) => ({ pendingVideos: [video, ...s.pendingVideos] })),

  updatePendingVideo: (id, update) =>
    set((s) => ({
      pendingVideos: s.pendingVideos.map((video) =>
        video.id === id ? { ...video, ...update } : video
      ),
    })),

  removePendingVideo: (id) =>
    set((s) => ({
      pendingVideos: s.pendingVideos.filter((video) => video.id !== id),
    })),

  setParams: (update) =>
    set((s) => ({
      params: typeof update === "function" ? update(s.params) : update,
    })),
}));
