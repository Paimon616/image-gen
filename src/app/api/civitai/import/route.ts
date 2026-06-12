import { NextRequest, NextResponse } from "next/server";
import {
  IMAGE_SIZE_CONSTRAINTS,
  type CivitaiImportResult,
  type GenerationParams,
  type ImportedCivitaiResource,
} from "@/lib/types";

const CIVITAI_IMAGE_URL_PATTERN =
  /(?:https?:\/\/)?(?:www\.)?(civitai\.(?:com|red))\/images\/(\d+)/i;
const DEFAULT_CIVITAI_ORIGIN = "https://civitai.com";

interface CivitaiImageItem {
  id: number;
  url?: string;
  width?: number;
  height?: number;
  username?: string;
  tags?: unknown;
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
  modelName?: unknown;
  modelType?: unknown;
  versionName?: unknown;
  baseModel?: unknown;
  strength?: unknown;
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
  };
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

  if (normalized.includes("lora")) return "lora";
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

function resourceUrl(resource: CivitaiResourceMeta, name: string) {
  const explicitUrl = stringValue(resource.url);
  if (explicitUrl) return explicitUrl;

  const modelId = numberValue(resource.modelId);
  const modelVersionId = numberValue(resource.modelVersionId);

  if (modelId) {
    const url = new URL(`https://civitai.com/models/${modelId}`);
    if (modelVersionId) {
      url.searchParams.set("modelVersionId", String(modelVersionId));
    }
    return url.toString();
  }

  const searchUrl = new URL("https://civitai.com/search/models");
  searchUrl.searchParams.set("query", name);
  return searchUrl.toString();
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
    imageData?.tagNamesNormalized
  );
  const image = {
    url: jsonLdImage?.url,
    width: numberValue(imageData?.width) ?? jsonLdImage?.width ?? undefined,
    height: numberValue(imageData?.height) ?? jsonLdImage?.height ?? undefined,
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
      const metaIndex = metaResources.findIndex((resource, index) => {
        return !usedMetaIndexes.has(index) && resource.type === type;
      });
      const metaResource = metaIndex >= 0 ? metaResources[metaIndex] : undefined;
      if (metaIndex >= 0) usedMetaIndexes.add(metaIndex);

      const modelId = numberValue(pageResource.modelId) ?? undefined;
      const modelVersionId = numberValue(pageResource.modelVersionId) ?? undefined;
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

function parseSize(meta: Record<string, unknown>, item: CivitaiImageItem) {
  const size = stringValue(meta.Size ?? meta.size);
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
  const width =
    match?.[1] ? Number(match[1]) : numberValue(meta.width) ?? numberValue(item.width);
  const height =
    match?.[2] ? Number(match[2]) : numberValue(meta.height) ?? numberValue(item.height);

  return {
    width: width ? clampImportedImageDimension(width) : undefined,
    height: height ? clampImportedImageDimension(height) : undefined,
  };
}

function parseSampler(rawSampler: string, rawScheduler = "") {
  const sampler = rawSampler.toLowerCase();
  const scheduler = rawScheduler.toLowerCase().includes("karras")
    ? "karras"
    : "normal";

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

function parseImportParams(meta: Record<string, unknown>, item: CivitaiImageItem) {
  const params: Partial<GenerationParams> = {
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
  const vaeName = stringValue(meta.VAE ?? meta.vae);
  const sampler = stringValue(meta.sampler ?? meta.Sampler);
  const scheduler = stringValue(
    meta.scheduler ?? meta.Scheduler ?? meta["Schedule type"] ?? meta["schedule type"]
  );
  const { width, height } = parseSize(meta, item);

  if (prompt) params.prompt = prompt;
  if (negativePrompt) params.negative_prompt = negativePrompt;
  if (steps) params.num_inference_steps = Math.round(steps);
  if (cfgScale) params.guidance_scale = cfgScale;
  if (seed) params.seed = Math.round(seed);
  if (clipSkip) params.clip_skip = Math.round(clipSkip);
  if (denoise) params.denoise_strength = denoise;
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
  const pageGenerationData = item?.meta
    ? null
    : await fetchGenerationDataFromPage(imageReference.id, imageReference.origin);
  if (pageGenerationData?.image) {
    itemForParsing.url = itemForParsing.url || pageGenerationData.image.url;
    itemForParsing.width = itemForParsing.width ?? pageGenerationData.image.width;
    itemForParsing.height = itemForParsing.height ?? pageGenerationData.image.height;
    itemForParsing.username =
      itemForParsing.username || pageGenerationData.image.username;
  }
  const meta = item?.meta ?? pageGenerationData?.meta;

  const pageResources = pageGenerationData?.resources ?? [];

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

  const resources = enrichResourcesWithPageData(
    meta ? parseResources(meta) : [],
    pageResources
  );
  const importedTags = normalizeImportedTags(
    item?.tags,
    meta?.tags,
    meta?.Tags,
    pageGenerationData?.importedTags
  );
  const checkpoint = resources.find((resource) => resource.type === "checkpoint");
  const loras = resources
    .filter((resource) => resource.type === "lora")
    .map((resource) => ({
      path: resource.name,
      scale: resource.weight ?? 0.8,
    }));
  const embeddings = resources
    .filter((resource) => resource.type === "embedding")
    .map((resource) => ({
      path: resource.name,
      tokens: resource.name,
    }));
  const vae = resources.find((resource) => resource.type === "vae");
  const upscaler = resources.find((resource) => resource.type === "upscaler");
  const params = parseImportParams(meta ?? {}, itemForParsing);

  if (checkpoint) params.model_name = checkpoint.name;
  if (loras.length > 0) params.loras = loras;
  if (embeddings.length > 0) params.embeddings = embeddings;
  if (vae && !params.vae_name) params.vae_name = vae.name;
  if (upscaler && !params.upscale_model_name) {
    params.upscale_model_name = upscaler.name;
  }

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
  } satisfies CivitaiImportResult);
}
