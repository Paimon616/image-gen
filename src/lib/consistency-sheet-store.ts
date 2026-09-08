import { create } from "zustand";
import {
  DEFAULT_CONSISTENCY_SHEET_PARAMS,
  type ConsistencySheetImage,
  type ConsistencySheetParams,
} from "./consistency-sheet";

type ListUpdate =
  | ConsistencySheetImage[]
  | ((prev: ConsistencySheetImage[]) => ConsistencySheetImage[]);

type ParamsUpdate =
  | ConsistencySheetParams
  | ((prev: ConsistencySheetParams) => ConsistencySheetParams);

const PARAMS_STORAGE_KEY = "consistency-sheet-params-v2";

// Only the light settings are remembered between sessions; the reference
// images are data URIs and far too large for localStorage.
function persistParams(params: ConsistencySheetParams) {
  if (typeof window === "undefined") return;
  const { mode, workspaceId } = params;
  try {
    window.localStorage.setItem(
      PARAMS_STORAGE_KEY,
      JSON.stringify({ mode, workspaceId })
    );
  } catch {
    /* ignore */
  }
}

// Reading localStorage in the store initializer would desync the server render,
// so the page triggers this once after mount instead.
let hydrated = false;

interface ConsistencySheetState {
  // Finished, disk-backed sheets (fetched from /api/consistency-sheet/images).
  images: ConsistencySheetImage[];
  // Client-only in-flight cards the running SSE stream updates directly, so
  // navigating away and back never drops an in-flight generation.
  pending: ConsistencySheetImage[];

  // The form's inputs. Held here rather than in the page so they survive
  // navigation — and so a Paimon answer that lands while the page is unmounted
  // still applies to the params the user returns to.
  params: ConsistencySheetParams;

  setImages: (update: ListUpdate) => void;
  addPending: (image: ConsistencySheetImage) => void;
  updatePending: (id: string, update: Partial<ConsistencySheetImage>) => void;
  removePending: (id: string) => void;
  setParams: (update: ParamsUpdate) => void;
  // One-time restore of the remembered settings; a no-op after the first call.
  hydrateParams: () => void;
}

export const useConsistencySheetStore = create<ConsistencySheetState>((set) => ({
  images: [],
  pending: [],
  params: DEFAULT_CONSISTENCY_SHEET_PARAMS,

  setImages: (update) =>
    set((s) => ({
      images: typeof update === "function" ? update(s.images) : update,
    })),

  addPending: (image) => set((s) => ({ pending: [image, ...s.pending] })),

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
      const saved = JSON.parse(raw) as Partial<ConsistencySheetParams>;
      set((s) => ({
        params: {
          ...s.params,
          mode: saved.mode === "background" ? "background" : s.params.mode,
          workspaceId:
            typeof saved.workspaceId === "string"
              ? saved.workspaceId
              : s.params.workspaceId,
        },
      }));
    } catch {
      /* ignore */
    }
  },
}));
