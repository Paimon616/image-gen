import { create } from "zustand";
import {
  DEFAULT_PARAMS,
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

  const rememberImage = (image: GeneratedImage) => {
    imageIdentityKeys(image).forEach((key) => imagesByKey.set(key, image));
  };

  existing.forEach(rememberImage);
  incoming.forEach((image) => {
    const existingImage = imageIdentityKeys(image)
      .map((key) => imagesByKey.get(key))
      .find(Boolean);
    const mergedImage = existingImage
      ? {
          ...existingImage,
          ...image,
          id: existingImage.id,
          generation: existingImage.generation ?? image.generation,
        }
      : image;

    rememberImage(mergedImage);
  });

  return sortImagesNewestFirst(Array.from(new Set(imagesByKey.values())));
}

export const useStore = create<AppState>((set) => ({
  params: DEFAULT_PARAMS,
  status: { state: "idle", progress: 0, message: "" },
  images: [],
  selectedImage: null,
  language: getInitialLanguage(),

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
      const images = s.images.map((image) =>
        image.id === id ? { ...image, ...update, id } : image
      );
      const selectedImage =
        s.selectedImage?.id === id
          ? { ...s.selectedImage, ...update, id }
          : s.selectedImage;

      return {
        images: sortImagesNewestFirst(images),
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
        ? { params: { ...DEFAULT_PARAMS, ...image.params } }
        : state
    ),

  resetParams: () => set({ params: DEFAULT_PARAMS }),

  setLanguage: (language) => {
    persistLanguage(language);
    set({ language });
  },
}));
