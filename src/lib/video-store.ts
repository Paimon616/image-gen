import { create, type StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_VIDEO_PARAMS, type GeneratedVideo, type VideoGenerationParams } from "./types";

// The video form's inputs are persisted under their own key so the values a user
// dialed in survive navigating away from the page and a full reload.
const VIDEO_PARAMS_STORAGE_KEY = "image-gen:video-params";

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

const createVideoState: StateCreator<VideoState> = (set) => ({
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
});

// Only the form inputs are persisted; the video lists are server-backed or hold
// in-flight cards that belong to this visit only.
interface PersistedVideoState {
  params: VideoGenerationParams;
}

export const useVideoStore = create<VideoState>()(
  persist(createVideoState, {
    name: VIDEO_PARAMS_STORAGE_KEY,
    version: 1,
    // Rehydration is deferred to after mount (see <StoreHydration />) so the
    // first client render matches the server-rendered HTML.
    skipHydration: true,
    partialize: (state): PersistedVideoState => ({ params: state.params }),
    // Layer the saved values over the current defaults so params added after the
    // snapshot was written still get their default instead of `undefined`.
    merge: (persisted, current) => {
      const savedParams = (persisted as Partial<PersistedVideoState> | undefined)
        ?.params;
      return savedParams
        ? { ...current, params: { ...DEFAULT_VIDEO_PARAMS, ...savedParams } }
        : current;
    },
  })
);

// Reading localStorage while the store is created would desync the server
// render, so the page triggers the restore once after mount instead.
let videoParamsRehydrated = false;

export function hydratePersistedVideoParams() {
  if (videoParamsRehydrated || typeof window === "undefined") return;
  videoParamsRehydrated = true;
  void useVideoStore.persist.rehydrate();
}
