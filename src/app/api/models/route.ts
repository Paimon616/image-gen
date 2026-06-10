import { readdir, readFile, stat } from "fs/promises";
import { basename, extname, join } from "path";
import { NextResponse } from "next/server";

const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".safetensors"]);
const THUMBNAIL_EXTENSIONS = [".preview.png", ".preview.jpg", ".preview.jpeg", ".preview.webp", ".png", ".jpg", ".jpeg", ".webp"];
const COMFYUI_MODELS_DIR = join(process.cwd(), "ComfyUI", "models");

interface ModelMetadata {
  name?: string;
  title?: string;
  version?: string;
  thumbnail?: string;
  base_model?: string;
}

function hasModelExtension(filename: string) {
  return [...MODEL_EXTENSIONS].some((ext) => filename.endsWith(ext));
}

function modelRoot(folder: string) {
  return join(COMFYUI_MODELS_DIR, folder);
}

function relativeModelPath(folder: string, parentPath: string, filename: string) {
  return parentPath
    .replace(modelRoot(folder), "")
    .replace(/^\//, "")
    .concat(parentPath.endsWith(folder) ? "" : "/")
    .concat(filename);
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

async function fileExists(path: string) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function readMetadata(folder: string, filePath: string): Promise<ModelMetadata> {
  const fullPath = join(modelRoot(folder), filePath);
  const stemPath = fullPath.slice(0, -extname(fullPath).length);
  const candidates = [`${fullPath}.json`, `${stemPath}.json`];

  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(candidate, "utf8")) as ModelMetadata;
    } catch {
      // Try the next sidecar metadata file.
    }
  }

  return {};
}

async function findThumbnail(folder: string, filePath: string, metadata: ModelMetadata) {
  if (metadata.thumbnail?.startsWith("http")) {
    return metadata.thumbnail;
  }

  const fullPath = join(modelRoot(folder), filePath);
  const stemPath = fullPath.slice(0, -extname(fullPath).length);
  const metadataThumbnail = metadata.thumbnail
    ? join(modelRoot(folder), metadata.thumbnail)
    : null;

  if (metadataThumbnail && (await fileExists(metadataThumbnail))) {
    return `/api/models/thumbnail?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(metadata.thumbnail ?? "")}`;
  }

  for (const extension of THUMBNAIL_EXTENSIONS) {
    const candidate = `${stemPath}${extension}`;
    if (await fileExists(candidate)) {
      const relativePath = candidate.replace(modelRoot(folder), "").replace(/^\//, "");
      return `/api/models/thumbnail?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(relativePath)}`;
    }
  }

  return null;
}

async function listModelAssets(folder: string) {
  try {
    const entries = await readdir(modelRoot(folder), {
      recursive: true,
      withFileTypes: true,
    });

    const files = entries
      .filter((entry) => entry.isFile() && hasModelExtension(entry.name))
      .map((entry) => relativeModelPath(folder, entry.parentPath, entry.name))
      .filter((name) => !name.startsWith("put_"));

    const assets = await Promise.all(
      files.map(async (path) => {
        const metadata = await readMetadata(folder, path);
        const fallback = humanizeFilename(path);

        return {
          path,
          name: metadata.name ?? metadata.title ?? fallback.name,
          version: metadata.version ?? fallback.version,
          base_model: metadata.base_model ?? "",
          thumbnail_url: await findThumbnail(folder, path, metadata),
        };
      })
    );

    return assets.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function GET() {
  const [checkpointAssets, loraAssets, embeddingAssets, vaeAssets, controlnetAssets] = await Promise.all([
    listModelAssets("checkpoints"),
    listModelAssets("loras"),
    listModelAssets("embeddings"),
    listModelAssets("vae"),
    listModelAssets("controlnet"),
  ]);

  return NextResponse.json({
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
  });
}
