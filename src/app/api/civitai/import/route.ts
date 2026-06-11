import { NextRequest, NextResponse } from "next/server";
import {
  normalizeImageDimension,
  type CivitaiImportResult,
  type GenerationParams,
  type ImportedCivitaiResource,
} from "@/lib/types";

const CIVITAI_IMAGE_URL_PATTERN = /civitai\.com\/images\/(\d+)/i;

interface CivitaiImageItem {
  id: number;
  url?: string;
  width?: number;
  height?: number;
  username?: string;
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

function extractImageId(input: string) {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(CIVITAI_IMAGE_URL_PATTERN);
  if (urlMatch?.[1]) return Number(urlMatch[1]);

  const numericId = Number(trimmed);
  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
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

function normalizeResourceType(type: string): ImportedCivitaiResource["type"] {
  const normalized = type.toLowerCase().replace(/[\s_-]/g, "");

  if (normalized.includes("lora")) return "lora";
  if (normalized.includes("textualinversion") || normalized.includes("embedding")) {
    return "embedding";
  }
  if (normalized.includes("vae")) return "vae";
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

function parseSize(meta: Record<string, unknown>, item: CivitaiImageItem) {
  const size = stringValue(meta.Size ?? meta.size);
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
  const width = match?.[1] ? Number(match[1]) : numberValue(item.width);
  const height = match?.[2] ? Number(match[2]) : numberValue(item.height);

  return {
    width: width ? normalizeImageDimension(width) : undefined,
    height: height ? normalizeImageDimension(height) : undefined,
  };
}

function parseSampler(rawSampler: string) {
  const sampler = rawSampler.toLowerCase();

  if (sampler.includes("dpm++ 2m sde")) {
    return {
      sampler_name: "dpmpp_2m_sde",
      scheduler: sampler.includes("karras") ? "karras" : "normal",
    };
  }

  if (sampler.includes("dpm++ sde")) {
    return {
      sampler_name: "dpmpp_sde",
      scheduler: sampler.includes("karras") ? "karras" : "normal",
    };
  }

  if (sampler.includes("dpm++ 2m")) {
    return {
      sampler_name: "dpmpp_2m",
      scheduler: sampler.includes("karras") ? "karras" : "normal",
    };
  }

  if (sampler.includes("euler a")) {
    return { sampler_name: "euler_ancestral", scheduler: "normal" };
  }
  if (sampler.includes("euler")) return { sampler_name: "euler", scheduler: "normal" };
  if (sampler.includes("heun")) return { sampler_name: "heun", scheduler: "normal" };
  if (sampler.includes("lms")) return { sampler_name: "lms", scheduler: "normal" };
  if (sampler.includes("ddim")) return { sampler_name: "ddim", scheduler: "normal" };
  if (sampler.includes("unipc") || sampler.includes("uni_pc")) {
    return { sampler_name: "uni_pc", scheduler: "normal" };
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
  if (sampler) Object.assign(params, parseSampler(sampler));

  return params;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  const imageId = extractImageId(body?.url ?? "");

  if (!imageId) {
    return NextResponse.json(
      { error: "Civitai image URL or numeric image ID is required" },
      { status: 400 }
    );
  }

  const civitaiUrl = new URL("https://civitai.com/api/v1/images");
  civitaiUrl.searchParams.set("imageId", String(imageId));

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

  if (!item) {
    return NextResponse.json(
      { error: "Civitai image was not found or is not available through the API" },
      { status: 404 }
    );
  }

  if (!item.meta) {
    return NextResponse.json(
      {
        error:
          "This Civitai image does not expose generation metadata. It may be hidden or unavailable through the API.",
        imageId: item.id,
        imageUrl: item.url ?? "",
      },
      { status: 422 }
    );
  }

  const resources = parseResources(item.meta);
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
  const params = parseImportParams(item.meta, item);

  if (checkpoint) params.model_name = checkpoint.name;
  if (loras.length > 0) params.loras = loras;
  if (embeddings.length > 0) params.embeddings = embeddings;
  if (vae && !params.vae_name) params.vae_name = vae.name;

  return NextResponse.json({
    imageId: item.id,
    imageUrl: item.url ?? "",
    pageUrl: `https://civitai.com/images/${item.id}`,
    username: item.username,
    params,
    resources,
  } satisfies CivitaiImportResult);
}
