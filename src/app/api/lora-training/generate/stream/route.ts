import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { NextRequest } from "next/server";
import {
  buildSdxlTrainingConfig,
  checkpointPath,
  getLoraRunnerStatus,
  loraOutputDir,
  loraRunnerPython,
  safeImageExtension,
  safeOutputName,
  sdxlTrainScript,
  writeTrainingReadme,
} from "@/lib/lora-training";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_IMAGES = 10;
const MAX_IMAGES = 100;

function trainingRunPath(runId: string) {
  if (process.env.LORA_TRAINING_DIR) {
    return join(process.env.LORA_TRAINING_DIR, runId);
  }

  return join(/*turbopackIgnore: true*/ process.cwd(), "training", "runs", runId);
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseProgress(line: string) {
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

async function saveDataset({
  files,
  imageDir,
  triggerWords,
}: {
  files: File[];
  imageDir: string;
  triggerWords: string;
}) {
  await mkdir(imageDir, { recursive: true });

  await Promise.all(
    files.map(async (file, index) => {
      const extension = safeImageExtension(file);
      const filename = `${String(index + 1).padStart(3, "0")}${extension}`;
      const imagePath = join(imageDir, filename);
      const captionPath = join(imageDir, `${String(index + 1).padStart(3, "0")}.txt`);

      await writeFile(imagePath, Buffer.from(await file.arrayBuffer()));
      await writeFile(captionPath, `${triggerWords}\n`);
    })
  );
}

function trainingArgs({
  baseModelPath,
  datasetConfigPath,
  outputName,
}: {
  baseModelPath: string;
  datasetConfigPath: string;
  outputName: string;
}) {
  return [
    "-m",
    "accelerate.commands.launch",
    "--num_cpu_threads_per_process",
    "1",
    sdxlTrainScript(),
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
    process.env.LORA_MIXED_PRECISION ?? "fp16",
    "--save_precision",
    process.env.LORA_SAVE_PRECISION ?? "fp16",
    "--cache_latents",
    "--gradient_checkpointing",
  ];
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();
  const formData = await req.formData();
  const loraName = field(formData, "loraName");
  const triggerWords = field(formData, "triggerWords");
  const category = field(formData, "category");
  const baseModel = field(formData, "baseModel");
  const files = formData
    .getAll("images")
    .filter((value): value is File => value instanceof File && value.type.startsWith("image/"))
    .slice(0, MAX_IMAGES);

  if (!loraName || !triggerWords || !baseModel) {
    return Response.json(
      { error: "loraName, triggerWords, and baseModel are required." },
      { status: 400 }
    );
  }

  if (files.length < MIN_IMAGES) {
    return Response.json(
      { error: `At least ${MIN_IMAGES} images are required.` },
      { status: 400 }
    );
  }

  const runnerStatus = await getLoraRunnerStatus();
  if (!runnerStatus.ready) {
    return Response.json(
      { error: "LoRA runner is not configured.", missing: runnerStatus.missing },
      { status: 409 }
    );
  }

  let baseModelPath = "";
  try {
    baseModelPath = checkpointPath(baseModel);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid base model path." },
      { status: 400 }
    );
  }

  let child: ChildProcessWithoutNullStreams | null = null;
  let clientDisconnected = false;

  const abortTraining = () => {
    clientDisconnected = true;
    child?.kill("SIGTERM");
  };

  req.signal.addEventListener("abort", abortTraining, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (clientDisconnected) return;
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        const runId = randomUUID();
        const outputName = safeOutputName(loraName);
        const runDir = trainingRunPath(runId);
        const imageDir = join(runDir, "images");
        const datasetConfigPath = join(runDir, "dataset.toml");
        const logPath = join(runDir, "logs.txt");

        send("queued", { runId, outputName });
        send("progress", { progress: 3, message: "Saving dataset..." });

        await mkdir(runDir, { recursive: true });
        const outputDir = loraOutputDir();
        await mkdir(outputDir, { recursive: true });
        await saveDataset({ files, imageDir, triggerWords });

        const datasetConfig = buildSdxlTrainingConfig({
          runId,
          loraName,
          triggerWords,
          baseModel,
          category,
          imageDir,
          outputName,
        });

        await writeFile(datasetConfigPath, datasetConfig);
        await writeTrainingReadme(runDir, [
          `runId=${runId}`,
          `loraName=${loraName}`,
          `baseModel=${baseModel}`,
          `output=${join(outputDir, `${outputName}.safetensors`)}`,
        ]);

        const args = trainingArgs({ baseModelPath, datasetConfigPath, outputName });
        await writeFile(
          logPath,
          [`python ${args.join(" ")}`, "", "---- output ----", ""].join("\n")
        );

        send("progress", { progress: 8, message: "Starting LoRA training..." });
        child = spawn(loraRunnerPython(), args, {
          cwd: runnerStatus.runnerDir,
          env: {
            ...process.env,
            PYTHONUNBUFFERED: "1",
          },
        });

        const appendLog = async (chunk: Buffer) => {
          await writeFile(logPath, chunk, { flag: "a" });
        };

        child.stdout.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          void appendLog(chunk);
          const progress = parseProgress(text);
          if (progress !== null) {
            send("progress", { progress, message: text.trim().slice(-240) });
          } else {
            send("log", { message: text.trim().slice(-500) });
          }
        });

        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();
          void appendLog(chunk);
          const progress = parseProgress(text);
          if (progress !== null) {
            send("progress", { progress, message: text.trim().slice(-240) });
          } else {
            send("log", { message: text.trim().slice(-500) });
          }
        });

        const exitCode = await new Promise<number | null>((resolve) => {
          child?.on("close", resolve);
        });

        if (clientDisconnected) return;

        if (exitCode !== 0) {
          throw new Error(`LoRA training failed with exit code ${exitCode}. See ${logPath}`);
        }

        const outputPath = join(outputDir, `${outputName}.safetensors`);
        send("progress", { progress: 100, message: "LoRA file created." });
        send("complete", { runId, outputName, outputPath });
      } catch (error) {
        if (!clientDisconnected) {
          send("error", {
            error: error instanceof Error ? error.message : "LoRA training failed.",
          });
        }
      } finally {
        req.signal.removeEventListener("abort", abortTraining);
        if (!clientDisconnected) controller.close();
      }
    },
    cancel() {
      abortTraining();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
