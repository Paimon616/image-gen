import { create } from "zustand";
import {
  DEFAULT_SEEDREAM_PARAMS,
  resolveSeedreamModel,
  resolveSeedreamTier,
  SEEDREAM_ASPECT_RATIOS,
  SEEDREAM_MODELS,
  type SeedreamAspectRatio,
  type SeedreamImage,
  type SeedreamParams,
} from "./seedream";

type ListUpdate = SeedreamImage[] | ((prev: SeedreamImage[]) => SeedreamImage[]);

type ParamsUpdate =
  | SeedreamParams
  | ((prev: SeedreamParams) => SeedreamParams);

const PARAMS_STORAGE_KEY = "seedream-params-v1";

// Only the light settings are remembered between sessions; the reference images
// are data URIs and far too large for localStorage.
function persistParams(params: SeedreamParams) {
  if (typeof window === "undefined") return;
  const { model, tier, ratio, watermark, workspaceId } = params;
  try {
    window.localStorage.setItem(
      PARAMS_STORAGE_KEY,
      JSON.stringify({ model, tier, ratio, watermark, workspaceId })
    );
  } catch {
    /* ignore */
  }
}

// Reading localStorage in the store initializer would desync the server render,
// so the page triggers this once after mount instead.
let hydrated = false;

interface SeedreamState {
  /** Finished renders, newest first. Seeded from the gallery feed on mount. */
  images: SeedreamImage[];
  /**
   * Client-only in-flight cards the running SSE stream updates directly, so
   * navigating away and back never drops an in-flight generation.
   */
  pending: SeedreamImage[];
  /** The form's inputs. Held here so they survive navigation. */
  params: SeedreamParams;
  /**
   * Last non-fatal message from a finished run — e.g. references ModelArk
   * would have refused and the server dropped. Not an error: the image was
   * still rendered, just with fewer references than were picked.
   */
  notice: string | null;

  setImages: (update: ListUpdate) => void;
  setNotice: (notice: string | null) => void;
  addPending: (image: SeedreamImage) => void;
  updatePending: (id: string, update: Partial<SeedreamImage>) => void;
  removePending: (id: string) => void;
  setParams: (update: ParamsUpdate) => void;
  /** One-time restore of the remembered settings; a no-op after the first call. */
  hydrateParams: () => void;
}

export const useSeedreamStore = create<SeedreamState>((set) => ({
  images: [],
  pending: [],
  params: DEFAULT_SEEDREAM_PARAMS,
  notice: null,

  setImages: (update) =>
    set((s) => ({
      images: typeof update === "function" ? update(s.images) : update,
    })),

  setNotice: (notice) => set({ notice }),

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
      // A model switch can leave a tier the new model refuses (pro tops out at
      // 2k) or more references than it accepts, so both are re-clamped here
      // rather than in every caller.
      const model = resolveSeedreamModel(params.model);
      const clamped: SeedreamParams = {
        ...params,
        tier: resolveSeedreamTier(model, params.tier),
        references: params.references.slice(0, model.maxReferences),
      };
      persistParams(clamped);
      return { params: clamped };
    }),

  hydrateParams: () => {
    if (hydrated || typeof window === "undefined") return;
    hydrated = true;
    try {
      const raw = window.localStorage.getItem(PARAMS_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<SeedreamParams>;
      set((s) => {
        const model = SEEDREAM_MODELS.some((m) => m.id === saved.model)
          ? resolveSeedreamModel(saved.model)
          : resolveSeedreamModel(s.params.model);
        return {
          params: {
            ...s.params,
            model: model.id,
            tier: resolveSeedreamTier(model, saved.tier ?? s.params.tier),
            ratio: SEEDREAM_ASPECT_RATIOS.includes(
              saved.ratio as SeedreamAspectRatio
            )
              ? (saved.ratio as SeedreamAspectRatio)
              : s.params.ratio,
            watermark:
              typeof saved.watermark === "boolean"
                ? saved.watermark
                : s.params.watermark,
            workspaceId:
              typeof saved.workspaceId === "string"
                ? saved.workspaceId
                : s.params.workspaceId,
          },
        };
      });
    } catch {
      /* ignore */
    }
  },
}));
