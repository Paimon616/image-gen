import { execFile } from "child_process";
import { basename, extname } from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".safetensors"]);
const COMFYUI_MODELS_DIR =
  process.env.COMFYUI_MODELS_DIR ??
  [`Comfy${"UI"}`, "models"].join("/");

interface LocalModelMetadata {
  name: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
}

const LOCAL_MODEL_CATALOG: Record<string, LocalModelMetadata> = {
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

function hasModelExtension(filename: string) {
  return [...MODEL_EXTENSIONS].some((ext) => filename.endsWith(ext));
}

function modelRoot(folder: string) {
  return [COMFYUI_MODELS_DIR, folder].join("/");
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

async function listModelAssets(folder: string) {
  try {
    const root = modelRoot(folder);
    const { stdout } = await execFileAsync("find", [root, "-type", "f"], {
      maxBuffer: 1024 * 1024,
    });

    const files = stdout
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean)
      .filter((file) => hasModelExtension(file))
      .map((file) => file.replace(root, "").replace(/^\//, ""))
      .filter((name) => !name.startsWith("put_"));

    const assets = files.map((path) => {
      const metadata = LOCAL_MODEL_CATALOG[`${folder}/${path}`];
      const fallback = humanizeFilename(path);

      return {
        path,
        name: metadata?.name ?? fallback.name,
        version: metadata?.version ?? fallback.version,
        base_model: metadata?.base_model ?? "",
        thumbnail_url: metadata?.thumbnail_url ?? null,
      };
    });

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
