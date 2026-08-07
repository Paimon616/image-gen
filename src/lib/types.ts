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
  backend: "comfyui" | "a1111" | "forge";
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
  hires_upscale: number;
  hires_steps: number;
  hires_denoise: number;
  img2img_resize: number;
  adetailer_enabled: boolean;
  adetailer_model: string;
  adetailer_checkpoint: string;
  adetailer_prompt: string;
  adetailer_negative_prompt: string;
  adetailer_use_steps: boolean;
  adetailer_steps: number;
  adetailer_confidence: number;
  adetailer_mask_blur: number;
  adetailer_noise_multiplier: number;
  adetailer_inpaint_only_masked: boolean;
  adetailer_loras: LoraConfig[];
  adetailer_denoise: number;
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

export interface CivitaiOrigin {
  imageId: number;
  imageUrl: string;
  pageUrl: string;
  username?: string;
}

export interface GeneratedImage {
  id: string;
  url: string;
  thumbnailUrl?: string;
  params: GenerationParams | null;
  timestamp: number;
  filename: string;
  sizeSemantics?: "base" | "final";
  generation?: ImageGenerationStatus;
  civitaiOrigin?: CivitaiOrigin;
  workspaces?: string[];
}

// Sentinel filter id for images that belong to no workspace. Not a real
// workspace — used as an activeWorkspaceId value and image-list query param.
export const UNGROUPED_WORKSPACE_ID = "__ungrouped__";

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
}

export interface WorkspaceSummary extends Workspace {
  count: number;
}

export interface ImageGenerationStatus {
  state: "queued" | "waiting" | "generating" | "completed" | "canceled" | "error";
  progress: number;
  message: string;
}

export type VideoModelPreset = "wan-smoothmix" | "wan-base" | "ltx-10eros";

export interface VideoGenerationParams {
  video_model: VideoModelPreset;
  video_pipeline: string;
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  num_frames: number;
  fps: number;
  duration_seconds: number;
  num_inference_steps: number;
  guidance_scale: number;
  vae_tile_size: number;
  vae_tile_overlap: number;
  vae_temporal_size: number;
  vae_temporal_overlap: number;
  smooth_xxx_strength: number;
  mating_press_strength: number;
  lightx2v_high_strength: number;
  lightx2v_low_strength: number;
  ltx_dr34_strength: number;
  ltx_dasiwa_strength: number;
  seed: number | null;
  source_image: string | null;
  enable_sound: boolean;
  sound_prompt: string;
  negative_sound_prompt: string;
  sound_duration_seconds: number;
}

export interface GeneratedAudio {
  id: string;
  url: string;
  params: VideoGenerationParams | null;
  timestamp: number;
  filename: string;
  contentType: string;
}

export interface GeneratedVideo {
  id: string;
  url: string;
  params: VideoGenerationParams | null;
  timestamp: number;
  filename: string;
  contentType: string;
  audios?: GeneratedAudio[];
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
  fileName?: string;
  modelId?: number;
  modelVersionId?: number;
  url: string;
}

export interface CivitaiLicenseInfo {
  allowNoCredit?: boolean;
  allowCommercialUse?: string[];
  allowDerivatives?: boolean;
  allowDifferentLicense?: boolean;
}

export interface CivitaiImportResult {
  imageId: number;
  imageUrl: string;
  pageUrl: string;
  username?: string;
  importedTags: string[];
  metadataHidden?: boolean;
  warning?: string;
  params: Partial<GenerationParams>;
  resources: ImportedCivitaiResource[];
  metadataReport?: CivitaiMetadataReport;
  recommendations?: CivitaiGenerationRecommendation[];
}

export type CivitaiMetadataStatus =
  | "confirmed"
  | "inferred"
  | "missing"
  | "conflict";

export interface CivitaiMetadataField {
  key: string;
  label: string;
  status: CivitaiMetadataStatus;
  value?: string;
  note?: string;
}

export interface CivitaiMetadataReport {
  reproducibility: "high" | "medium" | "low";
  summary: string;
  confirmedCount: number;
  inferredCount: number;
  missingCount: number;
  fields: CivitaiMetadataField[];
}

export interface CivitaiGenerationRecommendation {
  id: string;
  title: string;
  goal: "closest" | "literal" | "stable" | "quality";
  description: string;
  caution?: string;
  params: Partial<GenerationParams>;
}

export interface HistoryMissingResource extends ImportedCivitaiResource {
  reason: string;
}

