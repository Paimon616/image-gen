import { mkdir, readdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest } from "next/server";
import { createInitialLoraJobStatus, trainingRunPath } from "@/lib/lora-job-runner";
import { getTrainingTarget, trainingDatasetPath } from "@/lib/lora-training";
import { startRunpodLoraJob } from "@/lib/runpod-lora-job";
import type { RunpodTrainingOptions } from "@/lib/runpod-training";
import { getRunpodPod } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Queues an SDXL LoRA training run on a RunPod pod as a server-side background
// job. Unlike the SSE /runpod/stream route, the run is detached from this
// request: the UI polls /api/lora-training/jobs/<runId> and survives navigation.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    runpodPodId?: string;
    loraName?: string;
    baseModel?: string;
  } & Partial<RunpodTrainingOptions>;

  const runpodPodId = body.runpodPodId?.trim();
  const datasetName = body.datasetName?.trim();
  const baseModel = (body.baseModel ?? body.baseModelFile ?? "").trim();
  if (!runpodPodId) return Response.json({ error: "runpodPodId is required." }, { status: 400 });
  if (!datasetName) return Response.json({ error: "datasetName is required." }, { status: 400 });
  if (!baseModel) return Response.json({ error: "baseModel is required." }, { status: 400 });

  const pod = await getRunpodPod(runpodPodId);
  if (!pod) return Response.json({ error: "RunPod target was not found." }, { status: 404 });

  let imageCount = 0;
  try {
    imageCount = (await readdir(trainingDatasetPath(datasetName))).filter((file) =>
      /\.(png|jpe?g|webp)$/i.test(file)
    ).length;
  } catch {
    // Missing dataset dir is handled by the imageCount check below.
  }
  if (imageCount === 0) {
    return Response.json({ error: `Dataset "${datasetName}" has no images.` }, { status: 400 });
  }

  const baseModelFile = baseModel.split(/[/\\]/).pop() || baseModel;
  const trainingTarget = await getTrainingTarget(baseModelFile).catch(() => null);
  const baseModelLabel =
    trainingTarget && trainingTarget.kind !== "unsupported" ? trainingTarget.label : baseModelFile;

  // H100 pods run batch 4; total work is capped by steps, not epochs. Target
  // ~25 passes per image (clamped to 1000-3000 passes so tiny datasets still
  // train enough and large ones don't overfit) — for 80 images this is 2000
  // passes = 500 steps instead of the old 8000.
  const batchSize = body.batchSize ?? 4;
  const imagePasses = Math.min(3000, Math.max(1000, imageCount * 25));
  const maxTrainSteps = body.maxTrainSteps ?? Math.ceil(imagePasses / batchSize);

  const opts: RunpodTrainingOptions = {
    datasetName,
    baseModelFile,
    triggerWords: (body.triggerWords ?? "").trim(),
    category: body.category,
    outputName: (body.outputName ?? datasetName).trim().replace(/[^A-Za-z0-9._-]/g, "_"),
    resolution: body.resolution,
    networkDim: body.networkDim,
    networkAlpha: body.networkAlpha,
    learningRate: body.learningRate,
    maxTrainSteps,
    maxTrainEpochs: body.maxTrainEpochs,
    batchSize,
  };

  const runId = `runpod-${randomUUID()}`;
  const runDir = trainingRunPath(runId);
  const logPath = join(runDir, "logs.txt");
  await mkdir(runDir, { recursive: true });
  await writeFile(logPath, `RunPod LoRA training · pod ${runpodPodId}\n\n---- output ----\n`);

  const status = await createInitialLoraJobStatus({
    runDir,
    runId,
    loraName: body.loraName?.trim() || datasetName,
    triggerWords: opts.triggerWords,
    category: (body.category ?? "").trim(),
    baseModel,
    baseModelLabel,
    imageCount,
    outputName: opts.outputName,
    logPath,
    runpodPodId,
  });

  startRunpodLoraJob({ runId, podId: runpodPodId, runDir, logPath, opts });

  return Response.json(status, {
    status: 202,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
