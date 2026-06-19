import { access, appendFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import {
  loraOutputDir,
  loraRunnerPython,
  type LoraRunnerStatus,
  type TrainingTarget,
} from "@/lib/lora-training";

export type LoraJobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface LoraJobStatus {
  runId: string;
  loraName: string;
  triggerWords: string;
  category: string;
  baseModel: string;
  baseModelLabel: string;
  imageCount: number;
  outputName: string;
  outputPath: string;
  logPath: string;
  state: LoraJobState;
  progress: number;
  message: string;
  error: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  logTail?: string;
}

interface StartLoraJobInput {
  runId: string;
  outputName: string;
  runnerStatus: LoraRunnerStatus;
  trainingTarget: Extract<TrainingTarget, { kind: "sdxl" | "sd" }>;
  baseModelPath: string;
  datasetConfigPath: string;
  runDir: string;
  logPath: string;
}

type LoraJobRegistry = typeof globalThis & {
  __imageGenLoraJobs?: Map<string, ChildProcessWithoutNullStreams>;
};

function registry() {
  const globalRef = globalThis as LoraJobRegistry;
  if (!globalRef.__imageGenLoraJobs) {
    globalRef.__imageGenLoraJobs = new Map();
  }
  return globalRef.__imageGenLoraJobs;
}

export function trainingRunsDir() {
  if (process.env.LORA_TRAINING_DIR) {
    return process.env.LORA_TRAINING_DIR;
  }

  return join(/*turbopackIgnore: true*/ process.cwd(), "training", "runs");
}

export function trainingRunPath(runId: string) {
  if (process.env.LORA_TRAINING_DIR) {
    return join(process.env.LORA_TRAINING_DIR, runId);
  }

  return join(/*turbopackIgnore: true*/ process.cwd(), "training", "runs", runId);
}

export function statusPath(runDir: string) {
  return join(runDir, "status.json");
}

export async function readLogTail(logPath: string, maxLength = 6000) {
  try {
    const content = await readFile(logPath, "utf8");
    return content.slice(-maxLength);
  } catch {
    return "";
  }
}

export async function readLoraJobStatus(runId: string): Promise<LoraJobStatus | null> {
  try {
    const runDir = trainingRunPath(runId);
    const status = JSON.parse(await readFile(statusPath(runDir), "utf8")) as LoraJobStatus;
    return {
      ...status,
      logTail: await readLogTail(status.logPath),
    };
  } catch {
    return null;
  }
}

export async function listLoraJobStatuses() {
  try {
    const runIds = await readdir(trainingRunsDir());
    const statuses = await Promise.all(runIds.map((runId) => readLoraJobStatus(runId)));
    return statuses
      .filter((status): status is LoraJobStatus => Boolean(status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

async function writeLoraJobStatus(runDir: string, nextStatus: LoraJobStatus) {
  await mkdir(runDir, { recursive: true });
  await writeFile(statusPath(runDir), `${JSON.stringify(nextStatus, null, 2)}\n`);
}

async function patchLoraJobStatus(
  runDir: string,
  patch: Partial<Omit<LoraJobStatus, "runId" | "outputName" | "outputPath" | "logPath" | "startedAt">>
) {
  const current = JSON.parse(await readFile(statusPath(runDir), "utf8")) as LoraJobStatus;
  await writeLoraJobStatus(runDir, {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  });
}

export function parseTrainingProgress(line: string) {
  const percentMatch = line.match(/(\d{1,3})%\|/);
  if (percentMatch) {
    return Math.min(99, Math.max(1, Number(percentMatch[1])));
  }

  const stepMatch = line.match(/steps?:\s*(\d+)\s*\/\s*(\d+)/i);
  if (stepMatch) {
    const current = Number(stepMatch[1]);
    const total = Number(stepMatch[2]);
    if (total > 0) return Math.min(99, Math.max(1, Math.round((current / total) * 100)));
  }

  return null;
}

function defaultMixedPrecision() {
  return process.platform === "darwin" ? "no" : "fp16";
}

function defaultSavePrecision() {
  return process.platform === "darwin" ? "float" : "fp16";
}

export function buildTrainingArgs({
  baseModelPath,
  datasetConfigPath,
  outputName,
  trainScript,
}: {
  baseModelPath: string;
  datasetConfigPath: string;
  outputName: string;
  trainScript: string;
}) {
  return [
    "-m",
    "accelerate.commands.launch",
    "--num_cpu_threads_per_process",
    "1",
    trainScript,
    "--pretrained_model_name_or_path",
    baseModelPath,
    "--dataset_config",
    datasetConfigPath,
    "--output_dir",
    loraOutputDir(),
    "--output_name",
    outputName,
    "--save_model_as",
    "safetensors",
    "--network_module",
    "networks.lora",
    "--network_dim",
    process.env.LORA_NETWORK_DIM ?? "32",
    "--network_alpha",
    process.env.LORA_NETWORK_ALPHA ?? "16",
    "--learning_rate",
    process.env.LORA_LEARNING_RATE ?? "1e-4",
    "--unet_lr",
    process.env.LORA_UNET_LR ?? "1e-4",
    "--text_encoder_lr",
    process.env.LORA_TEXT_ENCODER_LR ?? "5e-5",
    "--max_train_epochs",
    process.env.LORA_MAX_TRAIN_EPOCHS ?? "10",
    "--train_batch_size",
    process.env.LORA_TRAIN_BATCH_SIZE ?? "1",
    "--optimizer_type",
    process.env.LORA_OPTIMIZER_TYPE ?? "AdamW",
    "--mixed_precision",
    process.env.LORA_MIXED_PRECISION ?? defaultMixedPrecision(),
    "--save_precision",
    process.env.LORA_SAVE_PRECISION ?? defaultSavePrecision(),
    "--cache_latents",
    "--gradient_checkpointing",
  ];
}

export async function createInitialLoraJobStatus({
  runDir,
  runId,
  loraName,
  triggerWords,
  category,
  baseModel,
  baseModelLabel,
  imageCount,
  outputName,
  logPath,
}: {
  runDir: string;
  runId: string;
  loraName: string;
  triggerWords: string;
  category: string;
  baseModel: string;
  baseModelLabel: string;
  imageCount: number;
  outputName: string;
  logPath: string;
}) {
  const now = new Date().toISOString();
  const outputPath = join(loraOutputDir(), `${outputName}.safetensors`);
  const status: LoraJobStatus = {
    runId,
    loraName,
    triggerWords,
    category,
    baseModel,
    baseModelLabel,
    imageCount,
    outputName,
    outputPath,
    logPath,
    state: "queued",
    progress: 3,
    message: "Dataset saved. Waiting to start training...",
    error: "",
    startedAt: now,
    updatedAt: now,
  };
  await writeLoraJobStatus(runDir, status);
  return status;
}

export async function startLoraJob({
  runId,
  outputName,
  runnerStatus,
  trainingTarget,
  baseModelPath,
  datasetConfigPath,
  runDir,
  logPath,
}: StartLoraJobInput) {
  const outputDir = loraOutputDir();
  await mkdir(outputDir, { recursive: true });

  const args = buildTrainingArgs({
    baseModelPath,
    datasetConfigPath,
    outputName,
    trainScript: trainingTarget.scriptPath,
  });

  await writeFile(logPath, [`python ${args.join(" ")}`, "", "---- output ----", ""].join("\n"));
  await patchLoraJobStatus(runDir, {
    state: "running",
    progress: 8,
    message: "Starting LoRA training...",
  });

  const child = spawn(loraRunnerPython(), args, {
    cwd: runnerStatus.runnerDir,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
    },
    detached: false,
  });

  registry().set(runId, child);

  const handleChunk = async (chunk: Buffer) => {
    await appendFile(logPath, chunk);
    const text = chunk.toString();
    const trimmed = text.trim();
    if (!trimmed) return;

    const progress = parseTrainingProgress(text);
    await patchLoraJobStatus(runDir, {
      ...(progress === null ? {} : { progress }),
      message: trimmed.slice(-500),
    });
  };

  child.stdout.on("data", (chunk: Buffer) => {
    void handleChunk(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    void handleChunk(chunk);
  });
  child.on("error", (error) => {
    void patchLoraJobStatus(runDir, {
      state: "failed",
      progress: 0,
      message: "LoRA training failed to start.",
      error: error.message,
      completedAt: new Date().toISOString(),
    });
  });
  child.on("close", async (exitCode) => {
    registry().delete(runId);

    const outputPath = join(outputDir, `${outputName}.safetensors`);
    if (exitCode === 0) {
      try {
        await access(outputPath);
        await patchLoraJobStatus(runDir, {
          state: "completed",
          progress: 100,
          message: "LoRA file created.",
          error: "",
          completedAt: new Date().toISOString(),
        });
      } catch {
        await patchLoraJobStatus(runDir, {
          state: "failed",
          message: "LoRA training finished, but the output file was not found.",
          error: "LoRA training finished, but the output file was not found.",
          completedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const current = await readLoraJobStatus(runId);
    if (current?.state === "cancelled") return;

    await patchLoraJobStatus(runDir, {
      state: "failed",
      message: `LoRA training failed with exit code ${exitCode}.`,
      error: `LoRA training failed with exit code ${exitCode}.`,
      completedAt: new Date().toISOString(),
    });
  });
}

export async function cancelLoraJob(runId: string) {
  const runDir = trainingRunPath(runId);
  const current = await readLoraJobStatus(runId);
  if (!current) return null;

  const child = registry().get(runId);
  if (child && !child.killed) {
    child.kill("SIGTERM");
  }
  registry().delete(runId);

  await patchLoraJobStatus(runDir, {
    state: "cancelled",
    message: "LoRA training cancelled.",
    error: "",
    completedAt: new Date().toISOString(),
  });

  return readLoraJobStatus(runId);
}
