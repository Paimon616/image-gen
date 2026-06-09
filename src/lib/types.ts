export interface ModelConfig {
  id: string;
  name: string;
  description: string;
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
    id: "fal-ai/fast-sdxl",
    name: "SDXL",
    description: "Fast SDXL generation",
    supports: {
      lora: true,
      embeddings: true,
      custom_model: false,
      ip_adapter: false,
      face_id: false,
      negative_prompt: true,
    },
    defaults: { num_inference_steps: 30, guidance_scale: 7.5 },
  },
  {
    id: "fal-ai/lora",
    name: "Custom SD + LoRA",
    description: "Custom checkpoint, LoRA, embeddings",
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
  {
    id: "fal-ai/flux/dev",
    name: "Flux Dev",
    description: "High quality, slower",
    supports: {
      lora: false,
      embeddings: false,
      custom_model: false,
      ip_adapter: false,
      face_id: false,
      negative_prompt: false,
    },
    defaults: { num_inference_steps: 28, guidance_scale: 3.5 },
  },
  {
    id: "fal-ai/flux/schnell",
    name: "Flux Schnell",
    description: "Ultra fast, 4 steps",
    supports: {
      lora: false,
      embeddings: false,
      custom_model: false,
      ip_adapter: false,
      face_id: false,
      negative_prompt: false,
    },
    defaults: { num_inference_steps: 4, guidance_scale: 0 },
  },
  {
    id: "fal-ai/flux-lora",
    name: "Flux + LoRA",
    description: "Flux with LoRA support",
    supports: {
      lora: true,
      embeddings: false,
      custom_model: false,
      ip_adapter: false,
      face_id: false,
      negative_prompt: false,
    },
    defaults: { num_inference_steps: 28, guidance_scale: 3.5 },
  },
  {
    id: "fal-ai/stable-diffusion-v35-large",
    name: "SD 3.5 Large",
    description: "Latest SD architecture",
    supports: {
      lora: true,
      embeddings: false,
      custom_model: false,
      ip_adapter: false,
      face_id: false,
      negative_prompt: true,
    },
    defaults: { num_inference_steps: 28, guidance_scale: 4.5 },
  },
  {
    id: "fal-ai/ip-adapter-face-id",
    name: "IP-Adapter FaceID",
    description: "Character reference (needs face image)",
    supports: {
      lora: true,
      embeddings: false,
      custom_model: false,
      ip_adapter: true,
      face_id: true,
      negative_prompt: true,
    },
    defaults: { num_inference_steps: 30, guidance_scale: 7.5 },
  },
  {
    id: "fal-ai/ip-adapter",
    name: "IP-Adapter",
    description: "Style reference (needs style image)",
    supports: {
      lora: true,
      embeddings: false,
      custom_model: false,
      ip_adapter: true,
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
  seed: number | null;
  loras: LoraConfig[];
  embeddings: EmbeddingConfig[];
  prompt_weighting: boolean;
  style_image: string | null;
  character_image: string | null;
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
  model: "fal-ai/fast-sdxl",
  model_name: "stabilityai/stable-diffusion-xl-base-1.0",
  prompt: "",
  negative_prompt: "low quality, blurry, deformed, ugly, bad anatomy, bad hands, missing fingers",
  num_inference_steps: 30,
  guidance_scale: 7.5,
  width: 1024,
  height: 1024,
  num_images: 1,
  output_format: "jpeg",
  seed: null,
  loras: [],
  embeddings: [],
  prompt_weighting: true,
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

export function getModelConfig(modelId: string): ModelConfig {
  return AVAILABLE_MODELS.find((m) => m.id === modelId) ?? AVAILABLE_MODELS[0];
}
