import {
  DEFAULT_PARAMS,
  IMAGE_SIZE_CONSTRAINTS,
  type GenerationParams,
  type ImportedCivitaiResource,
} from "@/lib/types";
import {
  type LocalModelAsset,
  type LocalModelsResponse,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import { civitaiUrlMatchesId, parseCivitaiUrlIds } from "@/lib/civitai-url";

type ResourceType = ImportedCivitaiResource["type"];

const RESOURCE_TYPES = new Set<ResourceType>([
  "checkpoint",
  "lora",
  "embedding",
  "vae",
  "upscaler",
  "other",
]);

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS) as (keyof GenerationParams)[];

export interface ParsedGenerationMetadata {
  params: GenerationParams;
  resources: ImportedCivitaiResource[];
  hasExplicitResources: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function normalizeDimension(value: unknown, fallback: number) {
  const numericValue = numberValue(value);
  if (numericValue === null) return fallback;

  const { min, max, step } = IMAGE_SIZE_CONSTRAINTS;
  const steppedValue = Math.round(numericValue / step) * step;

  return Math.min(Math.max(steppedValue, min), max);
}

function normalizeSeed(value: unknown) {
  const seed = numberValue(value);
  return seed !== null && seed >= 0 ? Math.floor(seed) : null;
}

function normalizeResourceType(value: unknown): ResourceType {
  const normalized = stringValue(value).toLowerCase().replace(/[\s_-]/g, "");

  if (
    normalized.includes("lora") ||
    normalized.includes("lycoris") ||
    normalized.includes("locon") ||
    normalized.includes("loha")
  ) {
    return "lora";
  }
  if (normalized.includes("checkpoint") || normalized === "model") {
    return "checkpoint";
  }
  if (normalized.includes("embedding") || normalized.includes("textualinversion")) {
    return "embedding";
  }
  if (normalized.includes("vae")) return "vae";
  if (normalized.includes("upscaler") || normalized.includes("upscale")) {
    return "upscaler";
  }
  if (RESOURCE_TYPES.has(normalized as ResourceType)) return normalized as ResourceType;

  return "other";
}

function extractCivitaiIds(rawUrl: string) {
  const ids = parseCivitaiUrlIds(rawUrl);

  return {
    modelId: ids.modelId ? Number(ids.modelId) : undefined,
    modelVersionId: ids.modelVersionId ? Number(ids.modelVersionId) : undefined,
  };
}

function normalizeResource(value: unknown): ImportedCivitaiResource | null {
  if (!isRecord(value)) return null;

  const name =
    stringValue(value.path) ||
    stringValue(value.name) ||
    stringValue(value.modelName) ||
    stringValue(value.model_name);
  if (!name) return null;

  const url =
    stringValue(value.url) ||
    stringValue(value.civitai_url) ||
    stringValue(value.source_url);
  const ids = extractCivitaiIds(url);
  const resource: ImportedCivitaiResource = {
    type: normalizeResourceType(value.type ?? value.modelType),
    name,
    url,
  };
  const versionName =
    stringValue(value.versionName) || stringValue(value.version_name);
  const baseModel = stringValue(value.baseModel) || stringValue(value.base_model);
  const hash = stringValue(value.hash);
  const weight = numberValue(value.weight ?? value.strength);
  const modelId = numberValue(value.modelId ?? value.model_id) ?? ids.modelId;
  const modelVersionId =
    numberValue(value.modelVersionId ?? value.model_version_id ?? value.versionId) ??
    ids.modelVersionId;

  if (versionName) resource.versionName = versionName;
  if (baseModel) resource.baseModel = baseModel;
  if (hash) resource.hash = hash;
  if (weight !== null) resource.weight = weight;
  if (modelId !== undefined) resource.modelId = modelId;
  if (modelVersionId !== undefined) resource.modelVersionId = modelVersionId;

  return resource;
}

function extractResources(root: Record<string, unknown>) {
  const candidates = [
    root.resources,
    isRecord(root.meta) ? root.meta.resources : null,
    isRecord(root.rawImport) ? root.rawImport.resources : null,
    isRecord(root.importResult) ? root.importResult.resources : null,
    isRecord(root.metadata) ? root.metadata.resources : null,
  ];

  return candidates
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : []))
    .map(normalizeResource)
    .filter((resource): resource is ImportedCivitaiResource => Boolean(resource));
}

