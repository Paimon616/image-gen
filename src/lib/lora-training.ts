import { access, readFile, writeFile } from "fs/promises";
import { constants } from "fs";
import { basename, extname, join, normalize, resolve } from "path";
import { randomUUID } from "crypto";

function comfyUiModelsDir() {
  if (process.env.COMFYUI_MODELS_DIR) {
    return process.env.COMFYUI_MODELS_DIR;
  }

  if (process.env.COMFYUI_DIR) {
    return join(process.env.COMFYUI_DIR, "models");
  }

  return (
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      Buffer.from("Q29tZnlVSQ==", "base64").toString("utf8"),
      "models"
    )
  );
}

const isWindows = process.platform === "win32";

export function loraRunnerDir() {
  return (
    process.env.LORA_RUNNER_DIR ??
    join(
      /*turbopackIgnore: true*/ process.cwd(),
      Buffer.from("cnVubmVycw==", "base64").toString("utf8"),
      Buffer.from("c2Qtc2NyaXB0cw==", "base64").toString("utf8")
    )
  );
}

export function loraRunnerPython() {
  return (
    process.env.LORA_RUNNER_PYTHON ??
    join(loraRunnerDir(), ".venv", isWindows ? "Scripts/python.exe" : "bin/python")
  );
}

export function sdxlTrainScript() {
  return join(loraRunnerDir(), "sdxl_train_network.py");
}

export function sdTrainScript() {
  return join(loraRunnerDir(), "train_network.py");
}

export function loraOutputDir() {
  return resolve(comfyUiModelsDir(), "loras");
}

export interface LoraRunnerStatus {
  ready: boolean;
  runnerDir: string;
  pythonPath: string;
  trainScript: string;
  outputDir: string;
  missing: string[];
}

export interface LoraTrainingConfigInput {
  runId: string;
  loraName: string;
  triggerWords: string;
  baseModel: string;
  category: string;
  imageDir: string;
  outputName: string;
  resolution: number;
}

async function exists(path: string) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function getLoraRunnerStatus(): Promise<LoraRunnerStatus> {
  const checks = [
    { label: "runners/sd-scripts", path: loraRunnerDir() },
    { label: "runner Python venv", path: loraRunnerPython() },
    { label: "sdxl_train_network.py", path: sdxlTrainScript() },
    { label: "train_network.py", path: sdTrainScript() },
  ];
  const results = await Promise.all(
    checks.map(async (check) => ({
      ...check,
      exists: await exists(check.path),
    }))
  );
  const missing = results
    .filter((result) => !result.exists)
    .map((result) => `${result.label}: ${result.path}`);

  return {
    ready: missing.length === 0,
    runnerDir: loraRunnerDir(),
    pythonPath: loraRunnerPython(),
    trainScript: sdxlTrainScript(),
    outputDir: loraOutputDir(),
    missing,
  };
}

export function safeOutputName(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[^a-z0-9가-힣_-]+/gi, "-")
      .replace(/^-+|-+$/g, "") || `lora-${randomUUID().slice(0, 8)}`
  );
}

export function checkpointPath(baseModel: string) {
  const root = resolve(join(comfyUiModelsDir(), "checkpoints"));
  const fullPath = resolve(join(root, baseModel));

  if (fullPath !== root && !fullPath.startsWith(`${root}/`) && !fullPath.startsWith(`${root}\\`)) {
    throw new Error("Invalid base model path");
  }

  return fullPath;
}

interface LocalModelMetadata {
  base_model?: string;
}

export type TrainingTarget =
  | {
      kind: "sdxl" | "sd";
      label: string;
      scriptPath: string;
      resolution: number;
    }
  | {
      kind: "unsupported";
      label: string;
      reason: string;
    };

async function checkpointBaseModelLabel(baseModel: string) {
  try {
    const catalog = JSON.parse(
      await readFile(join(process.cwd(), "data", "model-catalog.json"), "utf8")
    ) as Record<string, LocalModelMetadata>;
    return catalog[`checkpoints/${baseModel}`]?.base_model?.trim() ?? "";
  } catch {
    return "";
  }
}

export async function getTrainingTarget(baseModel: string): Promise<TrainingTarget> {
  const label = (await checkpointBaseModelLabel(baseModel)) || baseModel;
  const normalized = `${label} ${baseModel}`.toLowerCase();

  if (/\banima\b/.test(normalized)) {
    return {
      kind: "unsupported",
      label,
      reason:
        "Anima checkpoints require the dedicated anima_train_network.py path and additional Qwen/VAE/adapter settings, so they are not supported by this LoRA runner yet.",
    };
  }

  if (/\bflux\b|flux\.1/.test(normalized)) {
    return {
      kind: "unsupported",
      label,
      reason: "Flux checkpoints are not supported by this SD/SDXL LoRA runner.",
    };
  }

  if (/sd\s*1\.?5|sd1|stable diffusion 1|sd\s*v?1/.test(normalized)) {
    return {
      kind: "sd",
      label,
      scriptPath: sdTrainScript(),
      resolution: Number(process.env.LORA_SD_RESOLUTION ?? "512"),
    };
  }

  if (/sdxl|xl|illustrious|pony|noobai|animagine/.test(normalized)) {
    return {
      kind: "sdxl",
      label,
      scriptPath: sdxlTrainScript(),
      resolution: Number(process.env.LORA_SDXL_RESOLUTION ?? "768"),
    };
  }

  return {
    kind: "unsupported",
    label,
    reason:
      "This checkpoint has no supported base model metadata. Set it to SD 1.5, SDXL, Illustrious, or Pony in the model catalog before training.",
  };
}

export function safeImageExtension(file: File) {
  const fromName = extname(file.name).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(fromName)) return fromName;
  if (file.type === "image/png") return ".png";
  if (file.type === "image/webp") return ".webp";
  return ".jpg";
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

export function buildSdxlTrainingConfig({
  loraName,
  triggerWords,
  baseModel,
  category,
  imageDir,
  outputName,
  resolution,
}: LoraTrainingConfigInput) {
  const tokens = triggerWords
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .join(", ");
  const classToken = category || "character";

  return `# Generated by Image Gen LoRA Training
[general]
shuffle_caption = true
caption_extension = ".txt"
keep_tokens = 1

[[datasets]]
resolution = ${resolution}
batch_size = 1
enable_bucket = true
bucket_no_upscale = true
min_bucket_reso = 512
max_bucket_reso = 1536

  [[datasets.subsets]]
  image_dir = ${tomlString(normalize(imageDir))}
  class_tokens = ${tomlString(`${tokens} ${classToken}`.trim())}
  num_repeats = 10
`;
}

export async function writeTrainingReadme(runDir: string, lines: string[]) {
  await writeFile(join(runDir, "README.txt"), `${lines.join("\n")}\n`);
}

export function displayFilename(path: string) {
  return basename(path);
}
