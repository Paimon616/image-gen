import { create, type StateCreator } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_PARAMS,
  normalizeImageDimension,
  UNGROUPED_WORKSPACE_ID,
  type CivitaiOrigin,
  type GeneratedImage,
  type GenerationParams,
  type GenerationStatus,
  type WorkspaceSummary,
} from "./types";
import type { MissingResource } from "./civitai-resource-matching";

interface CivitaiImportState {
  url: string;
  status: string;
  missingResources: MissingResource[];
  resetVersion: number;
}

const EMPTY_CIVITAI_IMPORT: CivitaiImportState = {
  url: "",
  status: "",
  missingResources: [],
  resetVersion: 0,
};

interface AppState {
  params: GenerationParams;
  status: GenerationStatus;
  images: GeneratedImage[];
  // Client-only generation cards (queued / generating / just-failed) that have
  // not been persisted to disk yet. Kept separate from `images` so switching
  // workspaces — which clears and refetches `images` — never drops an in-flight
  // generation. The gallery merges these back in, filtered by workspace.
  pendingImages: GeneratedImage[];
  imagesNextCursor: number | null;
  imagesTotal: number;
  isLoadingMoreImages: boolean;
  selectedImage: GeneratedImage | null;
  language: AppLanguage;
  civitaiReference: CivitaiOrigin | null;
  civitaiImport: CivitaiImportState;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  ungroupedCount: number;

  setParams: (update: Partial<GenerationParams>) => void;
  setStatus: (status: Partial<GenerationStatus>) => void;
  addImage: (image: GeneratedImage) => void;
  addImages: (images: GeneratedImage[]) => void;
  fetchImagePage: (cursor: number) => Promise<void>;
  updateImage: (id: string, update: Partial<GeneratedImage>) => void;
  removeImage: (id: string) => void;
  setSelectedImage: (image: GeneratedImage | null) => void;
  loadParamsFromImage: (image: GeneratedImage) => void;
  resetParams: () => void;
  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (workspaceId: string | null) => void;
  createWorkspace: (name: string) => Promise<WorkspaceSummary | null>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<void>;
  reorderWorkspaces: (orderedIds: string[]) => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  setImageWorkspace: (
    image: GeneratedImage,
    workspaceId: string,
    assigned: boolean
  ) => Promise<void>;
  setImageWorkspaces: (
    image: GeneratedImage,
    workspaceIds: string[]
  ) => Promise<void>;
  setLanguage: (language: AppLanguage) => void;
  setCivitaiReference: (origin: CivitaiOrigin | null) => void;
  clearCivitaiReference: () => void;
  setCivitaiImport: (update: Partial<CivitaiImportState>) => void;
  updateCivitaiImportMissing: (
    updater: (resources: MissingResource[]) => MissingResource[]
  ) => void;
  resetCivitaiImport: () => void;
}

export type AppLanguage = "ko" | "en";

const LANGUAGE_STORAGE_KEY = "image-gen-language";
// The generation form's inputs are persisted under their own key so the values a
// user dialed in survive navigating away from the page and a full reload.
const PARAMS_STORAGE_KEY = "image-gen:params";
const IMAGE_PAGE_SIZE = 18;

function getInitialLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "ko";
  }

  const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return savedLanguage === "en" ? "en" : "ko";
}

function persistLanguage(language: AppLanguage) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  document.documentElement.lang = language;
}

function sortImagesNewestFirst(images: GeneratedImage[]) {
  return [...images].sort((a, b) => b.timestamp - a.timestamp);
}

export function imageMatchesWorkspace(
  image: GeneratedImage,
  workspaceId: string | null
) {
  if (workspaceId === null) return true;
  if (workspaceId === UNGROUPED_WORKSPACE_ID) {
    return (image.workspaces ?? []).length === 0;
  }
  return (image.workspaces ?? []).includes(workspaceId);
}

function imageIdentityKeys(image: GeneratedImage) {
  return [
    image.filename,
    image.url,
    image.filename ? `/api/images/${image.filename}` : "",
    image.id,
  ].filter(Boolean);
}

