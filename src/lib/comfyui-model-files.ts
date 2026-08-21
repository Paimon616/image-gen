import { access, open, readFile, stat } from "fs/promises";
import { join, normalize } from "path";

const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".pth", ".safetensors"]);
const SAFETENSORS_HEADER_LIMIT = 64 * 1024 * 1024;

export const COMFYUI_MODELS_DIR =
  process.env.COMFYUI_MODELS_DIR ??
  join(Buffer.from("Q29tZnlVSQ==", "base64").toString("utf8"), "models");
export const ANIMA_CLIP_NAME = "qwen_3_06b_base.safetensors";
export const ANIMA_VAE_NAME = "qwen_image_vae.safetensors";
export const KREA2_CLIP_NAME = "qwen3vl_4b_fp8_scaled.safetensors";
export const KREA2_VAE_NAME = "qwen_image_vae.safetensors";
// The PornMaster Krea2 workflow ships its own stack: an abliterated ("heretic")
// int8 Qwen3-VL text encoder and the Wan 2.1 VAE. Kept separate from the official
// Krea 2 files so the "generic" workflow is unaffected.
export const PORNMASTER_CLIP_NAME = "qwen3-vl-4b-heretic_int8.safetensors";
export const PORNMASTER_VAE_NAME = "wan_2.1_vae.safetensors";
// Z-Image (Tongyi-MAI) is a Lumina2-architecture DiT: the diffusion weights ship
// alone and pair with a Qwen3-4B text encoder plus the Flux-style 16-channel VAE.
// Names match Comfy-Org/z_image_turbo split_files (the official ComfyUI blueprint).
export const ZIMAGE_CLIP_NAME = "qwen_3_4b.safetensors";
export const ZIMAGE_VAE_NAME = "ae.safetensors";

export interface CheckpointCapabilities {
  clip: boolean;
  vae: boolean;
}

function safeModelPath(folder: string, modelName: string) {
  const root = join(COMFYUI_MODELS_DIR, folder);
  const fullPath = normalize(join(root, modelName));

  if (
    fullPath !== root &&
    !fullPath.startsWith(`${root}/`) &&
    !fullPath.startsWith(`${root}\\`)
  ) {
    throw new Error("Invalid model path");
  }

  return fullPath;
}

export function isAnimaCheckpointName(modelName: string) {
  return /anima/i.test(modelName);
}

export function isKrea2CheckpointName(modelName: string) {
  return /krea[-_ ]?2/i.test(modelName);
}

export function isZImageCheckpointName(modelName: string) {
  return /z[-_ ]?image/i.test(modelName);
}

export type CheckpointFamily = "krea2" | "zimage" | "anima" | null;

const MODEL_CATALOG_PATH = join(process.cwd(), "data", "model-catalog.json");
let catalogFamilyCache: { mtimeMs: number; families: Map<string, CheckpointFamily> } | null =
  null;

function familyFromLabel(label: string): CheckpointFamily {
  if (isKrea2CheckpointName(label)) return "krea2";
  if (isZImageCheckpointName(label)) return "zimage";
  if (isAnimaCheckpointName(label)) return "anima";
  return null;
}

// data/model-catalog.json records the Civitai base model for every checkpoint this app
// downloaded or imported, keyed by "<folder>/<filename>". Cached by mtime because the
// model listing routes resolve a family per asset.
async function readCatalogFamilies() {
  try {
    const { mtimeMs } = await stat(MODEL_CATALOG_PATH);
    if (catalogFamilyCache?.mtimeMs === mtimeMs) return catalogFamilyCache.families;

    const catalog = JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      { base_model?: string } | null
    >;
    const families = new Map<string, CheckpointFamily>();
    for (const [key, entry] of Object.entries(catalog)) {
      const match = /^(?:checkpoints|diffusion_models)\/(.+)$/.exec(key);
      if (!match) continue;
      const family = familyFromLabel(entry?.base_model ?? "");
      if (family) families.set(match[1], family);
    }
    catalogFamilyCache = { mtimeMs, families };
    return families;
  } catch {
    return new Map<string, CheckpointFamily>();
  }
}

