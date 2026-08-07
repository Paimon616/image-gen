import type { ImportedCivitaiResource } from "@/lib/types";

type ResourceType = ImportedCivitaiResource["type"];

interface CivitaiFile {
  name?: string;
  primary?: boolean;
}

interface CivitaiModelVersion {
  id: number;
  name?: string;
  baseModel?: string;
  files?: CivitaiFile[];
}

interface CivitaiModel {
  id: number;
  name?: string;
  type?: string;
  modelVersions?: CivitaiModelVersion[];
}

const TYPE_QUERY: Partial<Record<ResourceType, string>> = {
  checkpoint: "Checkpoint",
  lora: "LORA",
  embedding: "TextualInversion",
  vae: "VAE",
  upscaler: "Upscaler",
};

export const RESOURCE_CATALOG_FOLDERS: Partial<Record<ResourceType, string>> = {
  checkpoint: "checkpoints",
  lora: "loras",
  embedding: "embeddings",
  vae: "vae",
  upscaler: "upscale_models",
};

function modelSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function civitaiModelUrl(
  modelId: number,
  modelName: string,
  modelVersionId: number
) {
  const slug = modelSlug(modelName);
  const url = new URL(
    `https://civitai.red/models/${modelId}${slug ? `/${slug}` : ""}`
  );

  url.searchParams.set("modelVersionId", String(modelVersionId));
  return url.toString();
}

function stripModelExtension(value: string) {
  return value.replace(/\.(safetensors|ckpt|pt|pth)$/i, "");
}

function normalize(value: string) {
  return stripModelExtension(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function queryVariants(filename: string) {
  const withoutExtension = stripModelExtension(filename).trim();
  const withoutBracketPrefix = withoutExtension
    .replace(/^\[[^\]]+\]\s*/, "")
    .trim();
  const withoutVersionPrefix = withoutBracketPrefix
    .replace(/\bv(?:ersion)?\s*\d+(?:[._-]\d+)*\b/gi, "")
    .trim();

  return Array.from(
    new Set(
      [
        withoutExtension,
        withoutBracketPrefix,
        withoutVersionPrefix,
        withoutExtension.replace(/[_-]+/g, " "),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length >= 3)
    )
  ).slice(0, 4);
}

function resourceFromModel(
  model: CivitaiModel,
  version: CivitaiModelVersion,
  type: ResourceType
): ImportedCivitaiResource | null {
  const name = model.name?.trim();
  if (!name) return null;

  const primaryFile =
    version.files?.find((file) => file.primary)?.name ??
    version.files?.find((file) => file.name)?.name;

  return {
    type,
    name,
    versionName: version.name,
    baseModel: version.baseModel,
    fileName: primaryFile,
    modelId: model.id,
    modelVersionId: version.id,
    url: civitaiModelUrl(model.id, name, version.id),
  };
}

function candidateScore(
  model: CivitaiModel,
  version: CivitaiModelVersion,
  filename: string
) {
  const target = normalize(filename);
  if (!target) return 0;

  const fileNames = version.files
    ?.map((file) => file.name ?? "")
    .filter(Boolean) ?? [];
  if (fileNames.some((name) => normalize(name) === target)) return 100;

  const modelName = normalize(model.name ?? "");
  const versionName = normalize(version.name ?? "");
  const joined = normalize(`${model.name ?? ""} ${version.name ?? ""}`);

  if (modelName && modelName === target) return 85;
  if (versionName && versionName === target) return 80;
  if (joined && joined === target) return 78;
  if (target.length >= 8 && joined.includes(target)) return 65;
  if (target.length >= 8 && target.includes(joined)) return 55;

  return 0;
}

async function searchCivitaiModels(query: string, type: ResourceType) {
  const url = new URL("https://civitai.com/api/v1/models");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("sort", "Most Downloaded");

  const civitaiType = TYPE_QUERY[type];
  if (civitaiType) url.searchParams.set("types", civitaiType);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "image-gen-civitai-search/1.0",
    },
  });

  if (!response.ok) return [];
  const data = (await response.json()) as { items?: CivitaiModel[] };
  return data.items ?? [];
}

export async function searchCivitaiResourceByFilename(
  type: ResourceType,
  filename: string
) {
  if (type === "other") return null;

  let best:
    | { score: number; resource: ImportedCivitaiResource }
    | null = null;

  for (const query of queryVariants(filename)) {
    const models = await searchCivitaiModels(query, type);
    for (const model of models) {
      for (const version of model.modelVersions ?? []) {
        const score = candidateScore(model, version, filename);
        const resource = resourceFromModel(model, version, type);
        if (!resource || score < 65) continue;
        if (!best || score > best.score) best = { score, resource };
      }
    }
    if (best?.score === 100) break;
  }

  if (!best) return null;
  return best.resource;
}