function mergeImages(
  existing: GeneratedImage[],
  incoming: GeneratedImage[]
) {
  const imagesByKey = new Map<string, GeneratedImage>();
  const mergedImages: GeneratedImage[] = [];

  const forgetImage = (image: GeneratedImage) => {
    imageIdentityKeys(image).forEach((key) => {
      if (imagesByKey.get(key) === image) {
        imagesByKey.delete(key);
      }
    });
  };

  const rememberImage = (image: GeneratedImage) => {
    const existingImage = imageIdentityKeys(image)
      .map((key) => imagesByKey.get(key))
      .find(Boolean);
    const mergedImage = existingImage
      ? {
          ...existingImage,
          ...image,
          id: image.id || existingImage.id,
          generation: existingImage.generation ?? image.generation,
        }
      : image;

    if (existingImage) {
      const index = mergedImages.indexOf(existingImage);

      forgetImage(existingImage);
      if (index >= 0) {
        mergedImages[index] = mergedImage;
      }
    } else {
      mergedImages.push(mergedImage);
    }

    imageIdentityKeys(mergedImage).forEach((key) => imagesByKey.set(key, mergedImage));
  };

  [...existing, ...incoming].forEach(rememberImage);

  return sortImagesNewestFirst(mergedImages);
}

const createAppState: StateCreator<AppState> = (set) => ({
  params: DEFAULT_PARAMS,
  status: { state: "idle", progress: 0, message: "" },
  images: [],
  pendingImages: [],
  imagesNextCursor: null,
  imagesTotal: 0,
  isLoadingMoreImages: false,
  selectedImage: null,
  language: getInitialLanguage(),
  civitaiReference: null,
  civitaiImport: EMPTY_CIVITAI_IMPORT,
  workspaces: [],
  activeWorkspaceId: null,
  ungroupedCount: 0,

  setParams: (update) =>
    set((s) => ({ params: { ...s.params, ...update } })),

  setStatus: (status) =>
    set((s) => ({ status: { ...s.status, ...status } })),

  addImage: (image) =>
    set((s) => {
      // A card without a filename is a client-only generation placeholder.
      if (!image.filename) {
        const exists = s.pendingImages.some((p) => p.id === image.id);
        return {
          pendingImages: exists
            ? s.pendingImages.map((p) =>
                p.id === image.id ? { ...p, ...image } : p
              )
            : [image, ...s.pendingImages],
        };
      }

      // A persisted image only enters the current view if it matches the filter.
      if (!imageMatchesWorkspace(image, s.activeWorkspaceId)) return {};
      return { images: mergeImages(s.images, [image]) };
    }),

  addImages: (images) =>
    set((s) => {
      const matching = images.filter((image) =>
        imageMatchesWorkspace(image, s.activeWorkspaceId)
      );
      return matching.length
        ? { images: mergeImages(s.images, matching) }
        : {};
    }),

  fetchImagePage: async (cursor) => {
    if (useStore.getState().isLoadingMoreImages) return;

    const workspaceId = useStore.getState().activeWorkspaceId;
    set({ isLoadingMoreImages: true });
    try {
      const query = new URLSearchParams({
        cursor: String(cursor),
        limit: String(IMAGE_PAGE_SIZE),
      });
      if (workspaceId) query.set("workspaceId", workspaceId);

      const response = await fetch(`/api/images?${query.toString()}`, {
        cache: "no-store",
      });
      const data = await response.json();
      const loaded = Array.isArray(data.images)
        ? (data.images as GeneratedImage[])
        : [];

      set((s) => {
        // A workspace switch happened while this page was in flight — discard
        // the stale results so they don't leak into the new filtered view.
        if (s.activeWorkspaceId !== workspaceId) return {};

        return {
          images: mergeImages(s.images, loaded),
          imagesNextCursor: data.nextCursor ?? null,
          imagesTotal:
            typeof data.total === "number" ? data.total : s.imagesTotal,
        };
      });
    } finally {
      set({ isLoadingMoreImages: false });
    }
  },

  updateImage: (id, update) =>
    set((s) => {
      const selectedImage =
        s.selectedImage?.id === id
          ? { ...s.selectedImage, ...update }
          : s.selectedImage;

      const pendingIndex = s.pendingImages.findIndex((p) => p.id === id);

      if (pendingIndex >= 0) {
        const merged = { ...s.pendingImages[pendingIndex], ...update };

        // Once the generation produces a saved file the card graduates from the
        // pending list into the persisted view — but only if it matches the
        // active workspace filter (a result for workspace A shouldn't pop into
        // workspace B's view).
        if (merged.filename) {
          return {
            pendingImages: s.pendingImages.filter((p) => p.id !== id),
            images: imageMatchesWorkspace(merged, s.activeWorkspaceId)
              ? mergeImages(s.images, [merged])
              : s.images,
            selectedImage,
          };
        }

        return {
          pendingImages: s.pendingImages.map((p) =>
            p.id === id ? merged : p
          ),
          selectedImage,
        };
      }

      const updatedImages = s.images.map((image) =>
        image.id === id ? { ...image, ...update } : image
      );

      return {
        images: mergeImages(updatedImages, []),
        selectedImage,
      };
    }),

  removeImage: (id) =>
    set((s) => ({
      pendingImages: s.pendingImages.filter((p) => p.id !== id),
      images: s.images.filter((img) => img.id !== id),
      selectedImage: s.selectedImage?.id === id ? null : s.selectedImage,
    })),

  setSelectedImage: (image) => set({ selectedImage: image }),

  loadParamsFromImage: (image) =>
    set((state) =>
      image.params
        ? {
            params: {
              ...DEFAULT_PARAMS,
              ...image.params,
              ...(image.sizeSemantics === "final" ||
              !image.params.hires_upscale ||
              image.params.hires_upscale <= 1
                ? {}
                : {
                    width: normalizeImageDimension(
                      image.params.width * image.params.hires_upscale
                    ),
                    height: normalizeImageDimension(
                      image.params.height * image.params.hires_upscale
                    ),
                  }),
            },
            civitaiReference: null,
            civitaiImport: {
              ...EMPTY_CIVITAI_IMPORT,
              resetVersion: state.civitaiImport.resetVersion + 1,
            },
          }
        : state
    ),

  resetParams: () => set({ params: DEFAULT_PARAMS }),

  setLanguage: (language) => {
    persistLanguage(language);
    set({ language });
  },

  setCivitaiReference: (origin) => set({ civitaiReference: origin }),

  clearCivitaiReference: () => set({ civitaiReference: null }),

  setCivitaiImport: (update) =>
    set((s) => ({ civitaiImport: { ...s.civitaiImport, ...update } })),

  updateCivitaiImportMissing: (updater) =>
    set((s) => ({
      civitaiImport: {
        ...s.civitaiImport,
        missingResources: updater(s.civitaiImport.missingResources),
      },
    })),

  resetCivitaiImport: () =>
    set((state) => ({
      civitaiImport: {
        ...EMPTY_CIVITAI_IMPORT,
        resetVersion: state.civitaiImport.resetVersion + 1,
      },
    })),

  fetchWorkspaces: async () => {
    try {
      const response = await fetch("/api/workspaces", { cache: "no-store" });
      const data = await response.json();
      set({
        workspaces: Array.isArray(data.workspaces)
          ? (data.workspaces as WorkspaceSummary[])
          : [],
        ungroupedCount:
          typeof data.ungroupedCount === "number" ? data.ungroupedCount : 0,
      });
    } catch {
      // Leave the previous workspace list in place on a transient failure.
    }
  },

  setActiveWorkspace: (workspaceId) => {
    if (useStore.getState().activeWorkspaceId === workspaceId) return;

    // Reset only the paginated (server-backed) view so the next fetch rebuilds
    // it for the new filter. `pendingImages` is intentionally left alone so
    // in-flight generations survive the switch and reappear in every view they
    // belong to.
    set({
      activeWorkspaceId: workspaceId,
      images: [],
      imagesNextCursor: null,
      imagesTotal: 0,
      isLoadingMoreImages: false,
    });
    void useStore.getState().fetchImagePage(0);
  },

  createWorkspace: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return null;

    try {
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) return null;

      const data = await response.json();
      const workspace = data.workspace as WorkspaceSummary | undefined;
      if (!workspace) return null;

      set((s) => ({ workspaces: [...s.workspaces, workspace] }));
      return workspace;
    } catch {
      return null;
    }
  },

  renameWorkspace: async (workspaceId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!response.ok) return;

      set((s) => ({
        workspaces: s.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? { ...workspace, name: trimmed }
            : workspace
        ),
      }));
    } catch {
      // Ignore transient rename failures.
    }
  },

  // Applies a drag-and-drop reorder optimistically, then persists it. The list
  // is restored if the write fails so the UI never shows an order the server
  // did not accept.
  reorderWorkspaces: async (orderedIds) => {
    const previous = useStore.getState().workspaces;
    const byId = new Map(previous.map((workspace) => [workspace.id, workspace]));
    const next: WorkspaceSummary[] = [];

    for (const id of orderedIds) {
      const workspace = byId.get(id);
      if (!workspace) continue;
      next.push(workspace);
      byId.delete(id);
    }
    for (const workspace of previous) {
      if (byId.has(workspace.id)) next.push(workspace);
    }

    if (next.length !== previous.length) return;
    set({ workspaces: next });

    try {
      const response = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds: next.map((w) => w.id) }),
      });
      if (!response.ok) throw new Error("reorder failed");
    } catch {
      set({ workspaces: previous });
    }
  },

  deleteWorkspace: async (workspaceId) => {
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: "DELETE",
      });
      if (!response.ok) return;
    } catch {
      return;
    }

    const wasActive = useStore.getState().activeWorkspaceId === workspaceId;
    const stripWorkspace = (image: GeneratedImage) => ({
      ...image,
      workspaces: image.workspaces?.filter((id) => id !== workspaceId),
    });
    set((s) => ({
      workspaces: s.workspaces.filter(
        (workspace) => workspace.id !== workspaceId
      ),
      images: s.images.map(stripWorkspace),
      pendingImages: s.pendingImages.map(stripWorkspace),
    }));

    // Deleting the workspace you are viewing falls back to the "all" view.
    if (wasActive) useStore.getState().setActiveWorkspace(null);
  },

  setImageWorkspace: async (image, workspaceId, assigned) => {
    if (!image.filename) return;

    try {
      const response = await fetch(
        `/api/images/${image.filename}/workspaces`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, assigned }),
        }
      );
      if (!response.ok) return;

      const data = await response.json();
      const workspaces = Array.isArray(data.workspaces)
        ? (data.workspaces as string[])
        : [];

      set((s) => {
        // When a filter is active, an image that no longer matches it should
        // leave the current grid immediately (covers real workspaces and the
        // "ungrouped" filter).
        const dropFromView =
          s.activeWorkspaceId !== null &&
          !imageMatchesWorkspace({ ...image, workspaces }, s.activeWorkspaceId);

        return {
          images: dropFromView
            ? s.images.filter((img) => img.id !== image.id)
            : s.images.map((img) =>
                img.id === image.id ? { ...img, workspaces } : img
              ),
          selectedImage:
            s.selectedImage?.id === image.id
              ? { ...s.selectedImage, workspaces }
              : s.selectedImage,
        };
      });
    } catch {
      return;
    }

    void useStore.getState().fetchWorkspaces();
  },

  setImageWorkspaces: async (image, workspaceIds) => {
    if (!image.filename) return;

    try {
      const response = await fetch(
        `/api/images/${image.filename}/workspaces`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceIds }),
        }
      );
      if (!response.ok) return;

      const data = await response.json();
      const workspaces = Array.isArray(data.workspaces)
        ? (data.workspaces as string[])
        : [];

      set((s) => {
        const dropFromView =
          s.activeWorkspaceId !== null &&
          !imageMatchesWorkspace({ ...image, workspaces }, s.activeWorkspaceId);

        return {
          images: dropFromView
            ? s.images.filter((img) => img.id !== image.id)
            : s.images.map((img) =>
                img.id === image.id ? { ...img, workspaces } : img
              ),
          selectedImage:
            s.selectedImage?.id === image.id
              ? { ...s.selectedImage, workspaces }
              : s.selectedImage,
        };
      });
    } catch {
      return;
    }

    void useStore.getState().fetchWorkspaces();
  },
});

// Only the generation form's inputs are persisted. Everything else in the store
// is either server-backed (images, workspaces) or per-visit (status, selection),
// so restoring it would show stale data.
interface PersistedAppState {
  params: GenerationParams;
}

export const useStore = create<AppState>()(
  persist(createAppState, {
    name: PARAMS_STORAGE_KEY,
    version: 1,
    // Rehydration is deferred to after mount (see <StoreHydration />) so the
    // first client render matches the server-rendered HTML.
    skipHydration: true,
    partialize: (state): PersistedAppState => ({ params: state.params }),
    // Layer the saved values over the current defaults so params added after the
    // snapshot was written still get their default instead of `undefined`.
    merge: (persisted, current) => {
      const savedParams = (persisted as Partial<PersistedAppState> | undefined)
        ?.params;
      return savedParams
        ? { ...current, params: { ...DEFAULT_PARAMS, ...savedParams } }
        : current;
    },
  })
);

// Reading localStorage while the store is created would desync the server
// render, so the page triggers the restore once after mount instead.
let paramsRehydrated = false;

export function hydratePersistedParams() {
  if (paramsRehydrated || typeof window === "undefined") return;
  paramsRehydrated = true;
  void useStore.persist.rehydrate();
}
