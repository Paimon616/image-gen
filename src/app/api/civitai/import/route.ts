import { NextRequest, NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "fs/promises";
import {
  IMAGE_SIZE_CONSTRAINTS,
  type CivitaiImportResult,
  type GenerationParams,
  type ImportedCivitaiResource,
} from "@/lib/types";
import { inferTagsFromPrompt } from "@/lib/prompt-tags";
import {
  buildCivitaiMetadataAdvice,
  recommendedCivitaiBackend,
} from "@/lib/civitai-metadata-advice";
import { isDiffusionOnlyImageCheckpointName } from "@/lib/comfyui-model-files";

const CIVITAI_IMAGE_URL_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?(civitai\.(?:com|red))\/images\/(\d+)/i;
const DEFAULT_CIVITAI_ORIGIN = "https://civitai.com";
const CIVITAI_LINK_ORIGIN = "https://civitai.red";
const MODEL_CATALOG_PATH = "data/model-catalog.json";

interface CivitaiImageItem {
  id: number;
  url?: string;
  width?: number;
  height?: number;
  username?: string;
  nsfwLevel?: unknown;
  tags?: unknown;
  tagNames?: unknown;
  tagNamesNormalized?: unknown;
  votableTags?: unknown;
  tagsOnImage?: unknown;
  meta?: Record<string, unknown> | null;
}

interface CivitaiResourceMeta {
  name?: unknown;
  type?: unknown;
  weight?: unknown;
  hash?: unknown;
  modelId?: unknown;
  modelVersionId?: unknown;
  url?: unknown;
}

interface CivitaiPageResource {
  modelId?: unknown;
  modelVersionId?: unknown;
  versionId?: unknown;
  modelName?: unknown;
  modelType?: unknown;
  versionName?: unknown;
  baseModel?: unknown;
  strength?: unknown;
}

interface CatalogEntry {
  name?: string;
  version?: string;
  base_model?: string;
  civitai_url?: string | null;
  source_url?: string | null;
  thumbnail_url?: string | null;
  tags?: string[];
}

interface CivitaiVersionFile {
  name?: string;
  primary?: boolean;
  type?: string;
}

interface CivitaiVersionImage {
  url?: string;
}

interface CivitaiVersionModel {
  tags?: string[];
}

interface CivitaiVersionDetails {
  name?: string;
  baseModel?: string;
  trainedWords?: string[];
  files?: CivitaiVersionFile[];
  images?: CivitaiVersionImage[];
  model?: CivitaiVersionModel;
}

interface CivitaiPageGenerationData {
  meta?: Record<string, unknown> | null;
  resources?: CivitaiPageResource[];
  importedTags?: string[];
  image?: {
    url?: string;
    width?: number;
    height?: number;
    username?: string;
    nsfwLevel?: number;
  };
}

interface CivitaiVotableTag {
  name?: unknown;
}

function extractImageReference(input: string) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(CIVITAI_IMAGE_URL_PATTERN);
  if (urlMatch?.[1] && urlMatch[2]) {
    return {
      id: Number(urlMatch[2]),
      origin: `https://${urlMatch[1].toLowerCase()}`,
    };
  }

  const numericId = Number(trimmed);
  if (Number.isInteger(numericId) && numericId > 0) {
    return { id: numericId, origin: DEFAULT_CIVITAI_ORIGIN };
  }

  return null;
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

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeImportedTags(...sources: unknown[]) {
  const tags = sources.flatMap((source) => {
    if (!source) return [];

    if (typeof source === "string") {
      return source.split(/[,，\n]/);
    }

    if (!Array.isArray(source)) {
      const record = recordValue(source);
      const name = record
        ? stringValue(record.name ?? record.tag ?? record.label ?? record.value)
        : "";

      return name ? [name] : [];
    }

    return source.flatMap((item) => {
      if (typeof item === "string") return [item];

      const record = recordValue(item);
      if (!record) return [];

      return [
        stringValue(record.name),
        stringValue(record.tag),
        stringValue(record.label),
        stringValue(record.value),
      ].filter(Boolean);
    });
  });

  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && tag.length <= 80)
    )
  ).slice(0, 64);
}

