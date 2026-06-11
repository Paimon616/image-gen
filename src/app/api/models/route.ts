import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { basename, extname, join, relative } from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  COMFYUI_MODELS_DIR,
  getCheckpointCapabilities,
  hasModelExtension,
  isAnimaCheckpointName,
} from "@/lib/comfyui-model-files";

export const dynamic = "force-dynamic";

const MODEL_CATALOG_PATH = "data/model-catalog.json";

interface LocalModelMetadata {
  name: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
  civitai_url?: string | null;
  tags?: string[];
}

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

function modelRoot(folder: string) {
  return join(COMFYUI_MODELS_DIR, folder);
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

async function listModelAssets(
  folder: string,
  catalog: Record<string, LocalModelMetadata>
) {
  try {
    const root = modelRoot(folder);
    const files = (await listFilesRecursive(root))
      .filter((file) => hasModelExtension(file))
      .map((file) => relative(root, file).replaceAll("\\", "/"))
      .filter((name) => !name.startsWith("put_"));

    const supportedFiles =
      folder === "checkpoints"
        ? (
            await Promise.all(
              files.map(async (path) => {
                const capabilities = await getCheckpointCapabilities(path);
                return capabilities?.clip === false && !isAnimaCheckpointName(path)
                  ? null
                  : path;
              })
            )
          ).filter((path): path is string => Boolean(path))
        : files;

    const assets = supportedFiles.map((path) => {
      const metadata = catalog[`${folder}/${path}`];
      const fallback = humanizeFilename(path);

      return {
        path,
        name: metadata?.name ?? fallback.name,
        version: metadata?.version ?? fallback.version,
        base_model: metadata?.base_model ?? "",
        thumbnail_url: metadata?.thumbnail_url ?? null,
        civitai_url: metadata?.civitai_url ?? null,
        tags: metadata?.tags ?? [],
      };
    });

    return assets.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function GET() {
  const catalog = await readCatalog();
  const [checkpointAssets, loraAssets, embeddingAssets, vaeAssets, controlnetAssets] = await Promise.all([
    listModelAssets("checkpoints", catalog),
    listModelAssets("loras", catalog),
    listModelAssets("embeddings", catalog),
    listModelAssets("vae", catalog),
    listModelAssets("controlnet", catalog),
  ]);

  return NextResponse.json(
    {
      checkpoints: checkpointAssets.map((asset) => asset.path),
      loras: loraAssets.map((asset) => asset.path),
      embeddings: embeddingAssets.map((asset) => asset.path),
      vaes: vaeAssets.map((asset) => asset.path),
      controlnets: controlnetAssets.map((asset) => asset.path),
      checkpointAssets,
      loraAssets,
      embeddingAssets,
      vaeAssets,
      controlnetAssets,
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
    tags: body.metadata.tags ?? [],
  };
  await writeCatalog(catalog);

  return NextResponse.json({ ok: true, catalog });
}