function normalizeLoras(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PARAMS.loras;

  return value
    .map((item) => {
      if (typeof item === "string") return { path: item, scale: 0.8 };
      if (!isRecord(item)) return null;

      const path = stringValue(item.path ?? item.name ?? item.modelName);
      if (!path) return null;

      return {
        path,
        scale: numberValue(item.scale ?? item.weight ?? item.strength) ?? 0.8,
      };
    })
    .filter((item): item is GenerationParams["loras"][number] => Boolean(item));
}

function normalizeEmbeddings(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PARAMS.embeddings;

  return value
    .map((item) => {
      if (typeof item === "string") {
        return { path: item, tokens: item };
      }
      if (!isRecord(item)) return null;

      const path = stringValue(item.path ?? item.name ?? item.modelName);
      if (!path) return null;

      return {
        path,
        tokens: stringValue(item.tokens) || path,
      };
    })
    .filter((item): item is GenerationParams["embeddings"][number] => Boolean(item));
}

function normalizeControlnets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_PARAMS.controlnets;

  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const model = stringValue(item.model ?? item.name);
      if (!model) return null;

      return {
        model,
        image: stringValue(item.image) || null,
        strength: numberValue(item.strength) ?? 1,
        start_percent: numberValue(item.start_percent) ?? 0,
        end_percent: numberValue(item.end_percent) ?? 1,
      };
    })
    .filter((item): item is GenerationParams["controlnets"][number] =>
      Boolean(item)
    );
}

function parseSize(value: unknown) {
  const size = stringValue(value);
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);

  return match?.[1] && match[2]
    ? { width: Number(match[1]), height: Number(match[2]) }
    : {};
}

function extractParamsRecord(root: Record<string, unknown>) {
  const directParamCount = PARAM_KEYS.filter((key) => key in root).length;

  if (isRecord(root.params)) return root.params;
  if (isRecord(root.generationParams)) return root.generationParams;
  if (isRecord(root.metadata) && isRecord(root.metadata.params)) {
    return root.metadata.params;
  }
  if (directParamCount > 0) return root;
  if (isRecord(root.meta)) return root.meta;

  return root;
}

