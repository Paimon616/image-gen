import "server-only";

import { createWriteStream } from "fs";
import { mkdir, readFile, rename, stat, writeFile } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const dynamic = "force-dynamic";

const MODELS_DIR = resolve(process.env.COMFYUI_MODELS_DIR || "/workspace/ComfyUI/models");

// The pod's shared model metadata catalog. It lives on the persistent models
// volume so it survives restarts and is visible to every user of the pod: when
// one person downloads a model, its name/thumbnail is recorded here, and other
// users fold it into their own local catalog when they open the model picker.
const CATALOG_FILE = join(MODELS_DIR, ".image-gen-catalog.json");

export interface PodCatalogEntry {
  name?: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
  civitai_url?: string | null;
  source_url?: string | null;
  tags?: string[];
}

export async function readPodCatalog(): Promise<Record<string, PodCatalogEntry>> {
  try {
    const parsed = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, PodCatalogEntry>)
      : {};
  } catch {
    return {};
  }
}

export async function mergePodCatalog(
  entries: Record<string, PodCatalogEntry>
): Promise<Record<string, PodCatalogEntry>> {
  const catalog = await readPodCatalog();
  for (const [key, value] of Object.entries(entries)) {
    if (!key || !value || typeof value !== "object" || !value.name) continue;
    catalog[key] = { ...catalog[key], ...value };
  }
  await mkdir(MODELS_DIR, { recursive: true });
  await writeFile(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  return catalog;
}

export function modelPath(value: string) {
  const raw = String(value || "").trim();
  const path = raw.startsWith("/workspace/ComfyUI/models/")
    ? raw.slice("/workspace/ComfyUI/models/".length)
    : raw.replace(/^\/+/, "");
  const target = resolve(join(MODELS_DIR, path));
  const rel = relative(MODELS_DIR, target);
  if (rel.startsWith("..") || rel === "" || resolve(rel) === rel) {
    throw new Error("Invalid model path.");
  }
  return target;
}

export async function fileExists(path: string) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

export async function fileSize(path: string) {
  try {
    const info = await stat(path);
    return info.isFile() ? info.size : 0;
  } catch {
    return 0;
  }
}

export async function downloadToFile({
  targetFile,
  downloadUrl,
  token,
  onProgress,
}: {
  targetFile: string;
  downloadUrl: string;
  token?: string;
  onProgress?: (downloaded: number, total: number) => void;
}) {
  await mkdir(dirname(targetFile), { recursive: true });
  if (await fileExists(targetFile)) return targetFile;

  const tmp = `${targetFile}.download`;
  const existing = await fileSize(tmp);
  const headers: Record<string, string> = {
    "User-Agent": "image-gen-runpod-download/1.0",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (existing > 0) headers.Range = `bytes=${existing}-`;

  onProgress?.(existing, 0);
  const response = await fetch(downloadUrl, { headers });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  const total = contentLength > 0 ? existing + contentLength : 0;
  let downloaded = existing;
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    onProgress?.(downloaded, total);
  });
  await pipeline(source, createWriteStream(tmp, { flags: existing > 0 ? "a" : "w" }));
  await rename(tmp, targetFile);
  onProgress?.(downloaded, downloaded);
  return targetFile;
}