function normalizeResourceType(type: string): ImportedCivitaiResource["type"] {
  const normalized = type.toLowerCase().replace(/[\s_-]/g, "");

  if (
    normalized.includes("lora") ||
    normalized.includes("lycoris") ||
    normalized.includes("locon") ||
    normalized.includes("loha")
  ) {
    return "lora";
  }
  if (normalized.includes("textualinversion") || normalized.includes("embedding")) {
    return "embedding";
  }
  if (normalized.includes("vae")) return "vae";
  if (normalized.includes("upscaler") || normalized.includes("upscale")) {
    return "upscaler";
  }
  if (normalized.includes("checkpoint") || normalized === "model") return "checkpoint";

  return "other";
}

function normalizeCivitaiLinkUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (/^(www\.)?civitai\.(com|red)$/i.test(url.hostname)) {
      url.protocol = "https:";
      url.hostname = "civitai.red";
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function modelUrlSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function resourceUrl(resource: CivitaiResourceMeta, name: string) {
  const explicitUrl = stringValue(resource.url);
  if (explicitUrl) return normalizeCivitaiLinkUrl(explicitUrl);

  const modelId = numberValue(resource.modelId);
  const modelVersionId = numberValue(resource.modelVersionId);

  if (modelId) {
    const slug = modelUrlSlug(name);
    const url = new URL(
      `${CIVITAI_LINK_ORIGIN}/models/${modelId}${slug ? `/${slug}` : ""}`
    );
    if (modelVersionId) {
      url.searchParams.set("modelVersionId", String(modelVersionId));
    }
    return url.toString();
  }

  return "";
}

function extractNextData(html: string) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!match?.[1]) return null;

  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return null;
  }
}

function clampImportedImageDimension(value: number) {
  const { min, max } = IMAGE_SIZE_CONSTRAINTS;

  return Math.min(Math.max(Math.round(value), min), max);
}

