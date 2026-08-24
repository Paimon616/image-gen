import { access, appendFile, mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import {
  firstImageInDir,
  loraOutputDir,
  loraRunnerPython,
  registerSelfTrainedLora,
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
  processId?: number;
  // Set when this job trains on a RunPod pod instead of the local runner.
  runpodPodId?: string;
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
  __imageGenLoraStatusWrites?: Map<string, Promise<void>>;
  __imageGenRunpodLoraAborts?: Map<string, AbortController>;
};

function registry() {
  const globalRef = globalThis as LoraJobRegistry;
  if (!globalRef.__imageGenLoraJobs) {
    globalRef.__imageGenLoraJobs = new Map();
  }
  return globalRef.__imageGenLoraJobs;
}

function runpodAbortRegistry() {
  const globalRef = globalThis as LoraJobRegistry;
  if (!globalRef.__imageGenRunpodLoraAborts) {
    globalRef.__imageGenRunpodLoraAborts = new Map();
  }
  return globalRef.__imageGenRunpodLoraAborts;
}

export function registerRunpodLoraAbort(runId: string, controller: AbortController) {
  runpodAbortRegistry().set(runId, controller);
}

export function unregisterRunpodLoraAbort(runId: string) {
  runpodAbortRegistry().delete(runId);
}

function statusWriteRegistry() {
  const globalRef = globalThis as LoraJobRegistry;
  if (!globalRef.__imageGenLoraStatusWrites) {
    globalRef.__imageGenLoraStatusWrites = new Map();
  }
  return globalRef.__imageGenLoraStatusWrites;
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

export async function patchLoraJobStatus(
  runDir: string,
  patch: Partial<Omit<LoraJobStatus, "runId" | "outputName" | "outputPath" | "logPath" | "startedAt">>
) {
  const writes = statusWriteRegistry();
  const previous = writes.get(runDir) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = JSON.parse(await readFile(statusPath(runDir), "utf8")) as LoraJobStatus;
      await writeLoraJobStatus(runDir, {
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      });
    });
  writes.set(runDir, next);
  await next;
  if (writes.get(runDir) === next) {
    writes.delete(runDir);
  }
}

export async function killProcessTree(processId: number | undefined) {
  if (!processId || !Number.isFinite(processId) || processId <= 0) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(processId), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(-processId, "SIGTERM");
  } catch {
    try {
      process.kill(processId, "SIGTERM");
    } catch {
    }
  }
}

export function parseTrainingProgress(line: string) {
  const stepLine = line
    .split(/\r?\n/)
    .reverse()
    .find((value) => /\bsteps:/.test(value));
  if (!stepLine) return null;

  const percentMatch = stepLine.match(/steps:\s*(\d{1,3})%\|/);
  if (percentMatch) {
    return Math.min(99, Math.max(1, Number(percentMatch[1])));
  }

  const stepMatch = stepLine.match(/steps:.*?(\d+)\s*\/\s*(\d+)/i);
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
  const mixedPrecision = process.env.LORA_MIXED_PRECISION ?? defaultMixedPrecision();

  return [
    "-m",
    "accelerate.commands.launch",
    "--num_processes",
    "1",
    "--num_machines",
    "1",
    "--mixed_precision",
    mixedPrecision,
    "--dynamo_backend",
    "no",
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
    process.env.LORA_NETWORK_DIM ?? "16",
    "--network_alpha",
    process.env.LORA_NETWORK_ALPHA ?? "8",
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
    "--max_data_loader_n_workers",
    process.env.LORA_MAX_DATA_LOADER_N_WORKERS ?? "0",
    "--optimizer_type",
    process.env.LORA_OPTIMIZER_TYPE ?? "AdamW",
    "--mixed_precision",
    mixedPrecision,
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
  runpodPodId,
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
  runpodPodId?: string;
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
    ...(runpodPodId ? { runpodPodId } : {}),
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
      PYTHONIOENCODING: "utf-8:replace",
      PYTHONUNBUFFERED: "1",
    },
    detached: process.platform !== "win32",
  });

  registry().set(runId, child);
  await patchLoraJobStatus(runDir, {
    processId: child.pid,
  });

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
        // Register the finished LoRA in the model catalog: name, base model,
        // trigger-word tags, and a preview taken from the training dataset —
        // marked self-trained (no Civitai/source link).
        try {
          const status = await readLoraJobStatus(runId);
          await registerSelfTrainedLora({
            outputName,
            loraName: status?.loraName,
            triggerWords: status?.triggerWords,
            category: status?.category,
            baseModelLabel: status?.baseModelLabel,
            baseModelFile: status?.baseModel,
            previewImagePath: await firstImageInDir(join(runDir, "images")),
          });
        } catch {
          // Metadata is best-effort — the training result itself already succeeded.
        }
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
  await killProcessTree(child?.pid);
  await killProcessTree(current.processId);
  registry().delete(runId);

  // RunPod jobs run through an in-process poller — aborting it also pkills the
  // training process on the pod.
  const runpodAbort = runpodAbortRegistry().get(runId);
  if (runpodAbort) {
    runpodAbort.abort();
    runpodAbortRegistry().delete(runId);
  }

  await patchLoraJobStatus(runDir, {
    state: "cancelled",
    message: "LoRA training cancelled.",
    error: "",
    processId: undefined,
    completedAt: new Date().toISOString(),
  });

  return readLoraJobStatus(runId);
}
