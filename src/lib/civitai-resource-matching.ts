import type {
  CivitaiImportResult,
  GenerationParams,
  ImportedCivitaiResource,
} from "@/lib/types";
import { civitaiUrlMatchesId } from "@/lib/civitai-url";

export interface LocalModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  civitai_url?: string | null;
  source_url?: string | null;
}

export interface LocalModelsResponse {
  checkpointAssets?: LocalModelAsset[];
  videoModelAssets?: LocalModelAsset[];
  loraAssets?: LocalModelAsset[];
  embeddingAssets?: LocalModelAsset[];
  vaeAssets?: LocalModelAsset[];
  upscaleModelAssets?: LocalModelAsset[];
}

export interface MissingResource extends ImportedCivitaiResource {
  reason: string;
}

export const RESOURCE_LABELS: Record<ImportedCivitaiResource["type"], string> = {
  checkpoint: "Checkpoint",
  lora: "LoRA",
  embedding: "Embedding",
  vae: "VAE",
  upscaler: "Upscaler",
  other: "Resource",
};

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(safetensors|ckpt|pt|pth)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function normalizeWords(value: string) {
  return value
    .replace(/\.(safetensors|ckpt|pt|pth)$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function assetUrls(asset: LocalModelAsset) {
  return [asset.civitai_url ?? "", asset.source_url ?? ""].filter(Boolean);
}

function urlMatchesCivitaiId(urls: string[], kind: "model" | "version", id: string) {
  if (!id) return false;

  return urls.some((url) => civitaiUrlMatchesId(url, kind, id));
}

function resourceMatchScore(asset: LocalModelAsset, resource: ImportedCivitaiResource) {
  const targetName = normalizeToken(resource.name);
  const targetVersion = normalizeToken(resource.versionName ?? "");
  const targetHash = resource.hash?.toLowerCase();
  const targetModelId = resource.modelId ? String(resource.modelId) : "";
  const targetVersionId = resource.modelVersionId ? String(resource.modelVersionId) : "";
  const urls = assetUrls(asset);
  const candidates = [
    asset.path,
    asset.name,
    asset.version ?? "",
    asset.civitai_url ?? "",
    asset.source_url ?? "",
  ]
    .map(normalizeToken)
    .filter(Boolean);
  const nameCandidates = [asset.name, asset.path].map(normalizeToken).filter(Boolean);
  const assetVersion = normalizeToken(asset.version ?? "");
  const combinedTarget = targetVersion ? `${targetName}${targetVersion}` : "";
  const assetWords = normalizeWords(`${asset.name} ${asset.path}`);
  const targetWords = normalizeWords(resource.name);

  if (urlMatchesCivitaiId(urls, "version", targetVersionId)) return 100;
  if (targetHash && candidates.some((candidate) => candidate.includes(targetHash))) {
    return 85;
  }
  if (
    targetName &&
    nameCandidates.some((candidate) => candidate === targetName) &&
    (!targetVersion || assetVersion === targetVersion)
  ) {
    return 80;
  }
  if (
    combinedTarget &&
    nameCandidates.some((candidate) => candidate === combinedTarget)
  ) {
    return 75;
  }
  if (targetVersionId || targetVersion) {
    return 0;
  }

  if (urlMatchesCivitaiId(urls, "model", targetModelId)) return 90;
  if (targetName && nameCandidates.some((candidate) => candidate === targetName)) {
    return 70;
  }

  if (targetName.length >= 8) {
    const containsName = nameCandidates.some(
      (candidate) => candidate.includes(targetName) || targetName.includes(candidate)
    );
    if (containsName) return 40;
  }

  if (
    targetWords.length > 1 &&
    targetWords.every((word) => assetWords.includes(word))
  ) {
    return 30;
  }

  return 0;
}

function resolveLocalVaeName(vaeName: string, assets: LocalModelAsset[]) {
  const trimmed = vaeName.trim();
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

function findLocalAsset(assets: LocalModelAsset[], resource: ImportedCivitaiResource) {
  const ranked = assets
    .map((asset) => ({ asset, score: resourceMatchScore(asset, resource) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.asset;
}

function resourceBucket(
  models: LocalModelsResponse,
  type: ImportedCivitaiResource["type"]
) {
  if (type === "checkpoint") {
    return [...(models.checkpointAssets ?? []), ...(models.videoModelAssets ?? [])];
  }
  if (type === "lora") return models.loraAssets ?? [];
  if (type === "embedding") return models.embeddingAssets ?? [];
  if (type === "vae") return models.vaeAssets ?? [];
  if (type === "upscaler") return models.upscaleModelAssets ?? [];
  return [];
}

export function findMissingCivitaiResources(
  imported: CivitaiImportResult,
  models: LocalModelsResponse
) {
  return imported.resources.reduce<MissingResource[]>((missing, resource) => {
    if (resource.type === "other") return missing;

    const match = findLocalAsset(resourceBucket(models, resource.type), resource);
    if (!match) {
      missing.push({
        ...resource,
        reason: "Local file not found",
      });
    }

    return missing;
  }, []);
}

export function reconcileImportedParams(
  imported: CivitaiImportResult,
  models: LocalModelsResponse,
  currentParams: GenerationParams
) {
  const matched: Partial<GenerationParams> = { ...imported.params };
  const missing: MissingResource[] = [];
  const matchedLoras: GenerationParams["loras"] = [];
  const matchedEmbeddings: GenerationParams["embeddings"] = [];
  let matchedCheckpoint = false;

  imported.resources.forEach((resource) => {
    if (resource.type === "other") return;

    const match = findLocalAsset(resourceBucket(models, resource.type), resource);

    if (!match) {
      missing.push({
        ...resource,
        reason: "Local file not found",
      });
      return;
    }

    if (resource.type === "checkpoint") {
      matched.model_name = match.path;
      matchedCheckpoint = true;
    }

    if (resource.type === "lora") {
      matchedLoras.push({
        path: match.path,
        scale: resource.weight ?? 0.8,
      });
    }

    if (resource.type === "embedding") {
      matchedEmbeddings.push({
        path: match.path,
        tokens: resource.name,
      });
    }

    if (resource.type === "vae") {
      matched.vae_name = match.path;
    }

    if (resource.type === "upscaler") {
      matched.upscale_model_name = match.path;
    }
  });

  if (typeof matched.vae_name === "string") {
    matched.vae_name = resolveLocalVaeName(matched.vae_name, models.vaeAssets ?? []);
  }

  const importedCheckpoint = imported.resources.some(
    (resource) => resource.type === "checkpoint"
  );
  const importedVae = imported.resources.some((resource) => resource.type === "vae");
  const importedUpscaler = imported.resources.some(
    (resource) => resource.type === "upscaler"
  );
  const importedGenerationMetadata = imported.metadataHidden !== true;

  if (!Object.hasOwn(imported.params, "prompt")) {
    matched.prompt = "";
  }
  if (importedCheckpoint && !matchedCheckpoint) {
    matched.model_name = "";
  }
  if (importedVae && !matched.vae_name) {
    matched.vae_name = currentParams.vae_name;
  }
  if (importedUpscaler && !matched.upscale_model_name) {
    matched.upscale_model_name = currentParams.upscale_model_name;
  }
  if (
    importedGenerationMetadata ||
    matchedLoras.length > 0 ||
    imported.resources.some((resource) => resource.type === "lora")
  ) {
    matched.loras = matchedLoras;
  }
  if (
    importedGenerationMetadata ||
    matchedEmbeddings.length > 0 ||
    imported.resources.some((resource) => resource.type === "embedding")
  ) {
    matched.embeddings = matchedEmbeddings;
  }

  return { matched, missing };
}
