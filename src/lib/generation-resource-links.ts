import { readFile } from "fs/promises";
import type { GenerationParams } from "@/lib/types";
import { normalizeCivitaiModelUrl } from "@/lib/civitai-url";

const MODEL_CATALOG_PATH = "data/model-catalog.json";

interface LocalModelMetadata {
  name?: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
  civitai_url?: string | null;
  source_url?: string | null;
  tags?: string[];
}

export interface GenerationResourceLink {
  type: "checkpoint" | "lora" | "embedding" | "vae" | "upscaler";
  path: string;
  name: string;
  version: string;
  base_model: string;
  civitai_url: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  tags: string[];
  scale?: number;
  tokens?: string;
}

async function readCatalog() {
  try {
    return JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      LocalModelMetadata
    >;
  } catch {
    return {};
  }
}

function civitaiRedUrl(metadata: LocalModelMetadata | undefined) {
  const rawUrl = metadata?.civitai_url || metadata?.source_url || "";
  if (!rawUrl) return null;

  const normalized = normalizeCivitaiModelUrl({
    name: metadata?.name,
    fallbackUrl: rawUrl,
  });

  return /^https:\/\/civitai\.red\//i.test(normalized) ? normalized : null;
}

function resourceFromCatalog(
  catalog: Record<string, LocalModelMetadata>,
  type: GenerationResourceLink["type"],
  folder: string,
  path: string,
  extra: Pick<GenerationResourceLink, "scale" | "tokens"> = {}
): GenerationResourceLink {
  const metadata = catalog[`${folder}/${path}`];

  return {
    type,
    path,
    name: metadata?.name ?? path,
    version: metadata?.version ?? "",
    base_model: metadata?.base_model ?? "",
    civitai_url: civitaiRedUrl(metadata),
    source_url: metadata?.source_url ?? metadata?.civitai_url ?? null,
    thumbnail_url: metadata?.thumbnail_url ?? null,
    tags: metadata?.tags ?? [],
    ...extra,
  };
}

export async function buildGenerationResources(params: GenerationParams | null | undefined) {
  if (!params) return [] as GenerationResourceLink[];

  const catalog = await readCatalog();
  const resources: GenerationResourceLink[] = [];

  if (params.model_name) {
    resources.push(
      resourceFromCatalog(catalog, "checkpoint", "checkpoints", params.model_name)
    );
  }

  (params.loras ?? []).forEach((lora) => {
    if (!lora.path) return;
    resources.push(
      resourceFromCatalog(catalog, "lora", "loras", lora.path, {
        scale: lora.scale,
      })
    );
  });

  (params.embeddings ?? []).forEach((embedding) => {
    if (!embedding.path) return;
    resources.push(
      resourceFromCatalog(catalog, "embedding", "embeddings", embedding.path, {
        tokens: embedding.tokens,
      })
    );
  });

  if (params.vae_name) {
    resources.push(resourceFromCatalog(catalog, "vae", "vae", params.vae_name));
  }

  if (params.upscale_model_name) {
    resources.push(
      resourceFromCatalog(
        catalog,
        "upscaler",
        "upscale_models",
        params.upscale_model_name
      )
    );
  }

  return resources;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function enrichGenerationMetadata<T extends Record<string, unknown>>(
  metadata: T
) {
  const params = isRecord(metadata.params)
    ? (metadata.params as unknown as GenerationParams)
    : null;

  if (Array.isArray(metadata.resources) && metadata.resources.length > 0) {
    return metadata;
  }

  return {
    ...metadata,
    resources: await buildGenerationResources(params),
  };
}

export async function enrichGenerationMetadataJson(rawJson: string | Buffer) {
  const metadata = JSON.parse(rawJson.toString()) as unknown;

  if (!isRecord(metadata)) {
    return rawJson.toString();
  }

  return `${JSON.stringify(await enrichGenerationMetadata(metadata), null, 2)}\n`;
}
