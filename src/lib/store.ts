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

  setParams: (update: Partial<GenerationParams>) => void;
  setStatus: (status: Partial<GenerationStatus>) => void;
  addImage: (image: GeneratedImage) => void;
  removeImage: (id: string) => void;
  setSelectedImage: (image: GeneratedImage | null) => void;
  loadParamsFromImage: (image: GeneratedImage) => void;
  resetParams: () => void;
}

export const useStore = create<AppState>((set) => ({
  params: DEFAULT_PARAMS,
  status: { state: "idle", progress: 0, message: "" },
  images: [],
  selectedImage: null,

  setParams: (update) =>
    set((s) => ({ params: { ...s.params, ...update } })),

  setStatus: (status) =>
    set((s) => ({ status: { ...s.status, ...status } })),

  addImage: (image) =>
    set((s) => ({ images: [image, ...s.images] })),

  removeImage: (id) =>
    set((s) => ({
      images: s.images.filter((img) => img.id !== id),
      selectedImage: s.selectedImage?.id === id ? null : s.selectedImage,
    })),

  setSelectedImage: (image) => set({ selectedImage: image }),

  loadParamsFromImage: (image) =>
    set({ params: { ...DEFAULT_PARAMS, ...image.params } }),

  resetParams: () => set({ params: DEFAULT_PARAMS }),
}));
