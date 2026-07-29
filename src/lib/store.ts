import { create } from "zustand";
import {
  DEFAULT_PARAMS,
  normalizeImageDimension,
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
  imagesNextCursor: number | null;
  imagesTotal: number;
  isLoadingMoreImages: boolean;
  selectedImage: GeneratedImage | null;
  language: AppLanguage;
  civitaiReference: CivitaiOrigin | null;
  civitaiImport: CivitaiImportState;
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;

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
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  setImageWorkspace: (
    image: GeneratedImage,
    workspaceId: string,
    assigned: boolean
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

export const useStore = create<AppState>((set) => ({
  params: DEFAULT_PARAMS,
  status: { state: "idle", progress: 0, message: "" },
  images: [],
  imagesNextCursor: null,
  imagesTotal: 0,
  isLoadingMoreImages: false,
  selectedImage: null,
  language: getInitialLanguage(),
  civitaiReference: null,
  civitaiImport: EMPTY_CIVITAI_IMPORT,
  workspaces: [],
  activeWorkspaceId: null,

  setParams: (update) =>
    set((s) => ({ params: { ...s.params, ...update } })),

  setStatus: (status) =>
    set((s) => ({ status: { ...s.status, ...status } })),

  addImage: (image) =>
    set((s) => ({ images: mergeImages(s.images, [image]) })),

  addImages: (images) =>
    set((s) => ({ images: mergeImages(s.images, images) })),

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
      const updatedImages = s.images.map((image) =>
        image.id === id ? { ...image, ...update } : image
      );
      const selectedImage =
        s.selectedImage?.id === id
          ? { ...s.selectedImage, ...update }
          : s.selectedImage;

      return {
        images: mergeImages(updatedImages, []),
        selectedImage,
      };
    }),

  removeImage: (id) =>
    set((s) => ({
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
      });
    } catch {
      // Leave the previous workspace list in place on a transient failure.
    }
  },

  setActiveWorkspace: (workspaceId) => {
    if (useStore.getState().activeWorkspaceId === workspaceId) return;

    // Reset the paginated view so the next fetch rebuilds it for the new filter.
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
    set((s) => ({
      workspaces: s.workspaces.filter(
        (workspace) => workspace.id !== workspaceId
      ),
      images: s.images.map((image) => ({
        ...image,
        workspaces: image.workspaces?.filter((id) => id !== workspaceId),
      })),
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
        const active = s.activeWorkspaceId;
        // When filtering by a workspace, an image removed from it should leave
        // the current grid immediately.
        const dropFromView = Boolean(active && !workspaces.includes(active));

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
}));
