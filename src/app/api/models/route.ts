import { readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";

const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".safetensors"]);
const COMFYUI_MODELS_DIR = join(process.cwd(), "ComfyUI", "models");

function hasModelExtension(filename: string) {
  return [...MODEL_EXTENSIONS].some((ext) => filename.endsWith(ext));
}

async function listModelFiles(folder: string) {
  try {
    const entries = await readdir(join(COMFYUI_MODELS_DIR, folder), {
      recursive: true,
      withFileTypes: true,
    });

    return entries
      .filter((entry) => entry.isFile() && hasModelExtension(entry.name))
      .map((entry) =>
        entry.parentPath
          .replace(join(COMFYUI_MODELS_DIR, folder), "")
          .replace(/^\//, "")
          .concat(entry.parentPath.endsWith(folder) ? "" : "/")
          .concat(entry.name)
      )
      .filter((name) => !name.startsWith("put_"))
      .sort();
  } catch {
    return [];
  }
}

export async function GET() {
  const [checkpoints, loras, embeddings] = await Promise.all([
    listModelFiles("checkpoints"),
    listModelFiles("loras"),
    listModelFiles("embeddings"),
  ]);

  return NextResponse.json({ checkpoints, loras, embeddings });
}
