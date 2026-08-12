import { mkdir, open, rename, stat, unlink } from "fs/promises";
import { join, normalize } from "path";
import { NextRequest, NextResponse } from "next/server";

import { COMFYUI_MODELS_DIR, hasModelExtension } from "@/lib/comfyui-model-files";
import { parseCivitaiUrlIds } from "@/lib/civitai-url";
import { getCivitaiApiKey } from "@/lib/settings";

export const runtime = "nodejs";

const encoder = new TextEncoder();

// Folders a model file may be written into. Mirrors the generation folders plus
// the Krea 2 support locations (text_encoders / diffusion_models).
const ALLOWED_FOLDERS = new Set([
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "loras",
  "embeddings",
  "vae",
  "upscale_models",
  "controlnet",
]);

function safeTargetPath(folder: string, filename: string) {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new Error(`Unsupported model folder: ${folder}`);
  }
  const base = filename.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base || !hasModelExtension(base)) {
    throw new Error("A model filename with a valid extension is required");
  }

  const root = normalize(join(COMFYUI_MODELS_DIR, folder));
  const fullPath = normalize(join(root, base));
  if (
    fullPath !== root &&
    !fullPath.startsWith(`${root}/`) &&
    !fullPath.startsWith(`${root}\\`)
  ) {
    throw new Error("Invalid target path");
  }

  return { root, fullPath, filename: base };
}

function isHuggingFaceUrl(url: string) {
  return /^https?:\/\/([^/]+\.)?huggingface\.co\//i.test(url);
}

function isCivitaiUrl(url: string) {
  return /^https?:\/\/([^/]+\.)?civitai\.(com|red)\//i.test(url);
}

// Resolve a catalog source_url to a directly-streamable download URL and any
// auth headers. HF "blob" links are rewritten to "resolve"; Civitai page URLs
// are turned into the api/download endpoint for their version.
async function resolveDownload(url: string): Promise<{ url: string; headers: Record<string, string> }> {
  const headers: Record<string, string> = {
    "User-Agent": "image-gen-model-download/1.0",
  };

  if (isHuggingFaceUrl(url)) {
    return { url: url.replace("/blob/", "/resolve/"), headers };
  }

  if (isCivitaiUrl(url)) {
    const token = await getCivitaiApiKey();
    if (!token) {
      throw new Error("CIVITAI_API_TOKEN is not configured for Civitai downloads");
    }
    headers.Authorization = `Bearer ${token}`;

    // Already a direct download endpoint.
    if (/\/api\/download\/models\//i.test(url)) {
      return { url, headers };
    }
    const { modelVersionId } = parseCivitaiUrlIds(url);
    if (!modelVersionId) {
      throw new Error("Civitai URL is missing a modelVersionId to download");
    }
    const origin = new URL(url).hostname.toLowerCase().endsWith("civitai.red")
      ? "https://civitai.red"
      : "https://civitai.com";
    return { url: `${origin}/api/download/models/${modelVersionId}`, headers };
  }

  // Any other direct http(s) link is streamed as-is.
  return { url, headers };
}

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`));
}

async function streamDownload(
  controller: ReadableStreamDefaultController<Uint8Array>,
  folder: string,
  requestedFilename: string,
  sourceUrl: string
) {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 60 * 60 * 1000);

  try {
    const { root, fullPath, filename } = safeTargetPath(folder, requestedFilename);
    const relPath = `${folder}/${filename}`;

    await mkdir(root, { recursive: true });
    const existing = await stat(fullPath).catch(() => null);
    if (existing?.isFile()) {
      send(controller, { type: "progress", downloaded: existing.size, total: existing.size, percent: 100 });
      send(controller, { type: "complete", alreadyExists: true, folder, filename, path: relPath });
      return;
    }

    send(controller, { type: "status", message: "Resolving download source..." });
    const { url, headers } = await resolveDownload(sourceUrl);

    send(controller, { type: "status", message: "Starting download..." });
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      signal: abortController.signal,
      headers,
    });
    if (!response.ok || !response.body) {
      send(controller, { type: "error", error: `Download failed: HTTP ${response.status}` });
      return;
    }

    const total = Number(response.headers.get("content-length") ?? 0);
    const tempPath = `${fullPath}.download`;
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
    send(controller, { type: "complete", alreadyExists: false, folder, filename, path: relPath });
  } catch (error) {
    send(controller, {
      type: "error",
      error:
        error instanceof Error && error.name === "AbortError"
          ? "Timed out while downloading the model"
          : error instanceof Error
            ? error.message
            : "Failed to download the model",
    });
  } finally {
    clearTimeout(timeout);
    controller.close();
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    folder?: unknown;
    filename?: unknown;
    url?: unknown;
  };
  const folder = typeof body.folder === "string" ? body.folder.trim() : "";
  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!folder || !filename || !url) {
    return NextResponse.json(
      { error: "folder, filename, and url are required" },
      { status: 400 }
    );
  }
  if (!ALLOWED_FOLDERS.has(folder)) {
    return NextResponse.json({ error: `Unsupported model folder: ${folder}` }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void streamDownload(controller, folder, filename, url);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson; charset=utf-8",
    },
  });
}
