import { create } from "zustand";
import type { SeedanceVideo } from "./seedance";

type SeedanceListUpdate =
  | SeedanceVideo[]
  | ((prev: SeedanceVideo[]) => SeedanceVideo[]);

interface SeedanceState {
  // Finished, disk-backed videos (fetched from /api/seedance/videos).
  videos: SeedanceVideo[];
  // Client-only in-flight cards (queued / generating / error / canceled) that
  // the running SSE stream updates directly, so navigating away and back never
  // drops an in-flight generation — mirrors the ComfyUI video store.
  pending: SeedanceVideo[];

  setVideos: (update: SeedanceListUpdate) => void;
  addPending: (video: SeedanceVideo) => void;
  updatePending: (id: string, update: Partial<SeedanceVideo>) => void;
  removePending: (id: string) => void;
}

export const useSeedanceStore = create<SeedanceState>((set) => ({
  videos: [],
  pending: [],

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
}));
