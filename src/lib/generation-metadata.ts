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
  try {
    const url = new URL(rawUrl);
    const modelId = url.pathname.match(/\/models\/(\d+)/)?.[1];
    const modelVersionId = url.searchParams.get("modelVersionId");

    return {
      modelId: modelId ? Number(modelId) : undefined,
      modelVersionId: modelVersionId ? Number(modelVersionId) : undefined,
    };
  } catch {
    return {};
  }
}

function normalizeResource(value: unknown): ImportedCivitaiResource | null {
  if (!isRecord(value)) return null;

  const name =
    stringValue(value.name) ||
    stringValue(value.modelName) ||
    stringValue(value.model_name) ||
    stringValue(value.path);
  if (!name) return null;

  const url = stringValue(value.url) || stringValue(value.civitai_url);
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
  const resources = explicitResources.length > 0 ? explicitResources : resourcesFromParams(params);

  return { params, resources };
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

function assetMatchesResource(asset: LocalModelAsset, resource: ImportedCivitaiResource) {
  const names = [asset.path, asset.name, asset.version ?? ""].map(normalizeToken);
  const targetName = normalizeToken(resource.name);
  const targetVersion = normalizeToken(resource.versionName ?? "");
  const versionId = resource.modelVersionId ? String(resource.modelVersionId) : "";
  const urls = [asset.civitai_url ?? "", asset.source_url ?? ""];

  if (versionId && urls.some((url) => url.includes(`modelVersionId=${versionId}`))) {
    return true;
  }
  if (targetName && names.some((name) => name === targetName)) return true;
  if (
    targetName.length >= 8 &&
    names.some((name) => name.includes(targetName) || targetName.includes(name))
  ) {
    return true;
  }
  if (targetName && targetVersion) {
    return names.some((name) => name === `${targetName}${targetVersion}`);
  }

  return false;
}

function findMatchingAsset(
  models: LocalModelsResponse,
  resource: ImportedCivitaiResource
) {
  return modelAssets(models, resource.type).find((asset) =>
    assetMatchesResource(asset, resource)
  );
}

export function reconcileMetadataResources(
  parsed: ParsedGenerationMetadata,
  models: LocalModelsResponse
) {
  const params: GenerationParams = { ...parsed.params };
  const missing: MissingResource[] = [];

  parsed.resources.forEach((resource) => {
    if (resource.type === "other") return;

    const match = findMatchingAsset(models, resource);
    if (!match) {
      missing.push({ ...resource, reason: "Local file not found" });
      return;
    }

    if (resource.type === "checkpoint") params.model_name = match.path;
    if (resource.type === "lora") {
      params.loras = [
        ...params.loras.filter((lora) => lora.path !== resource.name),
        {
          path: match.path,
          scale: resource.weight ?? params.loras.find((lora) => lora.path === resource.name)?.scale ?? 0.8,
        },
      ];
    }
    if (resource.type === "embedding") {
      params.embeddings = [
        ...params.embeddings.filter((embedding) => embedding.path !== resource.name),
        { path: match.path, tokens: resource.name },
      ];
    }
    if (resource.type === "vae") params.vae_name = match.path;
    if (resource.type === "upscaler") params.upscale_model_name = match.path;
  });

  return { params, missing };
}
