export interface GenerationParams {
  prompt: string;
  negative_prompt: string;
  num_inference_steps: number;
  guidance_scale: number;
  width: number;
  height: number;
  seed: number | null;
  loras: LoraConfig[];
  style_image: string | null;
  character_image: string | null;
  enable_safety_checker: boolean;
}

export interface LoraConfig {
  path: string;
  scale: number;
}

export interface GeneratedImage {
  id: string;
  url: string;
  params: GenerationParams;
  timestamp: number;
  filename: string;
}

export interface GenerationStatus {
  state: "idle" | "uploading" | "generating" | "completed" | "error";
  progress: number;
  message: string;
}

export const DEFAULT_PARAMS: GenerationParams = {
  prompt: "",
  negative_prompt: "low quality, blurry, deformed, ugly, bad anatomy, bad hands, missing fingers",
  num_inference_steps: 30,
  guidance_scale: 7.5,
  width: 1024,
  height: 1024,
  seed: null,
  loras: [],
  style_image: null,
  character_image: null,
  enable_safety_checker: false,
};

export const IMAGE_SIZES = [
  { label: "512×512", width: 512, height: 512 },
  { label: "512×768", width: 512, height: 768 },
  { label: "768×512", width: 768, height: 512 },
  { label: "768×1024", width: 768, height: 1024 },
  { label: "1024×768", width: 1024, height: 768 },
  { label: "1024×1024", width: 1024, height: 1024 },
] as const;