function extractJsonLdImage(html: string) {
  const matches = html.matchAll(
    /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g
  );

  for (const match of matches) {
    if (!match[1]) continue;

    try {
      const data = recordValue(JSON.parse(match[1]));
      if (data?.["@type"] !== "ImageObject") continue;

      return {
        url: stringValue(data.contentUrl),
        width: numberValue(data.width) ?? undefined,
        height: numberValue(data.height) ?? undefined,
        username: stringValue(recordValue(data.creator)?.name) || undefined,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function getNestedRecord(root: Record<string, unknown>, path: string[]) {
  return path.reduce<Record<string, unknown> | null>((current, key) => {
    if (!current) return null;
    return recordValue(current[key]);
  }, root);
}

function isGenerationDataQuery(query: Record<string, unknown>) {
  const queryKey = query.queryKey;

  if (Array.isArray(queryKey) && Array.isArray(queryKey[0])) {
    const firstKey = queryKey[0];
    if (firstKey[0] === "image" && firstKey[1] === "getGenerationData") {
      return true;
    }
  }

  const state = recordValue(query.state);
  const data = state ? recordValue(state.data) : null;
  const meta = data ? recordValue(data.meta) : null;
  const resources = data && Array.isArray(data.resources) ? data.resources : [];

  return Boolean(
    resources.length > 0 ||
      (meta && (stringValue(meta.prompt) || Array.isArray(meta.resources)))
  );
}

function extractGenerationDataFromPageHtml(html: string): CivitaiPageGenerationData | null {
  const nextData = recordValue(extractNextData(html));
  const jsonLdImage = extractJsonLdImage(html);
  if (!nextData) return null;

  const trpcState = getNestedRecord(nextData, [
    "props",
    "pageProps",
    "trpcState",
    "json",
  ]);
  const queries = Array.isArray(trpcState?.queries) ? trpcState.queries : [];
  const queryRecords = queries
    .map(recordValue)
    .filter((query): query is Record<string, unknown> => Boolean(query));
  const imageQuery = queryRecords.find((query) => {
    const state = recordValue(query.state);
    const data = state ? recordValue(state.data) : null;

    return Boolean(data && numberValue(data.id) && stringValue(data.url));
  });
  const generationQuery = queryRecords.find((query) => {
      return Boolean(query && isGenerationDataQuery(query));
    });

  if (!generationQuery) return null;

  const state = recordValue(generationQuery.state);
  const data = state ? recordValue(state.data) : null;
  if (!data) return null;

  const meta = recordValue(data.meta);
  const resources = Array.isArray(data.resources)
    ? data.resources.filter(
        (resource): resource is CivitaiPageResource =>
          Boolean(resource && typeof resource === "object" && !Array.isArray(resource))
      )
    : [];
  const imageData = imageQuery ? recordValue(recordValue(imageQuery.state)?.data) : null;
  const user = imageData ? recordValue(imageData.user) : null;
  const importedTags = normalizeImportedTags(
    imageData?.tags,
    imageData?.tagNames,
    imageData?.tagNamesNormalized,
    imageData?.votableTags,
    imageData?.tagsOnImage
  );
  const image = {
    url: jsonLdImage?.url,
    width: numberValue(imageData?.width) ?? jsonLdImage?.width ?? undefined,
    height: numberValue(imageData?.height) ?? jsonLdImage?.height ?? undefined,
    nsfwLevel: numberValue(imageData?.nsfwLevel) ?? undefined,
    username: stringValue(user?.username) || jsonLdImage?.username || undefined,
  };

  return { meta, resources, importedTags, image };
}

async function fetchGenerationDataFromPage(imageId: number, origin: string) {
  const response = await fetch(`${origin}/images/${imageId}`, {
    headers: {
      Accept: "text/html",
      "User-Agent": "image-gen-civitai-import/1.0",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) return null;

  return extractGenerationDataFromPageHtml(await response.text());
}

async function fetchGenerationDataFromPageOrigins(imageId: number, origin: string) {
  const origins = Array.from(new Set([origin, DEFAULT_CIVITAI_ORIGIN]));

  for (const currentOrigin of origins) {
    const pageGenerationData = await fetchGenerationDataFromPage(
      imageId,
      currentOrigin
    );

    if (pageGenerationData?.meta || (pageGenerationData?.resources?.length ?? 0) > 0) {
      return pageGenerationData;
    }
  }

  return null;
}

async function fetchVotableTags(imageId: number, origin: string) {
  const input = encodeURIComponent(
    JSON.stringify({
      0: {
        json: {
          type: "image",
          id: imageId,
        },
      },
    })
  );
  const response = await fetch(
    `${origin}/api/trpc/tag.getVotableTags?batch=1&input=${input}`,
    {
      headers: {
        Accept: "application/json",
        Referer: `${origin}/images/${imageId}`,
        "User-Agent": "image-gen-civitai-import/1.0",
      },
      next: { revalidate: 0 },
    }
  );

  if (!response.ok) return [];

  const data = await response.json().catch(() => null);
  const batchItem = Array.isArray(data) ? recordValue(data[0]) : null;
  const result = batchItem ? recordValue(batchItem.result) : null;
  const resultData = result ? recordValue(result.data) : null;
  const tags = Array.isArray(resultData?.json) ? resultData.json : [];

  return normalizeImportedTags(
    tags.filter((tag): tag is CivitaiVotableTag => Boolean(recordValue(tag)))
  );
}

async function fetchVotableTagsFromOrigins(imageId: number, origin: string) {
  const origins = Array.from(new Set([origin, DEFAULT_CIVITAI_ORIGIN]));

  for (const currentOrigin of origins) {
    const tags = await fetchVotableTags(imageId, currentOrigin);
    if (tags.length > 0) return tags;
  }

  return [];
}

function parseResources(meta: Record<string, unknown>) {
  const rawResources = Array.isArray(meta.resources) ? meta.resources : [];

  return rawResources
    .filter((resource): resource is CivitaiResourceMeta => {
      return Boolean(resource && typeof resource === "object");
    })
    .map((resource) => {
      const name = stringValue(resource.name);
      if (!name) return null;

      const type = normalizeResourceType(stringValue(resource.type));
      const weight = numberValue(resource.weight) ?? undefined;
      const hash = stringValue(resource.hash) || undefined;
      const modelId = numberValue(resource.modelId) ?? undefined;
      const modelVersionId = numberValue(resource.modelVersionId) ?? undefined;

      const importedResource: ImportedCivitaiResource = {
        type,
        name,
        url: resourceUrl(resource, name),
      };

      if (weight !== undefined) importedResource.weight = weight;
      if (hash !== undefined) importedResource.hash = hash;
      if (modelId !== undefined) importedResource.modelId = modelId;
      if (modelVersionId !== undefined) {
        importedResource.modelVersionId = modelVersionId;
      }

      return importedResource;
    })
    .filter((resource): resource is ImportedCivitaiResource => resource !== null);
}

function normalizeResourceName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function embeddingResourceName(resource: ImportedCivitaiResource) {
  const versionName = stringValue(resource.versionName);
  const source = versionName || resource.name;
  const lazyToken = source.match(/\b(lazypos|lazyneg|lazyhand)\b/i)?.[1];

  return lazyToken ? lazyToken.toLowerCase() : source;
}

function embeddingResourcePath(resource: ImportedCivitaiResource) {
  const name = resource.fileName || embeddingResourceName(resource);
  return /\.(ckpt|pt|pth|safetensors)$/i.test(name) ? name : `${name}.safetensors`;
}

async function fetchVersionDetails(modelVersionId: number) {
  const response = await fetch(
    `https://civitai.com/api/v1/model-versions/${modelVersionId}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "image-gen-civitai-import/1.0",
      },
    }
  );
  if (!response.ok) return null;

  const data = (await response.json()) as CivitaiVersionDetails;
  const files = (data.files ?? []).filter((file) => file.name?.trim());
  const primary =
    files.find((file) => file.primary) ??
    files.find((file) => /model/i.test(file.type ?? "")) ??
    files[0];
  const thumbnailUrl = data.images?.find((image) => image.url?.trim())?.url?.trim();
  const tags = normalizeImportedTags(data.model?.tags, data.trainedWords);

  return {
    fileName: primary?.name?.trim() ?? "",
    versionName: data.name?.trim() || undefined,
    baseModel: data.baseModel?.trim() || undefined,
    thumbnailUrl,
    tags,
  };
}

async function enrichResourcesWithFileNames(resources: ImportedCivitaiResource[]) {
  return Promise.all(
    resources.map(async (resource) => {
      if (!resource.modelVersionId) return resource;
      if (!["checkpoint", "lora", "embedding", "vae", "upscaler"].includes(resource.type)) {
        return resource;
      }
      const details = await fetchVersionDetails(resource.modelVersionId);
      if (!details) return resource;

      return {
        ...resource,
        fileName: resource.fileName || details.fileName || undefined,
        versionName: resource.versionName || details.versionName,
        baseModel: resource.baseModel || details.baseModel,
        thumbnailUrl: resource.thumbnailUrl || details.thumbnailUrl,
        tags:
          resource.tags && resource.tags.length > 0
            ? resource.tags
            : details.tags.length > 0
              ? details.tags
              : undefined,
      };
    })
  );
}

async function readCatalog() {
  try {
    return JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      CatalogEntry
    >;
  } catch {
    return {};
  }
}

async function writeCatalog(catalog: Record<string, CatalogEntry>) {
  await mkdir("data", { recursive: true });
  await writeFile(MODEL_CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function resourceCatalogPath(resource: ImportedCivitaiResource) {
  if (resource.type === "checkpoint") {
    const name = resource.fileName || resource.name;
    const folder = isDiffusionOnlyImageCheckpointName(resource.name)
      ? "diffusion_models"
      : "checkpoints";
    return `${folder}/${name}`;
  }
  if (resource.type === "lora") return `loras/${resource.fileName || resource.name}`;
  if (resource.type === "embedding") return `embeddings/${embeddingResourcePath(resource)}`;
  if (resource.type === "vae") return `vae/${resource.name}`;
  if (resource.type === "upscaler") return `upscale_models/${resource.name}`;
  return "";
}

async function upsertImportedResourcesCatalog(
  resources: ImportedCivitaiResource[],
  params: Partial<GenerationParams>
) {
  const downloadable = resources.filter(
    (resource) => resource.url && resource.modelVersionId
  );
  if (downloadable.length === 0) return;

  const catalog = await readCatalog();
  let changed = false;

  const explicitKeys = new Map<ImportedCivitaiResource, string>();
  const checkpoint = downloadable.find((resource) => resource.type === "checkpoint");
  if (checkpoint && params.model_name) {
    explicitKeys.set(
      checkpoint,
      `${isDiffusionOnlyImageCheckpointName(params.model_name) ? "diffusion_models" : "checkpoints"}/${params.model_name}`
    );
  }

  const loraResources = downloadable.filter((resource) => resource.type === "lora");
  (params.loras ?? []).forEach((lora, index) => {
    const resource = loraResources[index];
    if (resource && lora.path) explicitKeys.set(resource, `loras/${lora.path}`);
  });

  const embeddingResources = downloadable.filter(
    (resource) => resource.type === "embedding"
  );
  (params.embeddings ?? []).forEach((embedding, index) => {
    const resource = embeddingResources[index];
    if (resource && embedding.path) {
      explicitKeys.set(resource, `embeddings/${embedding.path}`);
    }
  });

  const vae = downloadable.find((resource) => resource.type === "vae");
  if (vae && params.vae_name) explicitKeys.set(vae, `vae/${params.vae_name}`);

  const upscaler = downloadable.find((resource) => resource.type === "upscaler");
  if (upscaler && params.upscale_model_name) {
    explicitKeys.set(upscaler, `upscale_models/${params.upscale_model_name}`);
  }

  for (const resource of downloadable) {
    const key = explicitKeys.get(resource) ?? resourceCatalogPath(resource);
    if (!key) continue;

    const filename = key.split("/").pop() || resource.name;
    const existing = catalog[key] ?? {};
    const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
    catalog[key] = {
      ...existing,
      name: existing.name || resource.name || filename,
      version: existing.version || resource.versionName || "",
      base_model: existing.base_model || resource.baseModel || "",
      civitai_url: existing.civitai_url || resource.url || null,
      source_url: existing.source_url || resource.url || null,
      thumbnail_url: existing.thumbnail_url || resource.thumbnailUrl || null,
      tags:
        existingTags.length > 0
          ? existingTags
          : resource.tags && resource.tags.length > 0
            ? resource.tags
            : existing.tags,
    };
    changed = true;
  }

  if (changed) await writeCatalog(catalog);
}

function resourceNamesMatch(resource: ImportedCivitaiResource, pageResource: CivitaiPageResource) {
  const resourceName = normalizeResourceName(resource.name);
  if (!resourceName) return false;

  const modelName = stringValue(pageResource.modelName);
  const versionName = stringValue(pageResource.versionName);
  const candidates = [
    modelName,
    versionName,
    modelName && versionName ? `${modelName} ${versionName}` : "",
    modelName && versionName ? `${modelName}-${versionName}` : "",
  ]
    .map(normalizeResourceName)
    .filter(Boolean);

  return candidates.some((candidate) => {
    return candidate.includes(resourceName) || resourceName.includes(candidate);
  });
}

function findMetaResourceIndex(
  metaResources: ImportedCivitaiResource[],
  usedMetaIndexes: Set<number>,
  pageResource: CivitaiPageResource,
  type: ImportedCivitaiResource["type"]
) {
  const modelId = numberValue(pageResource.modelId);
  const modelVersionId =
    numberValue(pageResource.modelVersionId) ?? numberValue(pageResource.versionId);

  const availableResourceIndexes = metaResources
    .map((resource, index) => ({ resource, index }))
    .filter(({ resource, index }) => {
      return !usedMetaIndexes.has(index) && resource.type === type;
    });

  const idMatch = availableResourceIndexes.find(({ resource }) => {
    return (
      Boolean(modelId && resource.modelId === modelId) ||
      Boolean(modelVersionId && resource.modelVersionId === modelVersionId)
    );
  });
  if (idMatch) return idMatch.index;

  const nameMatch = availableResourceIndexes.find(({ resource }) => {
    return resourceNamesMatch(resource, pageResource);
  });
  if (nameMatch) return nameMatch.index;

  if (availableResourceIndexes.length === 1) {
    return availableResourceIndexes[0].index;
  }

  return -1;
}

function enrichResourcesWithPageData(
  metaResources: ImportedCivitaiResource[],
  pageResources: CivitaiPageResource[] = []
) {
  if (pageResources.length === 0) return metaResources;

  const usedMetaIndexes = new Set<number>();
  const enriched = pageResources
    .map((pageResource) => {
      const name =
        stringValue(pageResource.modelName) || stringValue(pageResource.versionName);
      if (!name) return null;

      const type = normalizeResourceType(stringValue(pageResource.modelType));
      const metaIndex = findMetaResourceIndex(
        metaResources,
        usedMetaIndexes,
        pageResource,
        type
      );
      const metaResource = metaIndex >= 0 ? metaResources[metaIndex] : undefined;
      if (metaIndex >= 0) usedMetaIndexes.add(metaIndex);

      const modelId = numberValue(pageResource.modelId) ?? undefined;
      const modelVersionId =
        numberValue(pageResource.modelVersionId) ??
        numberValue(pageResource.versionId) ??
        undefined;
      const versionName = stringValue(pageResource.versionName) || undefined;
      const baseModel = stringValue(pageResource.baseModel) || undefined;
      const weight =
        numberValue(pageResource.strength) ?? metaResource?.weight ?? undefined;
      const hash = metaResource?.hash;
      const importedResource: ImportedCivitaiResource = {
        type,
        name,
        url: resourceUrl({ modelId, modelVersionId }, name),
      };

      if (weight !== undefined) importedResource.weight = weight;
      if (hash !== undefined) importedResource.hash = hash;
      if (versionName !== undefined) importedResource.versionName = versionName;
      if (baseModel !== undefined) importedResource.baseModel = baseModel;
      if (modelId !== undefined) importedResource.modelId = modelId;
      if (modelVersionId !== undefined) {
        importedResource.modelVersionId = modelVersionId;
      }

      return importedResource;
    })
    .filter((resource): resource is ImportedCivitaiResource => resource !== null);
  const remainingMetaResources = metaResources.filter((_, index) => {
    return !usedMetaIndexes.has(index);
  });

  return [...enriched, ...remainingMetaResources];
}

function parseSize(
  meta: Record<string, unknown>,
  item: CivitaiImageItem,
  shouldInferHires: boolean
) {
  const size = stringValue(meta.Size ?? meta.size);
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
  let width =
    match?.[1] ? Number(match[1]) : numberValue(meta.width) ?? numberValue(item.width);
  let height =
    match?.[2] ? Number(match[2]) : numberValue(meta.height) ?? numberValue(item.height);

  // Civitai often reports final post-upscale dimensions instead of the base pass.
  const inferredHires =
    !match &&
    shouldInferHires &&
    Boolean(
      width &&
        height &&
        (Math.max(width, height) > 1536 || width * height > 2_000_000)
    );
  if (inferredHires && width && height) {
    width = Math.round(width / 2 / 8) * 8;
    height = Math.round(height / 2 / 8) * 8;
  }

  return {
    width: width ? clampImportedImageDimension(width) : undefined,
    height: height ? clampImportedImageDimension(height) : undefined,
    inferredHires,
  };
}

function parseSampler(rawSampler: string, rawScheduler = "") {
  const sampler = rawSampler.toLowerCase();
  const schedulerText = `${rawSampler} ${rawScheduler}`.toLowerCase();
  const scheduler = schedulerText.includes("karras")
    ? "karras"
    : schedulerText.includes("simple")
      ? "simple"
      : "normal";

  if (sampler.includes("er_sde")) {
    return { sampler_name: "er_sde", scheduler };
  }

  if (sampler.includes("dpm++ 2m sde")) {
    return {
      sampler_name: "dpmpp_2m_sde",
      scheduler: sampler.includes("karras") ? "karras" : scheduler,
    };
  }

  if (sampler.includes("dpm++ sde")) {
    return {
      sampler_name: "dpmpp_sde",
      scheduler: sampler.includes("karras") ? "karras" : scheduler,
    };
  }

  if (sampler.includes("dpm++ 2m")) {
    return {
      sampler_name: "dpmpp_2m",
      scheduler: sampler.includes("karras") ? "karras" : scheduler,
    };
  }

  if (sampler.includes("euler a")) {
    return { sampler_name: "euler_ancestral", scheduler };
  }
  if (sampler.includes("euler")) return { sampler_name: "euler", scheduler };
  if (sampler.includes("heun")) return { sampler_name: "heun", scheduler };
  if (sampler.includes("lms")) return { sampler_name: "lms", scheduler };
  if (sampler.includes("ddim")) return { sampler_name: "ddim", scheduler };
  if (sampler.includes("unipc") || sampler.includes("uni_pc")) {
    return { sampler_name: "uni_pc", scheduler };
  }

  return {};
}

function ensureModelExtension(value: string) {
  return /\.(ckpt|pt|pth|safetensors)$/i.test(value) ? value : `${value}.safetensors`;
}

// ComfyUI images publish the exact checkpoint/unet file that was loaded in
// `meta.models` (and `meta.Model`), using Windows-style paths. This is the
// ground truth for which local file to select, so prefer it over the Civitai
// version's canonical primary file (which can be a different variant).
function comfyModelFileName(meta: Record<string, unknown>) {
  const fromModels = Array.isArray(meta.models)
    ? meta.models.map(stringValue).find(Boolean)
    : "";
  const raw = fromModels || stringValue(meta.Model ?? meta.model);
  if (!raw) return "";

  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  return base ? ensureModelExtension(base) : "";
}

function parseImportParams(meta: Record<string, unknown>, item: CivitaiImageItem) {
  const modelName = stringValue(meta.Model ?? meta.model ?? meta.ModelName);
  const backendRecommendation = recommendedCivitaiBackend(meta);
  const usesA1111 = backendRecommendation.backend !== "comfyui";
  const params: Partial<GenerationParams> = {
    backend: backendRecommendation.backend,
    generation_mode: "text_to_image",
    output_format: "jpeg",
  };
  const prompt = stringValue(meta.prompt ?? meta.Prompt);
  const negativePrompt = stringValue(
    meta.negativePrompt ?? meta.negative_prompt ?? meta["Negative prompt"]
  );
  const steps = numberValue(meta.steps ?? meta.Steps);
  const cfgScale = numberValue(meta.cfgScale ?? meta["CFG scale"] ?? meta.cfg);
  const seed = numberValue(meta.seed ?? meta.Seed);
  const clipSkip = numberValue(meta["Clip skip"] ?? meta.clipSkip);
  const denoise = numberValue(meta["Denoising strength"] ?? meta.denoisingStrength);
  const hiresUpscale = numberValue(meta["Hires upscale"] ?? meta.hiresUpscale);
  const hiresSteps = numberValue(meta["Hires steps"] ?? meta.hiresSteps);
  const hiresUpscaler = stringValue(meta["Hires upscaler"] ?? meta.hiresUpscaler);
  const vaeName = stringValue(meta.VAE ?? meta.vae);
  const sampler = stringValue(meta.sampler ?? meta.Sampler);
  const scheduler = stringValue(
    meta.scheduler ?? meta.Scheduler ?? meta["Schedule type"] ?? meta["schedule type"]
  );
  const isKrea2 = /krea[-_ ]?2/i.test(modelName);
  const { width, height, inferredHires } = parseSize(
    meta,
    item,
    isKrea2 || usesA1111
  );

  if (prompt) params.prompt = prompt;
  if (negativePrompt) params.negative_prompt = negativePrompt;
  if (steps) params.num_inference_steps = Math.round(steps);
  if (cfgScale) params.guidance_scale = cfgScale;
  if (seed) params.seed = Math.round(seed);
  if (clipSkip) params.clip_skip = Math.round(clipSkip);
  else if (usesA1111) params.clip_skip = 1;
  if (denoise) params.denoise_strength = denoise;
  if (hiresUpscale && hiresUpscale > 1) params.hires_upscale = hiresUpscale;
  else if (inferredHires) params.hires_upscale = 2;
  if (hiresSteps) params.hires_steps = Math.round(hiresSteps);
  else if (hiresUpscale && hiresUpscale > 1) params.hires_steps = 0;
  if (hiresUpscaler && hiresUpscaler.toLowerCase() !== "none") {
    params.upscale_model_name =
      hiresUpscaler.toLowerCase() === "esrgan_4x" ? "ESRGAN_4x.pth" : hiresUpscaler;
  }
  if (vaeName) params.vae_name = vaeName;
  if (width) params.width = width;
  if (height) params.height = height;
  if (sampler) Object.assign(params, parseSampler(sampler, scheduler));

  return params;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const imageReference = extractImageReference(body?.url ?? "");

  if (!imageReference) {
    return NextResponse.json(
      { error: "Civitai image URL or numeric image ID is required" },
      { status: 400 }
    );
  }

  const civitaiUrl = new URL("https://civitai.com/api/v1/images");
  civitaiUrl.searchParams.set("imageId", String(imageReference.id));

  const response = await fetch(civitaiUrl, {
    headers: {
      Accept: "application/json",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Civitai request failed: ${response.status}` },
      { status: 502 }
    );
  }

  const data = (await response.json()) as { items?: CivitaiImageItem[] };
  const item = data.items?.[0];
  const itemForParsing: CivitaiImageItem = item ?? { id: imageReference.id };
  const pageGenerationData = await fetchGenerationDataFromPageOrigins(
    imageReference.id,
    imageReference.origin
  );
  if (pageGenerationData?.image) {
    itemForParsing.url = itemForParsing.url || pageGenerationData.image.url;
    itemForParsing.width = itemForParsing.width ?? pageGenerationData.image.width;
    itemForParsing.height = itemForParsing.height ?? pageGenerationData.image.height;
    itemForParsing.username =
      itemForParsing.username || pageGenerationData.image.username;
  }
  const meta = item?.meta ?? pageGenerationData?.meta;

  const pageResources = pageGenerationData?.resources ?? [];
  const votableTags = await fetchVotableTagsFromOrigins(
    imageReference.id,
    imageReference.origin
  );

  if (!meta && pageResources.length === 0) {
    return NextResponse.json(
      {
        error:
          "This Civitai image does not expose generation metadata. It may be hidden or unavailable through the API and page data.",
        imageId: imageReference.id,
        imageUrl: item?.url ?? "",
      },
      { status: item ? 422 : 404 }
    );
  }

  const resources = await enrichResourcesWithFileNames(enrichResourcesWithPageData(
    meta ? parseResources(meta) : [],
    pageResources
  ));
  const importedTags = normalizeImportedTags(
    item?.tags,
    item?.tagNames,
    item?.tagNamesNormalized,
    item?.votableTags,
    item?.tagsOnImage,
    meta?.tags,
    meta?.Tags,
    pageGenerationData?.importedTags,
    votableTags,
    inferTagsFromPrompt(
      stringValue(meta?.prompt ?? meta?.Prompt),
      numberValue(item?.nsfwLevel) ?? pageGenerationData?.image?.nsfwLevel
    )
  );
  const checkpoint = resources.find((resource) => resource.type === "checkpoint");
  if (checkpoint && meta && (meta.comfy || Array.isArray(meta.models))) {
    const comfyFile = comfyModelFileName(meta);
    if (comfyFile) checkpoint.fileName = comfyFile;
  }
  const promptLoraWeights = [
    ...stringValue(meta?.prompt ?? meta?.Prompt).matchAll(
      /<lora:[^:>]+:([-+]?\d*\.?\d+)>/gi
    ),
  ].map((match) => Number(match[1]));
  const loras = resources
    .filter((resource) => resource.type === "lora")
    .map((resource, index) => ({
      path: resource.fileName || resource.name,
      scale: Number.isFinite(promptLoraWeights[index])
        ? promptLoraWeights[index]
        : resource.weight ?? 0.8,
    }));
  const embeddings = resources
    .filter((resource) => resource.type === "embedding")
    .map((resource) => ({
      path: embeddingResourcePath(resource),
      tokens: embeddingResourceName(resource),
    }));
  const vae = resources.find((resource) => resource.type === "vae");
  const upscaler = resources.find((resource) => resource.type === "upscaler");
  const params = parseImportParams(meta ?? {}, itemForParsing);

  if (
    checkpoint?.baseModel &&
    /^SD\s*1(?:\.|$)/i.test(checkpoint.baseModel) &&
    !stringValue(meta?.Version ?? meta?.version)
  ) {
    params.backend = "a1111";
  }

  if (checkpoint) params.model_name = checkpoint.fileName || checkpoint.name;
  if (loras.length > 0) params.loras = loras;
  if (embeddings.length > 0) params.embeddings = embeddings;
  if (vae && !params.vae_name) params.vae_name = vae.fileName || vae.name;
  if (upscaler && !params.upscale_model_name) {
    params.upscale_model_name = upscaler.fileName || upscaler.name;
  }

  const advice = buildCivitaiMetadataAdvice({
    meta: meta ?? {},
    params,
    imageWidth: itemForParsing.width,
    imageHeight: itemForParsing.height,
    metadataHidden: !meta,
    baseModel: checkpoint?.baseModel,
  });

  await upsertImportedResourcesCatalog(resources, params);

  return NextResponse.json({
    imageId: itemForParsing.id,
    imageUrl: itemForParsing.url ?? "",
    pageUrl: `${imageReference.origin}/images/${itemForParsing.id}`,
    username: itemForParsing.username,
    importedTags,
    metadataHidden: !meta,
    warning: !meta
      ? "Prompt and generation metadata are hidden on Civitai. Imported available image size and resource links only."
      : undefined,
    params,
    resources,
    ...advice,
  } satisfies CivitaiImportResult);
}
