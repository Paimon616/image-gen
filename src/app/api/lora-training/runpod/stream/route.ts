import { NextRequest } from "next/server";
import { streamRunpodLoraTraining, type RunpodTrainingOptions } from "@/lib/runpod-training";
import {
  firstImageInDir,
  getTrainingTarget,
  registerSelfTrainedLora,
  trainingDatasetPath,
} from "@/lib/lora-training";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Runs an SDXL LoRA training job on a RunPod pod (via the Jupyter channel), streaming
// dataset-upload / training-progress / retrieval events back as SSE.
export async function POST(req: NextRequest) {
  const body = (await req.json()) as { runpodPodId?: string } & Partial<RunpodTrainingOptions>;
  const runpodPodId = body.runpodPodId?.trim();
  if (!runpodPodId) return Response.json({ error: "runpodPodId is required." }, { status: 400 });
  if (!body.datasetName?.trim()) return Response.json({ error: "datasetName is required." }, { status: 400 });
  if (!body.baseModelFile?.trim()) return Response.json({ error: "baseModelFile is required." }, { status: 400 });

  const opts: RunpodTrainingOptions = {
    datasetName: body.datasetName.trim(),
    baseModelFile: body.baseModelFile.trim(),
    triggerWords: (body.triggerWords ?? "").trim(),
    category: body.category,
    outputName: (body.outputName ?? body.datasetName).trim().replace(/[^A-Za-z0-9._-]/g, "_"),
    resolution: body.resolution,
    networkDim: body.networkDim,
    networkAlpha: body.networkAlpha,
    learningRate: body.learningRate,
    maxTrainSteps: body.maxTrainSteps,
    maxTrainEpochs: body.maxTrainEpochs,
  };

  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeSend = (d: unknown) => {
        if (!closed) send(controller, d);
      };
      // On completion, register the retrieved LoRA in the model catalog (name,
      // base model, trigger-word tags, preview from the dataset) — marked
      // self-trained with no Civitai/source link. Best-effort: metadata failure
      // must not fail the training stream.
      const registerMetadata = async () => {
        const target = await getTrainingTarget(opts.baseModelFile).catch(() => null);
        await registerSelfTrainedLora({
          outputName: opts.outputName,
          loraName: opts.outputName,
          triggerWords: opts.triggerWords,
          category: opts.category,
          baseModelLabel:
            target && target.kind !== "unsupported" ? target.label : opts.baseModelFile,
          baseModelFile: opts.baseModelFile,
          previewImagePath: await firstImageInDir(trainingDatasetPath(opts.datasetName)),
        });
      };
      try {
        await streamRunpodLoraTraining(
          runpodPodId,
          opts,
          (e) => {
            safeSend(e);
            if (e.type === "complete") void registerMetadata().catch(() => {});
          },
          abort.signal
        );
      } catch (error) {
        safeSend({ type: "error", message: error instanceof Error ? error.message : "Training failed." });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
