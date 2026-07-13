import { create } from "zustand";
import {
  DEFAULT_PARAMS,
  type CivitaiImportResult,
  type CivitaiOrigin,
  type GeneratedImage,
  type GenerationParams,
  type GenerationStatus,
} from "./types";

interface AppState {
  params: GenerationParams;
  status: GenerationStatus;
  images: GeneratedImage[];
  selectedImage: GeneratedImage | null;
  language: AppLanguage;
  civitaiImport: CivitaiImportResult | null;
  civitaiImportFingerprint: string | null;

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
  setCivitaiImport: (
    result: CivitaiImportResult,
    appliedParams: GenerationParams
  ) => void;
  refreshCivitaiSnapshot: () => void;
  clearCivitaiImport: () => void;
  resolveCivitaiOrigin: (params: GenerationParams) => CivitaiOrigin | undefined;
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

function importParamsFingerprint(params: GenerationParams) {
  const { seed: _seed, ...rest } = params;
  void _seed;
  return JSON.stringify(rest);
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

export const useStore = create<AppState>((set, get) => ({
  params: DEFAULT_PARAMS,
  status: { state: "idle", progress: 0, message: "" },
  images: [],
  selectedImage: null,
  language: getInitialLanguage(),
  civitaiImport: null,
  civitaiImportFingerprint: null,

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
            params: { ...DEFAULT_PARAMS, ...image.params },
            civitaiImport: null,
            civitaiImportFingerprint: null,
          }
        : state
    ),

  resetParams: () =>
    set({
      params: DEFAULT_PARAMS,
      civitaiImport: null,
      civitaiImportFingerprint: null,
    }),

  setLanguage: (language) => {
    persistLanguage(language);
    set({ language });
  },

  setCivitaiImport: (result, appliedParams) =>
    set({
      civitaiImport: result,
      civitaiImportFingerprint: importParamsFingerprint(appliedParams),
    }),

  refreshCivitaiSnapshot: () =>
    set((s) =>
      s.civitaiImport
        ? { civitaiImportFingerprint: importParamsFingerprint(s.params) }
        : {}
    ),

  clearCivitaiImport: () =>
    set({ civitaiImport: null, civitaiImportFingerprint: null }),

  resolveCivitaiOrigin: (params) => {
    const { civitaiImport, civitaiImportFingerprint } = get();

    if (!civitaiImport || civitaiImportFingerprint == null) return undefined;
    if (importParamsFingerprint(params) !== civitaiImportFingerprint) {
      return undefined;
    }
    if (!civitaiImport.imageUrl) return undefined;

    return {
      imageId: civitaiImport.imageId,
      imageUrl: civitaiImport.imageUrl,
      pageUrl: civitaiImport.pageUrl,
      username: civitaiImport.username,
    };
  },
}));
