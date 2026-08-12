import { access, open } from "fs/promises";
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
  const isKrea2 = isKrea2CheckpointName(checkpointName);
  const isPornmaster = isKrea2 && krea2Workflow === "pornmaster";
  const clipName = isKrea2
    ? isPornmaster
      ? PORNMASTER_CLIP_NAME
      : KREA2_CLIP_NAME
    : isAnimaCheckpointName(checkpointName)
      ? ANIMA_CLIP_NAME
      : null;

  if (!clipName) {
    return [];
  }

  const vaeName = isKrea2
    ? isPornmaster
      ? PORNMASTER_VAE_NAME
      : KREA2_VAE_NAME
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
