import { create } from "zustand";
import type { GeneratedVideo } from "./types";

type VideoListUpdate =
  | GeneratedVideo[]
  | ((prev: GeneratedVideo[]) => GeneratedVideo[]);

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

  // Accepts an array or an updater, mirroring React's setState signature.
  setVideos: (update: VideoListUpdate) => void;
  addPendingVideo: (video: GeneratedVideo) => void;
  updatePendingVideo: (id: string, update: Partial<GeneratedVideo>) => void;
  removePendingVideo: (id: string) => void;
}

export const useVideoStore = create<VideoState>((set) => ({
  videos: [],
  pendingVideos: [],

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
}));
