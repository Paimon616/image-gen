import { create } from "zustand";
import {
  DEFAULT_SEEDANCE_PARAMS,
  type SeedanceParams,
  type SeedanceVideo,
} from "./seedance";

type SeedanceListUpdate =
  | SeedanceVideo[]
  | ((prev: SeedanceVideo[]) => SeedanceVideo[]);

type SeedanceParamsUpdate =
  | SeedanceParams
  | ((prev: SeedanceParams) => SeedanceParams);

const PARAMS_STORAGE_KEY = "seedance-params-v1";

// Only the light, non-image settings are remembered between sessions; the
// frames themselves are data URIs and far too large for localStorage.
function persistParams(params: SeedanceParams) {
  if (typeof window === "undefined") return;
  const { resolution, ratio, duration, cameraFixed, watermark, cleanFrame, mode } =
    params;
  try {
    window.localStorage.setItem(
      PARAMS_STORAGE_KEY,
      JSON.stringify({
        resolution,
        ratio,
        duration,
        cameraFixed,
        watermark,
        cleanFrame,
        mode,
      })
    );
  } catch {
    /* ignore */
  }
}

// Reading localStorage in the store initializer would desync the server render,
// so the page triggers this once after mount instead.
let hydrated = false;

interface SeedanceState {
  // Finished, disk-backed videos (fetched from /api/seedance/videos).
  videos: SeedanceVideo[];
  // Client-only in-flight cards (queued / generating / error / canceled) that
  // the running SSE stream updates directly, so navigating away and back never
  // drops an in-flight generation — mirrors the ComfyUI video store.
  pending: SeedanceVideo[];

  // The form's inputs. Held here rather than in the page so they survive
  // navigating away and back — and so a Paimon answer that lands while the page
  // is unmounted still applies to the params the user returns to.
  params: SeedanceParams;

  setVideos: (update: SeedanceListUpdate) => void;
  addPending: (video: SeedanceVideo) => void;
  updatePending: (id: string, update: Partial<SeedanceVideo>) => void;
  removePending: (id: string) => void;
  setParams: (update: SeedanceParamsUpdate) => void;
  // One-time restore of the remembered settings; a no-op after the first call.
  hydrateParams: () => void;
}

export const useSeedanceStore = create<SeedanceState>((set) => ({
  videos: [],
  pending: [],
  params: DEFAULT_SEEDANCE_PARAMS,

  setVideos: (update) =>
    set((s) => ({
      videos: typeof update === "function" ? update(s.videos) : update,
    })),

  addPending: (video) => set((s) => ({ pending: [video, ...s.pending] })),

  updatePending: (id, update) =>
    set((s) => ({
      pending: s.pending.map((v) => (v.id === id ? { ...v, ...update } : v)),
    })),

  removePending: (id) =>
    set((s) => ({ pending: s.pending.filter((v) => v.id !== id) })),

  setParams: (update) =>
    set((s) => {
      const params = typeof update === "function" ? update(s.params) : update;
      persistParams(params);
      return { params };
    }),

  hydrateParams: () => {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    try {
      const raw = window.localStorage.getItem(PARAMS_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<SeedanceParams>;
      set((s) => ({
        params: {
          ...s.params,
          resolution: saved.resolution ?? s.params.resolution,
          ratio: saved.ratio ?? s.params.ratio,
          duration: saved.duration ?? s.params.duration,
          cameraFixed: saved.cameraFixed ?? s.params.cameraFixed,
          watermark: saved.watermark ?? s.params.watermark,
          cleanFrame: saved.cleanFrame ?? s.params.cleanFrame,
          mode: saved.mode ?? s.params.mode,
        },
      }));
    } catch {
      /* ignore */
    }
  },
}));