function normalizeParams(rawParams: Record<string, unknown>) {
  const parsedSize = parseSize(rawParams.Size ?? rawParams.size);
  const params: GenerationParams = {
    ...DEFAULT_PARAMS,
    backend:
      rawParams.backend === "a1111" || rawParams.backend === "forge"
        ? rawParams.backend
        : "comfyui",
    model: stringValue(rawParams.model) || DEFAULT_PARAMS.model,
    model_name:
      stringValue(rawParams.model_name) ||
      stringValue(rawParams.checkpoint) ||
      stringValue(rawParams.Model) ||
      stringValue(rawParams.modelName) ||
      DEFAULT_PARAMS.model_name,
    prompt:
      stringValue(rawParams.prompt) ||
      stringValue(rawParams.Prompt) ||
      DEFAULT_PARAMS.prompt,
    negative_prompt:
      stringValue(rawParams.negative_prompt) ||
      stringValue(rawParams.negativePrompt) ||
      stringValue(rawParams["Negative prompt"]) ||
      DEFAULT_PARAMS.negative_prompt,
    num_inference_steps:
      numberValue(rawParams.num_inference_steps ?? rawParams.steps ?? rawParams.Steps) ??
      DEFAULT_PARAMS.num_inference_steps,
    guidance_scale:
      numberValue(
        rawParams.guidance_scale ?? rawParams.cfgScale ?? rawParams["CFG scale"]
      ) ?? DEFAULT_PARAMS.guidance_scale,
    width: normalizeDimension(rawParams.width ?? parsedSize.width, DEFAULT_PARAMS.width),
    height: normalizeDimension(
      rawParams.height ?? parsedSize.height,
      DEFAULT_PARAMS.height
    ),
    num_images:
      numberValue(rawParams.num_images ?? rawParams.batch_size) ??
      DEFAULT_PARAMS.num_images,
    output_format:
      stringValue(rawParams.output_format) === "png" ? "png" : DEFAULT_PARAMS.output_format,
    generation_mode:
      rawParams.generation_mode === "image_to_image" ||
      rawParams.generation_mode === "pose_reference"
        ? rawParams.generation_mode
        : DEFAULT_PARAMS.generation_mode,
    seed: normalizeSeed(rawParams.seed ?? rawParams.Seed),
    sampler_name:
      stringValue(rawParams.sampler_name) ||
      stringValue(rawParams.sampler) ||
      stringValue(rawParams.Sampler) ||
      DEFAULT_PARAMS.sampler_name,
    scheduler:
      stringValue(rawParams.scheduler) ||
      stringValue(rawParams.Scheduler) ||
      DEFAULT_PARAMS.scheduler,
    clip_skip:
      numberValue(rawParams.clip_skip ?? rawParams.clipSkip ?? rawParams["Clip skip"]) ??
      DEFAULT_PARAMS.clip_skip,
    vae_name:
      stringValue(rawParams.vae_name) ||
      stringValue(rawParams.vae) ||
      stringValue(rawParams.VAE) ||
      DEFAULT_PARAMS.vae_name,
    upscale_model_name:
      stringValue(rawParams.upscale_model_name) ||
      stringValue(rawParams.upscaler) ||
      DEFAULT_PARAMS.upscale_model_name,
    hires_upscale:
      numberValue(rawParams.hires_upscale ?? rawParams.hiresUpscale ?? rawParams["Hires upscale"]) ??
      DEFAULT_PARAMS.hires_upscale,
    hires_steps:
      numberValue(rawParams.hires_steps ?? rawParams.hiresSteps ?? rawParams["Hires steps"]) ??
      DEFAULT_PARAMS.hires_steps,
    hires_denoise:
      numberValue(rawParams.hires_denoise ?? rawParams.hiresDenoise ?? rawParams["Hires denoise"]) ??
      DEFAULT_PARAMS.hires_denoise,
    img2img_resize:
      numberValue(rawParams.img2img_resize) ?? DEFAULT_PARAMS.img2img_resize,
    adetailer_enabled:
      booleanValue(rawParams.adetailer_enabled) ?? DEFAULT_PARAMS.adetailer_enabled,
    adetailer_model:
      stringValue(rawParams.adetailer_model) || DEFAULT_PARAMS.adetailer_model,
    adetailer_checkpoint:
      stringValue(rawParams.adetailer_checkpoint) || DEFAULT_PARAMS.adetailer_checkpoint,
    adetailer_prompt:
      stringValue(rawParams.adetailer_prompt) || DEFAULT_PARAMS.adetailer_prompt,
    adetailer_negative_prompt:
      stringValue(rawParams.adetailer_negative_prompt) ||
      DEFAULT_PARAMS.adetailer_negative_prompt,
    adetailer_use_steps:
      booleanValue(rawParams.adetailer_use_steps) ?? DEFAULT_PARAMS.adetailer_use_steps,
    adetailer_steps:
      numberValue(rawParams.adetailer_steps) ?? DEFAULT_PARAMS.adetailer_steps,
    adetailer_confidence:
      numberValue(rawParams.adetailer_confidence) ?? DEFAULT_PARAMS.adetailer_confidence,
    adetailer_mask_blur:
      numberValue(rawParams.adetailer_mask_blur) ?? DEFAULT_PARAMS.adetailer_mask_blur,
    adetailer_noise_multiplier:
      numberValue(rawParams.adetailer_noise_multiplier) ??
      DEFAULT_PARAMS.adetailer_noise_multiplier,
    adetailer_inpaint_only_masked:
      booleanValue(rawParams.adetailer_inpaint_only_masked) ??
      DEFAULT_PARAMS.adetailer_inpaint_only_masked,
    adetailer_loras: normalizeLoras(rawParams.adetailer_loras),
    adetailer_denoise:
      numberValue(rawParams.adetailer_denoise) ?? DEFAULT_PARAMS.adetailer_denoise,
    loras: normalizeLoras(rawParams.loras),
    embeddings: normalizeEmbeddings(rawParams.embeddings),
    controlnets: normalizeControlnets(rawParams.controlnets),
    prompt_weighting:
      booleanValue(rawParams.prompt_weighting) ?? DEFAULT_PARAMS.prompt_weighting,
    style_image: stringValue(rawParams.style_image) || null,
    character_image: stringValue(rawParams.character_image) || null,
    source_image: stringValue(rawParams.source_image) || null,
    denoise_strength:
      numberValue(rawParams.denoise_strength ?? rawParams.denoisingStrength) ??
      DEFAULT_PARAMS.denoise_strength,
    pose_reference_image: stringValue(rawParams.pose_reference_image) || null,
    pose_reference_model:
      stringValue(rawParams.pose_reference_model) || DEFAULT_PARAMS.pose_reference_model,
    pose_reference_strength:
      numberValue(rawParams.pose_reference_strength) ??
      DEFAULT_PARAMS.pose_reference_strength,
    enable_safety_checker:
      booleanValue(rawParams.enable_safety_checker) ??
      DEFAULT_PARAMS.enable_safety_checker,
  };

  return params;
}

