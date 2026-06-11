import { access, open } from "fs/promises";
import { join, normalize } from "path";

const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".safetensors"]);
const SAFETENSORS_HEADER_LIMIT = 64 * 1024 * 1024;

export const COMFYUI_MODELS_DIR =
  process.env.COMFYUI_MODELS_DIR ??
  join(Buffer.from("Q29tZnlVSQ==", "base64").toString("utf8"), "models");

export interface CheckpointCapabilities {
  clip: boolean;
  vae: boolean;
}

function safeModelPath(folder: string, modelName: string) {
  const root = join(COMFYUI_MODELS_DIR, folder);
  const fullPath = normalize(join(root, modelName));

  if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
    throw new Error("Invalid model path");
  }

  return fullPath;
}

export function isAnimaCheckpointName(modelName: string) {
  return /anima/i.test(modelName);
}

export async function modelFileExists(folder: string, modelName: string) {
  try {
    await access(safeModelPath(folder, modelName));
    return true;
  } catch {
    return false;
  }
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
