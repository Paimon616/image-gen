export interface ModelConfig {
  id: string;
  name: string;
  description: string;
  provider: "comfyui";
  supports: {
    lora: boolean;
    embeddings: boolean;
    custom_model: boolean;
    ip_adapter: boolean;
    face_id: boolean;
    negative_prompt: boolean;
  };
  defaults: {
    num_inference_steps: number;
    guidance_scale: number;
  };
}

export const AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: "comfyui/local-sdxl",
    name: "Local ComfyUI",
    description: "Local checkpoint, LoRA, embeddings",
    provider: "comfyui",
    supports: {
      lora: true,
      embeddings: true,
      custom_model: true,
      ip_adapter: false,
      face_id: false,
      negative_prompt: true,
    },
    defaults: { num_inference_steps: 30, guidance_scale: 7.5 },
  },
];

export interface GenerationParams {
  model: string;
  model_name: string;
  prompt: string;
  negative_prompt: string;
  num_inference_steps: number;
  guidance_scale: number;
  width: number;
  height: number;
  num_images: number;
  output_format: "jpeg" | "png";
  generation_mode: "text_to_image" | "pose_reference" | "image_to_image";
  seed: number | null;
  sampler_name: string;
  scheduler: string;
  clip_skip: number;
  vae_name: string;
  upscale_model_name: string;
  loras: LoraConfig[];
  embeddings: EmbeddingConfig[];
  controlnets: ControlNetConfig[];
  prompt_weighting: boolean;
  style_image: string | null;
  character_image: string | null;
  source_image: string | null;
  denoise_strength: number;
  pose_reference_image: string | null;
  pose_reference_model: string;
  pose_reference_strength: number;
  enable_safety_checker: boolean;
}

export interface LoraConfig {
  path: string;
  scale: number;
}

export interface EmbeddingConfig {
  path: string;
  tokens: string;
}

export interface ControlNetConfig {
  model: string;
  image: string | null;
  strength: number;
  start_percent: number;
  end_percent: number;
}

export interface GeneratedImage {
  id: string;
  url: string;
  params: GenerationParams;
  timestamp: number;
  filename: string;
}

export interface GenerationStatus {
  state: "idle" | "uploading" | "generating" | "completed" | "canceled" | "error";
  progress: number;
  message: string;
}

export interface ImportedCivitaiResource {
  type: "checkpoint" | "lora" | "embedding" | "vae" | "upscaler" | "other";
  name: string;
  versionName?: string;
  baseModel?: string;
  weight?: number;
  hash?: string;
  modelId?: number;
  modelVersionId?: number;
  url: string;
}

export interface CivitaiImportResult {
  imageId: number;
  imageUrl: string;
  pageUrl: string;
  username?: string;
  metadataHidden?: boolean;
  warning?: string;
  params: Partial<GenerationParams>;
  resources: ImportedCivitaiResource[];
}

export interface HistoryMissingResource extends ImportedCivitaiResource {
  reason: string;
}

export interface HistoryEntry {
  id: string;
  source: "civitai";
  createdAt: number;
  requestedUrl: string;
  imageId: number;
  imageUrl: string;
  localImageUrl: string | null;
  localImageFilename: string | null;
  pageUrl: string;
  username?: string;
  params: GenerationParams;
  importedParams: Partial<GenerationParams>;
  resources: ImportedCivitaiResource[];
  missingResources: HistoryMissingResource[];
  rawImport: CivitaiImportResult;
}

export const DEFAULT_PARAMS: GenerationParams = {
  model: "comfyui/local-sdxl",
  model_name: "sd_xl_base_1.0.safetensors",
  prompt: "",
  negative_prompt: "low quality, blurry, deformed, ugly, bad anatomy, bad hands, missing fingers",
  num_inference_steps: 30,
  guidance_scale: 7.5,
  width: 1024,
  height: 1024,
  num_images: 1,
  output_format: "jpeg",
  generation_mode: "text_to_image",
  seed: null,
  sampler_name: "dpmpp_2m",
  scheduler: "karras",
  clip_skip: 1,
  vae_name: "",
  upscale_model_name: "",
  loras: [],
  embeddings: [],
  controlnets: [],
  prompt_weighting: true,
  style_image: null,
  character_image: null,
  source_image: null,
  denoise_strength: 0.6,
  pose_reference_image: null,
  pose_reference_model: "",
  pose_reference_strength: 0.8,
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

export const IMAGE_SIZE_CONSTRAINTS = {
  min: 256,
  max: 2048,
  step: 8,
} as const;

export function normalizeImageDimension(value: unknown) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_PARAMS.width;
  }

  const { min, max, step } = IMAGE_SIZE_CONSTRAINTS;
  const steppedValue = Math.round(numericValue / step) * step;

  return Math.min(Math.max(steppedValue, min), max);
}

export function getModelConfig(modelId: string): ModelConfig {
  return AVAILABLE_MODELS.find((m) => m.id === modelId) ?? AVAILABLE_MODELS[0];
}
