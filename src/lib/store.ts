import { create } from "zustand";
import {
  DEFAULT_PARAMS,
  normalizeImageDimension,
  type CivitaiOrigin,
  type GeneratedImage,
  type GenerationParams,
  type GenerationStatus,
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
  selectedImage: GeneratedImage | null;
  language: AppLanguage;
  civitaiReference: CivitaiOrigin | null;
  civitaiImport: CivitaiImportState;

  setParams: (update: Partial<GenerationParams>) => void;
  setStatus: (status: Partial<GenerationStatus>) => void;
  addImage: (image: GeneratedImage) => void;
  addImages: (images: GeneratedImage[]) => void;
  updateImage: (id: string, update: Partial<GeneratedImage>) => void;
  removeImage: (id: string) => void;
  setSelectedImage: (image: GeneratedImage | null) => void;
  loadParamsFromImage: (image: GeneratedImage) => void;
  resetParams: () => void;
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
  selectedImage: null,
  language: getInitialLanguage(),
  civitaiReference: null,
  civitaiImport: EMPTY_CIVITAI_IMPORT,

  setParams: (update) =>
    set((s) => ({ params: { ...s.params, ...update } })),

  setStatus: (status) =>
    set((s) => ({ status: { ...s.status, ...status } })),

  addImage: (image) =>
    set((s) => ({ images: mergeImages(s.images, [image]) })),

  addImages: (images) =>
    set((s) => ({ images: mergeImages(s.images, images) })),

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
}));