export interface HistoryEntry {
  id: string;
  source: "civitai" | "generated";
  createdAt: number;
  requestedUrl: string;
  imageId?: number;
  imageUrl: string;
  localImageUrl: string | null;
  localImageFilename: string | null;
  pageUrl?: string;
  username?: string;
  params: GenerationParams;
  importedParams: Partial<GenerationParams>;
  resources: ImportedCivitaiResource[];
  missingResources: HistoryMissingResource[];
  importedTags: string[];
  userTags: string[];
  rawImport?: CivitaiImportResult;
}

export const DEFAULT_PARAMS: GenerationParams = {
  backend: "comfyui",
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
  hires_upscale: 1,
  hires_steps: 12,
  hires_denoise: 0.45,
  img2img_resize: 1.5,
  adetailer_enabled: false,
  adetailer_model: "face_yolov8n.pt",
  adetailer_checkpoint: "",
  adetailer_prompt: "",
  adetailer_negative_prompt: "",
  adetailer_use_steps: false,
  adetailer_steps: 20,
  adetailer_confidence: 0.5,
  adetailer_mask_blur: 4,
  adetailer_noise_multiplier: 1,
  adetailer_inpaint_only_masked: true,
  adetailer_loras: [],
  adetailer_denoise: 0.4,
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

export const DEFAULT_VIDEO_PARAMS: VideoGenerationParams = {
  video_model: "wan-smoothmix",
  video_pipeline: "sulphur-ltx23-i2v-base-high-quality",
  prompt: "",
  negative_prompt: "low quality, blurry, flicker, warped, distorted motion",
  width: 480,
  height: 592,
  num_frames: 81,
  fps: 16,
  duration_seconds: 5,
  num_inference_steps: 6,
  guidance_scale: 1,
  vae_tile_size: 256,
  vae_tile_overlap: 64,
  vae_temporal_size: 64,
  vae_temporal_overlap: 16,
  smooth_xxx_strength: 1,
  mating_press_strength: 0.85,
  lightx2v_high_strength: 3,
  lightx2v_low_strength: 1.5,
  ltx_dr34_strength: 1,
  ltx_dasiwa_strength: 1,
  seed: null,
  source_image: null,
  enable_sound: false,
  sound_prompt: "",
  negative_sound_prompt: "",
  sound_duration_seconds: 6,
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

export function randomGenerationSeed() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

export function normalizeGenerationSeed(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return randomGenerationSeed();
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return randomGenerationSeed();
  }

  return Math.floor(numericValue);
}

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

export type HiresModelFamily =
  | "flux"
  | "sd3"
  | "pony"
  | "illustrious"
  | "sdxl"
  | "sd15"
  | "unknown";

export interface HiresPreset {
  family: HiresModelFamily;
  familyLabel: string;
  steps: number;
  denoise: number;
}

// hires refine defaults are keyed to the model family: the second pass denoise
// mostly tracks how much detail the base architecture invents, and each family
// has a community-accepted sweet spot for an ESRGAN-style upscaler.
const HIRES_PRESETS: Record<HiresModelFamily, Omit<HiresPreset, "family">> = {
  flux: { familyLabel: "Flux", steps: 10, denoise: 0.35 },
  sd3: { familyLabel: "SD3", steps: 12, denoise: 0.4 },
  pony: { familyLabel: "Pony", steps: 10, denoise: 0.4 },
  illustrious: { familyLabel: "Illustrious / NoobAI", steps: 10, denoise: 0.4 },
  sdxl: { familyLabel: "SDXL", steps: 12, denoise: 0.4 },
  sd15: { familyLabel: "SD 1.5", steps: 12, denoise: 0.5 },
  unknown: { familyLabel: "기본", steps: 12, denoise: 0.45 },
};

export function detectModelFamily(modelName: string): HiresModelFamily {
  const name = modelName.toLowerCase();

  if (/flux/.test(name)) return "flux";
  if (/(^|[^a-z])sd_?3|sd3/.test(name)) return "sd3";
  if (/pony/.test(name)) return "pony";
  if (/illustrious|ilxl|noob|noobai/.test(name)) return "illustrious";
  if (/xl|sdxl|pdxl/.test(name)) return "sdxl";
  if (/sd_?1\.?5|v1-?5|sd15|1_5/.test(name)) return "sd15";

  return "unknown";
}

export function getHiresPreset(modelName: string): HiresPreset {
  const family = detectModelFamily(modelName ?? "");
  return { family, ...HIRES_PRESETS[family] };
}
