import "server-only";

import { createWriteStream } from "fs";
import { mkdir, rename, stat } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export const dynamic = "force-dynamic";

const MODELS_DIR = resolve(process.env.COMFYUI_MODELS_DIR || "/workspace/ComfyUI/models");

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
