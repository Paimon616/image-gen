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

function mergeImages(
  existing: GeneratedImage[],
  incoming: GeneratedImage[]
) {
  const imagesById = new Map<string, GeneratedImage>();

  existing.forEach((image) => imagesById.set(image.id, image));
  incoming.forEach((image) => imagesById.set(image.id, image));

  return sortImagesNewestFirst(Array.from(imagesById.values()));
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

  removeImage: (id) =>
    set((s) => ({
      images: s.images.filter((img) => img.id !== id),
      selectedImage: s.selectedImage?.id === id ? null : s.selectedImage,
    })),

  setSelectedImage: (image) => set({ selectedImage: image }),

  loadParamsFromImage: (image) =>
    set({ params: { ...DEFAULT_PARAMS, ...image.params } }),

  resetParams: () => set({ params: DEFAULT_PARAMS }),

  setLanguage: (language) => {
    persistLanguage(language);
    set({ language });
  },
}));
