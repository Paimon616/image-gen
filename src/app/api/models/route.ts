import { mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { basename, extname, join, normalize, relative } from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  COMFYUI_MODELS_DIR,
  getCheckpointCapabilities,
  getMissingRequiredModelFiles,
  hasModelExtension,
  isAnimaCheckpointName,
} from "@/lib/comfyui-model-files";
import type { CivitaiLicenseInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

const MODEL_CATALOG_PATH = "data/model-catalog.json";
const ALLOWED_MODEL_FOLDERS = new Set([
  "checkpoints",
  "diffusion_models",
  "loras",
  "embeddings",
  "vae",
  "upscale_models",
  "controlnet",
]);

type ModelRiskLevel = "HIGH" | "MEDIUM" | "OK";

interface ModelRisk {
  level: ModelRiskLevel;
  reason?: string;
  flags?: string[];
  allow_commercial_use?: string;
}

interface LocalModelMetadata {
  name: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
  civitai_url?: string | null;
  source_url?: string | null;
  tags?: string[];
  risk?: ModelRisk | null;
  license?: CivitaiLicenseInfo | null;
}

type CatalogImportMode = "merge" | "replace";

const DEFAULT_MODEL_CATALOG: Record<string, LocalModelMetadata> = {
  "checkpoints/waiIllustriousSDXL_v140.safetensors": {
    name: "WAI-illustrious-SDXL",
    version: "v1.4.0",
    base_model: "Illustrious / SDXL",
    thumbnail_url: null,
  },
  "loras/p0nyd1sney1ncasev1x0n2-v2.safetensors": {
    name: "Incase + Vixon's Gothic Neon + Disney Style",
    version: "v2",
    base_model: "Pony / Illustrious",
    thumbnail_url: null,
  },
  "loras/vcalicia-anima-nvwls-v1.safetensors": {
    name: "VCalicia Anima NVWLS",
    version: "v1",
    base_model: "Illustrious",
    thumbnail_url: null,
  },
};

async function readCatalog() {
  try {
    return JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      LocalModelMetadata
    >;
  } catch {
    return DEFAULT_MODEL_CATALOG;
  }
}

async function writeCatalog(catalog: Record<string, LocalModelMetadata>) {
  await mkdir("data", { recursive: true });
  await writeFile(MODEL_CATALOG_PATH, JSON.stringify(catalog, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMetadata(value: unknown): LocalModelMetadata | null {
  if (!isRecord(value) || typeof value.name !== "string" || !value.name.trim()) {
    return null;
  }

  return {
    name: value.name.trim(),
    version: typeof value.version === "string" ? value.version : "",
    base_model: typeof value.base_model === "string" ? value.base_model : "",
    thumbnail_url:
      typeof value.thumbnail_url === "string" ? value.thumbnail_url : null,
    civitai_url: typeof value.civitai_url === "string" ? value.civitai_url : null,
    source_url:
      typeof value.source_url === "string"
        ? value.source_url
        : typeof value.civitai_url === "string"
          ? value.civitai_url
          : null,
    tags: Array.isArray(value.tags)
      ? value.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    risk: normalizeRisk(value.risk),
    license: normalizeLicense(value.license),
  };
}

function normalizeLicense(value: unknown): CivitaiLicenseInfo | null {
  if (!isRecord(value)) {
    return null;
  }

  const license: CivitaiLicenseInfo = {};

  if (typeof value.allowNoCredit === "boolean") {
    license.allowNoCredit = value.allowNoCredit;
  }
  if (typeof value.allowDerivatives === "boolean") {
    license.allowDerivatives = value.allowDerivatives;
  }
  if (typeof value.allowDifferentLicense === "boolean") {
    license.allowDifferentLicense = value.allowDifferentLicense;
  }
  if (Array.isArray(value.allowCommercialUse)) {
    license.allowCommercialUse = value.allowCommercialUse.filter(
      (entry): entry is string => typeof entry === "string"
    );
  }

  return Object.keys(license).length > 0 ? license : null;
}

function normalizeRisk(value: unknown): ModelRisk | null {
  if (!isRecord(value)) {
    return null;
  }

  const level = value.level;
  if (level !== "HIGH" && level !== "MEDIUM" && level !== "OK") {
    return null;
  }

  return {
    level,
    reason: typeof value.reason === "string" ? value.reason : undefined,
    flags: Array.isArray(value.flags)
      ? value.flags.filter((flag): flag is string => typeof flag === "string")
      : undefined,
    allow_commercial_use:
      typeof value.allow_commercial_use === "string"
        ? value.allow_commercial_use
        : undefined,
  };
}

function normalizeCatalog(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const catalog: Record<string, LocalModelMetadata> = {};

  for (const [key, metadata] of Object.entries(value)) {
    const normalized = normalizeMetadata(metadata);

    if (!key.trim() || !normalized) {
      return null;
    }

    catalog[key] = normalized;
  }

  return catalog;
}

function modelRoot(folder: string) {
  return join(COMFYUI_MODELS_DIR, folder);
}

function safeModelFilePath(folder: string, modelName: string) {
  if (!ALLOWED_MODEL_FOLDERS.has(folder)) {
    throw new Error("Invalid model folder");
  }

  const root = normalize(modelRoot(folder));
  const fullPath = normalize(join(root, modelName));

  if (
    fullPath === root ||
    (!fullPath.startsWith(`${root}/`) && !fullPath.startsWith(`${root}\\`))
  ) {
    throw new Error("Invalid model path");
  }

  return fullPath;
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(root, entry.name);

      if (entry.isDirectory()) {
        return listFilesRecursive(fullPath);
      }

      return entry.isFile() ? [fullPath] : [];
    })
  );

  return nested.flat();
}

function humanizeFilename(filePath: string) {
  const rawName = basename(filePath, extname(filePath));
  const versionMatch = rawName.match(/(?:^|[-_])v(\d+(?:\.\d+)*)(?:$|[-_])/i);
  const compactVersionMatch = rawName.match(/(?:^|[-_])v(\d{3})(?:$|[-_])/i);
  const version = compactVersionMatch
    ? `v${compactVersionMatch[1].split("").join(".")}`
    : versionMatch
      ? `v${versionMatch[1]}`
      : "";
  const withoutVersion = rawName
    .replace(/(?:^|[-_])v\d+(?:\.\d+)*(?:$|[-_])?/i, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    name: withoutVersion || rawName,
    version,
  };
}

function isVideoCheckpointAsset(
  capabilities: Awaited<ReturnType<typeof getCheckpointCapabilities>>,
  path: string
) {
  return capabilities?.clip === false && !isAnimaCheckpointName(path);
}

function buildModelAssets(
  folder: string,
  paths: string[],
  catalog: Record<string, LocalModelMetadata>
) {
  return paths.map((path) => {
    const metadata = catalog[`${folder}/${path}`];
    const fallback = humanizeFilename(path);

    return {
      path,
      folder,
      name: metadata?.name ?? fallback.name,
      version: metadata?.version ?? fallback.version,
      base_model: metadata?.base_model ?? "",
      thumbnail_url: metadata?.thumbnail_url ?? null,
      civitai_url: metadata?.civitai_url ?? null,
      source_url: metadata?.source_url ?? metadata?.civitai_url ?? null,
      tags: metadata?.tags ?? [],
      risk: metadata?.risk ?? null,
      license: metadata?.license ?? null,
    };
  });
}

async function listModelFiles(folder: string) {
  const root = modelRoot(folder);
  return (await listFilesRecursive(root))
    .filter((file) => hasModelExtension(file))
    .map((file) => relative(root, file).replaceAll("\\", "/"))
    .filter((name) => !name.startsWith("put_"));
}

async function listModelAssets(
  folder: string,
  catalog: Record<string, LocalModelMetadata>
) {
  try {
    const files = await listModelFiles(folder);

    const supportedFiles =
      folder === "checkpoints"
        ? (
            await Promise.all(
              files.map(async (path) => {
                const capabilities = await getCheckpointCapabilities(path);
                return isVideoCheckpointAsset(capabilities, path) ? null : path;
              })
            )
          ).filter((path): path is string => Boolean(path))
        : files;

    const assets = buildModelAssets(folder, supportedFiles, catalog);

    const assetsWithRequirements =
      folder === "checkpoints"
        ? await Promise.all(
            assets.map(async (asset) => ({
              ...asset,
              missing_required_files: await getMissingRequiredModelFiles(asset.path),
            }))
          )
        : assets.map((asset) => ({
            ...asset,
            missing_required_files: [],
          }));

    return assetsWithRequirements.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function listVideoModelAssets(catalog: Record<string, LocalModelMetadata>) {
  const checkpointFiles = await listModelFiles("checkpoints").catch(() => [] as string[]);
  const videoCheckpointFiles = (
    await Promise.all(
      checkpointFiles.map(async (path) => {
        const capabilities = await getCheckpointCapabilities(path);
        return isVideoCheckpointAsset(capabilities, path) ? path : null;
      })
    )
  ).filter((path): path is string => Boolean(path));
  const diffusionModelFiles = await listModelFiles("diffusion_models").catch(
    () => [] as string[]
  );

  return [
    ...buildModelAssets("checkpoints", videoCheckpointFiles, catalog),
    ...buildModelAssets("diffusion_models", diffusionModelFiles, catalog),
  ].sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET() {
  const catalog = await readCatalog();
  const [
    checkpointAssets,
    loraAssets,
    embeddingAssets,
    vaeAssets,
    upscaleModelAssets,
    controlnetAssets,
    videoModelAssets,
  ] = await Promise.all([
    listModelAssets("checkpoints", catalog),
    listModelAssets("loras", catalog),
    listModelAssets("embeddings", catalog),
    listModelAssets("vae", catalog),
    listModelAssets("upscale_models", catalog),
    listModelAssets("controlnet", catalog),
    listVideoModelAssets(catalog),
  ]);
  const animaMissingRequiredFiles = await getMissingRequiredModelFiles("anima");

  return NextResponse.json(
    {
      checkpoints: checkpointAssets.map((asset) => asset.path),
      loras: loraAssets.map((asset) => asset.path),
      embeddings: embeddingAssets.map((asset) => asset.path),
      vaes: vaeAssets.map((asset) => asset.path),
      upscale_models: upscaleModelAssets.map((asset) => asset.path),
      controlnets: controlnetAssets.map((asset) => asset.path),
      video_models: videoModelAssets.map((asset) => `${asset.folder}/${asset.path}`),
      checkpointAssets,
      loraAssets,
      embeddingAssets,
      vaeAssets,
      upscaleModelAssets,
      controlnetAssets,
      videoModelAssets,
      animaMissingRequiredFiles,
      catalog,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as {
    key?: string;
    metadata?: Partial<LocalModelMetadata>;
  };

  if (!body.key || !body.metadata?.name) {
    return NextResponse.json(
      { error: "key and metadata.name are required" },
      { status: 400 }
    );
  }

  const catalog = await readCatalog();
  catalog[body.key] = {
    name: body.metadata.name,
    version: body.metadata.version ?? "",
    base_model: body.metadata.base_model ?? "",
    thumbnail_url: body.metadata.thumbnail_url ?? null,
    civitai_url: body.metadata.civitai_url ?? null,
    source_url: body.metadata.source_url ?? body.metadata.civitai_url ?? null,
    tags: body.metadata.tags ?? [],
    risk: normalizeRisk(body.metadata.risk) ?? catalog[body.key]?.risk ?? null,
    license:
      normalizeLicense(body.metadata.license) ??
      catalog[body.key]?.license ??
      null,
  };
  await writeCatalog(catalog);

  return NextResponse.json({ ok: true, catalog });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    mode?: CatalogImportMode;
    catalog?: unknown;
  };
  const mode = body.mode === "replace" ? "replace" : "merge";
  const importedCatalog = normalizeCatalog(body.catalog);

  if (!importedCatalog) {
    return NextResponse.json(
      { error: "catalog must be a JSON object of model metadata keyed by model path" },
      { status: 400 }
    );
  }

  const currentCatalog = mode === "merge" ? await readCatalog() : {};
  const catalog = {
    ...currentCatalog,
    ...importedCatalog,
  };

  await writeCatalog(catalog);

  return NextResponse.json({
    ok: true,
    mode,
    imported: Object.keys(importedCatalog).length,
    total: Object.keys(catalog).length,
    catalog,
  });
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as {
    folder?: string;
    path?: string;
  };

  if (!body.folder || !body.path) {
    return NextResponse.json(
      { error: "folder and path are required" },
      { status: 400 }
    );
  }

  if (!hasModelExtension(body.path)) {
    return NextResponse.json(
      { error: "Only model files can be deleted" },
      { status: 400 }
    );
  }

  try {
    const fullPath = safeModelFilePath(body.folder, body.path);
    await rm(fullPath, { force: false });

    const catalog = await readCatalog();
    delete catalog[`${body.folder}/${body.path}`];
    await writeCatalog(catalog);

    return NextResponse.json({ ok: true, catalog });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete model",
      },
      { status: 400 }
    );
  }
}