function resourcesFromParams(params: GenerationParams) {
  const resources: ImportedCivitaiResource[] = [];

  if (params.model_name) {
    resources.push({
      type: "checkpoint",
      name: params.model_name,
      url: "",
    });
  }

  params.loras.forEach((lora) => {
    if (!lora.path) return;
    resources.push({
      type: "lora",
      name: lora.path,
      weight: lora.scale,
      url: "",
    });
  });

  return resources;
}

export function parseGenerationMetadataJson(rawJson: string): ParsedGenerationMetadata {
  const parsed = JSON.parse(rawJson) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("Metadata JSON must be an object.");
  }

  const params = normalizeParams(extractParamsRecord(parsed));
  const explicitResources = extractResources(parsed);
  const hasExplicitResources = explicitResources.length > 0;
  const resources = hasExplicitResources ? explicitResources : resourcesFromParams(params);

  return { params, resources, hasExplicitResources };
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(safetensors|ckpt|pt|pth)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function modelAssets(models: LocalModelsResponse, type: ResourceType) {
  if (type === "checkpoint") {
    return [...(models.checkpointAssets ?? []), ...(models.videoModelAssets ?? [])];
  }
  if (type === "lora") return models.loraAssets ?? [];
  if (type === "embedding") return models.embeddingAssets ?? [];
  if (type === "vae") return models.vaeAssets ?? [];
  if (type === "upscaler") return models.upscaleModelAssets ?? [];
  return [];
}

