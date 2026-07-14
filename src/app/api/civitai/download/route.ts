import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { basename, join, normalize } from "path";
import { NextRequest, NextResponse } from "next/server";
import { COMFYUI_MODELS_DIR } from "@/lib/comfyui-model-files";
import { normalizeCivitaiModelUrl, parseCivitaiUrlIds } from "@/lib/civitai-url";
import type { CivitaiLicenseInfo, ImportedCivitaiResource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODEL_CATALOG_PATH = "data/model-catalog.json";
const encoder = new TextEncoder();

const RESOURCE_FOLDERS: Partial<Record<ImportedCivitaiResource["type"], string>> = {
  checkpoint: "checkpoints",
  lora: "loras",
  embedding: "embeddings",
  vae: "vae",
  upscaler: "upscale_models",
};

interface LocalModelMetadata {
  name: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
  civitai_url?: string | null;
  source_url?: string | null;
  tags?: string[];
  license?: CivitaiLicenseInfo;
}

interface CivitaiModelVersion {
  id: number;
  name?: string;
  baseModel?: string;
  trainedWords?: string[];
  images?: {
    url?: string;
    type?: string;
  }[];
}

interface CivitaiModel {
  name?: string;
  tags?: string[];
  modelVersions?: CivitaiModelVersion[];
  allowNoCredit?: unknown;
  allowCommercialUse?: unknown;
  allowDerivatives?: unknown;
  allowDifferentLicense?: unknown;
}

function parseLicense(model: CivitaiModel): CivitaiLicenseInfo | undefined {
  const license: CivitaiLicenseInfo = {};

  if (typeof model.allowNoCredit === "boolean") {
    license.allowNoCredit = model.allowNoCredit;
  }
  if (typeof model.allowDerivatives === "boolean") {
    license.allowDerivatives = model.allowDerivatives;
  }
  if (typeof model.allowDifferentLicense === "boolean") {
    license.allowDifferentLicense = model.allowDifferentLicense;
  }
  if (Array.isArray(model.allowCommercialUse)) {
    license.allowCommercialUse = model.allowCommercialUse
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else if (typeof model.allowCommercialUse === "string") {
    license.allowCommercialUse = [model.allowCommercialUse.trim()].filter(Boolean);
  }

  return Object.keys(license).length > 0 ? license : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseResource(value: unknown): ImportedCivitaiResource | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const type = stringValue(record.type) as ImportedCivitaiResource["type"] | undefined;
  const name = stringValue(record.name);
  const url = stringValue(record.url);
  const modelVersionId = numberValue(record.modelVersionId);

  if (!type || !name || !url || !modelVersionId) return null;
  if (!RESOURCE_FOLDERS[type]) return null;

  const resource: ImportedCivitaiResource = {
    type,
    name,
    url,
    modelVersionId,
  };
  const versionName = stringValue(record.versionName);
  const baseModel = stringValue(record.baseModel);
  const hash = stringValue(record.hash);
  const modelId = numberValue(record.modelId);
  const weight = numberValue(record.weight);

  if (versionName !== undefined) resource.versionName = versionName;
  if (baseModel !== undefined) resource.baseModel = baseModel;
  if (hash !== undefined) resource.hash = hash;
  if (modelId !== undefined) resource.modelId = modelId;
  if (weight !== undefined) resource.weight = weight;

  return resource;
}

function contentDispositionFilename(header: string | null) {
  if (!header) return null;

  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? null;
}

function safeFilename(value: string) {
  const cleaned = basename(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || "civitai-resource.safetensors";
}

function fallbackFilename(resource: ImportedCivitaiResource) {
  const parts = [resource.name, resource.versionName]
    .filter((part): part is string => Boolean(part))
    .join(" ");
  const base = safeFilename(parts || `civitai-${resource.modelVersionId}`);

  return /\.(ckpt|pt|pth|safetensors)$/i.test(base) ? base : `${base}.safetensors`;
}

function modelPath(folder: string, filename: string) {
  const root = normalize(join(COMFYUI_MODELS_DIR, folder));
  const fullPath = normalize(join(root, filename));

  if (
    fullPath !== root &&
    !fullPath.startsWith(`${root}/`) &&
    !fullPath.startsWith(`${root}\\`)
  ) {
    throw new Error("Invalid target path");
  }

  return { root, fullPath };
}

function downloadOrigin(resourceUrl: string) {
  try {
    const url = new URL(resourceUrl);
    return url.hostname.toLowerCase().endsWith("civitai.red")
      ? "https://civitai.red"
      : "https://civitai.com";
  } catch {
    return "https://civitai.com";
  }
}

function modelIdFromResource(resource: ImportedCivitaiResource) {
  if (resource.modelId) return String(resource.modelId);

  return parseCivitaiUrlIds(resource.url).modelId ?? null;
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

async function writeCatalog(catalog: Record<string, LocalModelMetadata>) {
  await mkdir("data", { recursive: true });
  await writeFile(MODEL_CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

async function fetchCivitaiMetadata(resource: ImportedCivitaiResource) {
  const modelId = modelIdFromResource(resource);
  if (!modelId) return null;

  const response = await fetch(`https://civitai.com/api/v1/models/${modelId}`, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "image-gen-civitai-download/1.0",
    },
  });

  if (!response.ok) return null;

  const model = (await response.json()) as CivitaiModel;
  const versions = model.modelVersions ?? [];
  const selectedVersion =
    versions.find((version) => version.id === resource.modelVersionId) ?? versions[0];
  const thumbnailUrl =
    selectedVersion?.images?.find((image) => image.url && image.type !== "video")?.url ??
    selectedVersion?.images?.find((image) => image.url)?.url ??
    null;
  const tags = Array.from(
    new Set([...(selectedVersion?.trainedWords ?? []), ...(model.tags ?? [])])
  );

  return {
    name: model.name ?? resource.name,
    version: selectedVersion?.name ?? resource.versionName ?? "",
    base_model: selectedVersion?.baseModel ?? resource.baseModel ?? "",
    thumbnail_url: thumbnailUrl,
    civitai_url: resource.url,
    source_url: resource.url,
    tags,
    license: parseLicense(model),
  } satisfies LocalModelMetadata;
}

async function updateCatalog(
  folder: string,
  filename: string,
  resource: ImportedCivitaiResource
) {
  const catalog = await readCatalog();
  const loadedMetadata = await fetchCivitaiMetadata(resource).catch(() => null);
  const civitaiUrl = normalizeCivitaiModelUrl({
    modelId: resource.modelId,
    modelVersionId: resource.modelVersionId,
    name: loadedMetadata?.name ?? resource.name,
    fallbackUrl: resource.url,
  });

  catalog[`${folder}/${filename}`] = loadedMetadata
    ? {
        ...loadedMetadata,
        civitai_url: civitaiUrl || loadedMetadata.civitai_url,
        source_url: civitaiUrl || loadedMetadata.source_url,
      }
    : {
        name: resource.name,
        version: resource.versionName ?? "",
        base_model: resource.baseModel ?? "",
        thumbnail_url: null,
        civitai_url: civitaiUrl || resource.url,
        source_url: civitaiUrl || resource.url,
        tags: [],
      };
  await writeCatalog(catalog);

  return catalog[`${folder}/${filename}`];
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
}

async function streamDownload(
  controller: ReadableStreamDefaultController<Uint8Array>,
  token: string,
  resource: ImportedCivitaiResource,
  folder: string
) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 30 * 60 * 1000);

  try {
    send(controller, { type: "status", message: "Starting download..." });

    const response = await fetch(
      `${downloadOrigin(resource.url)}/api/download/models/${resource.modelVersionId}`,
      {
        cache: "no-store",
        signal: abortController.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "image-gen-civitai-download/1.0",
        },
      }
    );

    if (!response.ok || !response.body) {
      send(controller, {
        type: "error",
        error: `Civitai download failed: ${response.status}`,
      });
      return;
    }

    const headerFilename = contentDispositionFilename(
      response.headers.get("content-disposition")
    );
    const filename = safeFilename(headerFilename ?? fallbackFilename(resource));
    const { root, fullPath } = modelPath(folder, filename);
    const tempPath = `${fullPath}.download`;
    const total = Number(response.headers.get("content-length") ?? 0);

    await mkdir(root, { recursive: true });

    const existing = await stat(fullPath).catch(() => null);
    if (existing?.isFile()) {
      send(controller, {
        type: "progress",
        downloaded: existing.size,
        total: existing.size,
        percent: 100,
      });
      send(controller, { type: "status", message: "Loading Civitai metadata..." });
      const metadata = await updateCatalog(folder, filename, resource);
      send(controller, {
        type: "complete",
        alreadyExists: true,
        folder,
        filename,
        path: `${folder}/${filename}`,
        metadata,
      });
      return;
    }

    await unlink(tempPath).catch(() => {});

    let downloaded = 0;
    const file = await open(tempPath, "w");

    try {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        downloaded += value.byteLength;
        await file.write(value);
        send(controller, {
          type: "progress",
          downloaded,
          total: total || null,
          percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : null,
        });
      }
    } finally {
      await file.close();
    }

    await rename(tempPath, fullPath);
    send(controller, { type: "status", message: "Loading Civitai metadata..." });
    const metadata = await updateCatalog(folder, filename, resource);

    send(controller, {
      type: "complete",
      alreadyExists: false,
      folder,
      filename,
      path: `${folder}/${filename}`,
      metadata,
    });
  } catch (error) {
    send(controller, {
      type: "error",
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Timed out while downloading Civitai resource"
          : error instanceof Error
            ? error.message
            : "Failed to download Civitai resource",
    });
  } finally {
    clearTimeout(timeout);
    controller.close();
  }
}

export async function POST(req: NextRequest) {
  const token = process.env.CIVITAI_API_TOKEN?.trim();

  if (!token) {
    return NextResponse.json(
      { error: "CIVITAI_API_TOKEN is not configured" },
      { status: 401 }
    );
  }

  const body = (await req.json()) as { resource?: unknown };
  const resource = parseResource(body.resource);

  if (!resource) {
    return NextResponse.json(
      { error: "A downloadable Civitai resource with modelVersionId is required" },
      { status: 400 }
    );
  }

  const folder = RESOURCE_FOLDERS[resource.type];
  if (!folder) {
    return NextResponse.json(
      { error: "This Civitai resource type cannot be downloaded automatically" },
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void streamDownload(controller, token, resource, folder);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
