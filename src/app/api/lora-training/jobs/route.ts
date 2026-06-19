import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  createInitialLoraJobStatus,
  listLoraJobStatuses,
  startLoraJob,
  trainingRunPath,
} from "@/lib/lora-job-runner";
import {
  buildSdxlTrainingConfig,
  checkpointPath,
  getLoraRunnerStatus,
  getTrainingTarget,
  loraOutputDir,
  safeImageExtension,
  safeOutputName,
  writeTrainingReadme,
} from "@/lib/lora-training";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIN_IMAGES = 10;
const MAX_IMAGES = 100;

export async function GET() {
  const jobs = await listLoraJobStatuses();
  const activeJob =
    jobs.find((job) => job.state === "running" || job.state === "queued") ?? jobs[0] ?? null;

  return Response.json(
    { activeJob, jobs: jobs.slice(0, 20) },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
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

export async function POST(req: NextRequest) {
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

  const trainingTarget = await getTrainingTarget(baseModel);
  if (trainingTarget.kind === "unsupported") {
    return Response.json(
      { error: trainingTarget.reason, baseModel: trainingTarget.label },
      { status: 400 }
    );
  }

  const runId = randomUUID();
  const outputName = safeOutputName(loraName);
  const runDir = trainingRunPath(runId);
  const imageDir = join(runDir, "images");
  const datasetConfigPath = join(runDir, "dataset.toml");
  const logPath = join(runDir, "logs.txt");
  const outputDir = loraOutputDir();

  await mkdir(runDir, { recursive: true });
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
    resolution: trainingTarget.resolution,
  });

  await writeFile(datasetConfigPath, datasetConfig);
  await writeTrainingReadme(runDir, [
    `runId=${runId}`,
    `loraName=${loraName}`,
    `baseModel=${baseModel}`,
    `baseModelType=${trainingTarget.label}`,
    `trainingScript=${trainingTarget.scriptPath}`,
    `output=${join(outputDir, `${outputName}.safetensors`)}`,
  ]);

  const status = await createInitialLoraJobStatus({
    runDir,
    runId,
    loraName,
    triggerWords,
    category,
    baseModel,
    baseModelLabel: trainingTarget.label,
    imageCount: files.length,
    outputName,
    logPath,
  });
  await startLoraJob({
    runId,
    outputName,
    runnerStatus,
    trainingTarget,
    baseModelPath,
    datasetConfigPath,
    runDir,
    logPath,
  });

  return Response.json(status, {
    status: 202,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