// Which dedicated pipeline a checkpoint belongs to. The filename is the primary signal
// (it is all ComfyUI itself knows), but plenty of merges don't carry their family in the
// name — animij_ai.safetensors is an Anima base, moodyProMix is Z-Image — so fall back to
// the catalog's base_model. Without that fallback those checkpoints reach the standard
// SDXL workflow and die on their missing bundled CLIP.
export async function resolveCheckpointFamily(modelName: string): Promise<CheckpointFamily> {
  const name = modelName.trim();
  if (!name) return null;

  const fromName = familyFromLabel(name);
  if (fromName) return fromName;

  const families = await readCatalogFamilies();
  return families.get(name) ?? families.get(name.replace(/^.*\//, "")) ?? null;
}

// Diffusion-only image checkpoints. They are usually installed under
// models/diffusion_models (UNETLoader) rather than models/checkpoints, yet they
// generate images, so the image model list has to reach into that folder too.
export function isDiffusionOnlyImageCheckpointName(modelName: string) {
  return isKrea2CheckpointName(modelName) || isZImageCheckpointName(modelName);
}

export async function modelFileExists(folder: string, modelName: string) {
  try {
    await access(safeModelPath(folder, modelName));
    return true;
  } catch {
    return false;
  }
}

export async function getMissingRequiredModelFiles(
  checkpointName: string,
  krea2Workflow: "generic" | "refined" | "pornmaster" = "generic"
) {
  const family = await resolveCheckpointFamily(checkpointName);
  const isKrea2 = family === "krea2";
  const isPornmaster = isKrea2 && krea2Workflow === "pornmaster";
  const isZImage = family === "zimage";
  const clipName = isKrea2
    ? isPornmaster
      ? PORNMASTER_CLIP_NAME
      : KREA2_CLIP_NAME
    : isZImage
      ? ZIMAGE_CLIP_NAME
      : family === "anima"
        ? ANIMA_CLIP_NAME
        : null;

  if (!clipName) {
    return [];
  }

  const vaeName = isKrea2
    ? isPornmaster
      ? PORNMASTER_VAE_NAME
      : KREA2_VAE_NAME
    : isZImage
      ? ZIMAGE_VAE_NAME
      : ANIMA_VAE_NAME;
  const requiredFiles = [
    {
      folder: "text_encoders",
      name: clipName,
      label: `ComfyUI/models/text_encoders/${clipName}`,
    },
    {
      folder: "vae",
      name: vaeName,
      label: `ComfyUI/models/vae/${vaeName}`,
    },
  ];
  const missing = await Promise.all(
    requiredFiles.map(async (file) =>
      (await modelFileExists(file.folder, file.name)) ? null : file.label
    )
  );

  return missing.filter((file): file is string => Boolean(file));
}

function hasCheckpointClip(keys: string[]) {
  return keys.some(
    (key) =>
      key.startsWith("conditioner.embedders.") ||
      key.startsWith("cond_stage_model.") ||
      key.startsWith("clip_l.") ||
      key.startsWith("clip_g.") ||
      key.includes("text_model")
  );
}

function hasCheckpointVae(keys: string[]) {
  return keys.some(
    (key) => key.startsWith("first_stage_model.") || key.startsWith("vae.")
  );
}

export async function getCheckpointCapabilities(
  checkpointName: string
): Promise<CheckpointCapabilities | null> {
  if (!checkpointName.endsWith(".safetensors")) {
    return null;
  }

  let file: Awaited<ReturnType<typeof open>> | null = null;

  try {
    file = await open(safeModelPath("checkpoints", checkpointName), "r");
    const sizeBuffer = Buffer.alloc(8);
    await file.read(sizeBuffer, 0, sizeBuffer.length, 0);
    const headerSize = Number(sizeBuffer.readBigUInt64LE(0));

    if (!Number.isSafeInteger(headerSize) || headerSize > SAFETENSORS_HEADER_LIMIT) {
      return null;
    }

    const headerBuffer = Buffer.alloc(headerSize);
    await file.read(headerBuffer, 0, headerBuffer.length, sizeBuffer.length);
    const header = JSON.parse(headerBuffer.toString("utf8")) as Record<string, unknown>;
    const keys = Object.keys(header).filter((key) => key !== "__metadata__");

    return {
      clip: hasCheckpointClip(keys),
      vae: hasCheckpointVae(keys),
    };
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

export function hasModelExtension(filename: string) {
  return [...MODEL_EXTENSIONS].some((ext) => filename.endsWith(ext));
}
