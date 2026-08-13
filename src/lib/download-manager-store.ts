import { create } from "zustand";

// A single, app-wide registry of download activity. Both the local Civitai
// download flow (download-store.ts) and the RunPod pod download flow
// (runpod-download-store.ts) report into this store so the Download Manager
// page can show a unified, persistent view of what is downloading — including
// terminal (complete / error) entries that the source stores discard.
//
// This store is display-only. It never drives a download itself and is not
// consulted for gating logic, so wiring it in cannot change download behavior.

export type DownloadManagerStatus = "downloading" | "complete" | "error";

export type DownloadManagerKind = "local" | "runpod";

export interface DownloadManagerEntry {
  id: string;
  // Primary human-readable name (resource / file name).
  label: string;
  // Secondary detail (type · version, or file path).
  sublabel: string;
  // Where the file is being written (e.g. "로컬 ComfyUI" or "RunPod · <podId>").
  target: string;
  kind: DownloadManagerKind;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  status: DownloadManagerStatus;
  message: string;
  startedAt: number;
  updatedAt: number;
}

export type DownloadManagerPatch = Partial<Omit<DownloadManagerEntry, "id">>;

interface DownloadManagerState {
  entries: Record<string, DownloadManagerEntry>;
  // Create or merge an entry. Missing fields are defaulted on first insert.
  upsert: (id: string, patch: DownloadManagerPatch) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
}

function now() {
  return typeof Date !== "undefined" ? Date.now() : 0;
}

export const useDownloadManagerStore = create<DownloadManagerState>((set) => ({
  entries: {},

  upsert: (id, patch) =>
    set((state) => {
      const existing = state.entries[id];
      const base: DownloadManagerEntry = existing ?? {
        id,
        label: "",
        sublabel: "",
        target: "",
        kind: "local",
        downloadedBytes: 0,
        totalBytes: null,
        percent: null,
        status: "downloading",
        message: "",
        startedAt: now(),
        updatedAt: now(),
      };

      return {
        entries: {
          ...state.entries,
          [id]: { ...base, ...patch, id, updatedAt: now() },
        },
      };
    }),

  remove: (id) =>
    set((state) => {
      if (!state.entries[id]) return state;
      const next = { ...state.entries };
      delete next[id];
      return { entries: next };
    }),

  clearFinished: () =>
    set((state) => {
      const next: Record<string, DownloadManagerEntry> = {};
      for (const [id, entry] of Object.entries(state.entries)) {
        if (entry.status === "downloading") next[id] = entry;
      }
      return { entries: next };
    }),
}));

// Convenience non-hook accessor for use inside other stores' async flows.
export function reportDownload(id: string, patch: DownloadManagerPatch) {
  useDownloadManagerStore.getState().upsert(id, patch);
}

// Stable id helpers so the two source stores agree on entry identity.
export function localDownloadEntryId(key: string) {
  return `local:${key}`;
}

export function runpodDownloadEntryId(podId: string, path: string) {
  return `runpod:${podId}:${path}`;
}