function assetResourceMatchScore(asset: LocalModelAsset, resource: ImportedCivitaiResource) {
  const assetPath = normalizeToken(asset.path);
  const names = [asset.path, asset.name, asset.version ?? ""].map(normalizeToken);
  const targetName = normalizeToken(resource.name);
  const targetVersion = normalizeToken(resource.versionName ?? "");
  const modelId = resource.modelId ? String(resource.modelId) : "";
  const versionId = resource.modelVersionId ? String(resource.modelVersionId) : "";
  const urls = [asset.civitai_url ?? "", asset.source_url ?? ""];

  if (targetName && assetPath === targetName) return 120;
  if (versionId && urls.some((url) => civitaiUrlMatchesId(url, "version", versionId))) {
    return 110;
  }

  if (versionId || targetVersion) return 0;

  if (modelId && urls.some((url) => civitaiUrlMatchesId(url, "model", modelId))) {
    return 90;
  }
  if (targetName && names.some((name) => name === targetName)) return 80;
  if (
    targetName.length >= 8 &&
    names.some((name) => name.includes(targetName) || targetName.includes(name))
  ) {
    return 40;
  }

  return 0;
}

function resolveLocalAssetName(name: string, assets: LocalModelAsset[]) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (assets.some((asset) => asset.path === trimmed)) return trimmed;

  const target = normalizeToken(trimmed);
  if (!target) return "";
  const match = assets.find((asset) => {
    const path = normalizeToken(asset.path);
    const name = normalizeToken(asset.name);
    return (
      path === target ||
      name === target ||
      path.includes(target) ||
      name.includes(target)
    );
  });
  return match?.path ?? "";
}

function findMatchingAsset(
  models: LocalModelsResponse,
  resource: ImportedCivitaiResource
) {
  const ranked = modelAssets(models, resource.type)
    .map((asset) => ({ asset, score: assetResourceMatchScore(asset, resource) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.asset;
}

export function reconcileMetadataResources(
  parsed: ParsedGenerationMetadata,
  models: LocalModelsResponse
) {
  const params: GenerationParams = parsed.hasExplicitResources
    ? { ...parsed.params, loras: [], embeddings: [] }
    : { ...parsed.params };
  const missing: MissingResource[] = [];
  let matchedCheckpoint = false;
  let matchedVae = false;
  let matchedUpscaler = false;
  const importedCheckpoint = parsed.resources.some(
    (resource) => resource.type === "checkpoint"
  );
  const importedVae = parsed.resources.some((resource) => resource.type === "vae");
  const importedUpscaler = parsed.resources.some(
    (resource) => resource.type === "upscaler"
  );

  parsed.resources.forEach((resource) => {
    if (resource.type === "other") return;

    const match = findMatchingAsset(models, resource);
    if (!match) {
      missing.push({ ...resource, reason: "Local file not found" });
      return;
    }

    if (resource.type === "checkpoint") {
      params.model_name = match.path;
      matchedCheckpoint = true;
    }
    if (resource.type === "lora") {
      params.loras = [
        ...params.loras.filter((lora) => lora.path !== match.path),
        {
          path: match.path,
          scale:
            resource.weight ??
            parsed.params.loras.find((lora) => lora.path === resource.name)?.scale ??
            0.8,
        },
      ];
    }
    if (resource.type === "embedding") {
      params.embeddings = [
        ...params.embeddings.filter((embedding) => embedding.path !== match.path),
        { path: match.path, tokens: resource.name },
      ];
    }
    if (resource.type === "vae") {
      params.vae_name = match.path;
      matchedVae = true;
    }
    if (resource.type === "upscaler") {
      params.upscale_model_name = match.path;
      matchedUpscaler = true;
    }
  });

  if (!matchedVae && typeof params.vae_name === "string") {
    params.vae_name = resolveLocalAssetName(params.vae_name, models.vaeAssets ?? []);
  }

  if (!matchedUpscaler && typeof params.upscale_model_name === "string") {
    params.upscale_model_name = resolveLocalAssetName(
      params.upscale_model_name,
      models.upscaleModelAssets ?? []
    );
  }

  if (parsed.hasExplicitResources) {
    if (importedCheckpoint && !matchedCheckpoint) params.model_name = "";
    if (importedVae && !matchedVae) params.vae_name = "";
    if (importedUpscaler && !matchedUpscaler) params.upscale_model_name = "";
  }

  return { params, missing };
}
