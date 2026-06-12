import { readFile } from "fs/promises";
import { extname, join, normalize, relative } from "path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const COMFYUI_MODELS_DIR =
  process.env.COMFYUI_MODELS_DIR ??
  join(Buffer.from("Q29tZnlVSQ==", "base64").toString("utf8"), "models");
const ALLOWED_FOLDERS = new Set([
  "checkpoints",
  "loras",
  "embeddings",
  "vae",
  "upscale_models",
  "controlnet",
]);
const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get("folder") ?? "";
  const file = searchParams.get("file") ?? "";

  if (!ALLOWED_FOLDERS.has(folder) || !file) {
    return NextResponse.json({ error: "Invalid thumbnail path" }, { status: 400 });
  }

  const folderRoot = normalize(join(COMFYUI_MODELS_DIR, folder));
  const requestedPath = normalize(join(folderRoot, file));
  const relativePath = relative(folderRoot, requestedPath);

  if (relativePath.startsWith("..") || relativePath === "" || relativePath.includes(":")) {
    return NextResponse.json({ error: "Invalid thumbnail path" }, { status: 400 });
  }

  try {
    const buffer = await readFile(requestedPath);
    const contentType = CONTENT_TYPES[extname(requestedPath).toLowerCase()];

    if (!contentType) {
      return NextResponse.json({ error: "Unsupported thumbnail type" }, { status: 415 });
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
  }
}
