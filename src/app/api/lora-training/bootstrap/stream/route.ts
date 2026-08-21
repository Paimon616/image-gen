import { mkdir, readdir, writeFile } from "fs/promises";
import { join } from "path";
import { NextRequest } from "next/server";
import { generateWithComfyUI } from "@/lib/comfyui";
import { getRunpodPod } from "@/lib/settings";
import { trainingDatasetPath } from "@/lib/lora-training";
import { DEFAULT_PARAMS, randomGenerationSeed } from "@/lib/types";
import type { GenerationParams } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Pose/angle/expression modifiers cycled across the batch so the character is
// captured from varied viewpoints — a LoRA generalises far better from a diverse
// set than from near-duplicate frames.
const VARIATIONS = [
  "looking at viewer, front view, upper body",
  "three-quarter view, soft smile",
  "from side, profile view",
  "looking away, gentle expression",
  "close-up portrait, detailed face",
  "from below, dynamic angle",
  "from above, looking up",
  "full body, standing",
  "looking over shoulder, back turned",
  "serious expression, straight-on",
  "slightly tilted head, blushing",
  "cowboy shot, relaxed pose",
];

const IMG_EXT: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

async function countExistingImages(dir: string) {
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).length;
  } catch {
    return 0;
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    sourceImage?: string;
    baseModel?: string;
    krea2Workflow?: GenerationParams["krea2_workflow"];
    datasetName?: string;
    triggerWords?: string;
    count?: number;
    denoise?: number;
    prompt?: string;
    negativePrompt?: string;
    width?: number;
    height?: number;
    generationTarget?: "local" | "runpod";
    runpodPodId?: string;
  };

  const sourceImage = body.sourceImage?.trim();
  const baseModel = body.baseModel?.trim();
  const datasetName = body.datasetName?.trim();
  const triggerWords = (body.triggerWords ?? "").trim();
  const count = Math.min(Math.max(Math.floor(body.count ?? 20), 1), 60);
  const denoise = Math.min(Math.max(body.denoise ?? 0.5, 0.1), 0.9);

  if (!sourceImage) return Response.json({ error: "A source image is required." }, { status: 400 });
  if (!baseModel) return Response.json({ error: "A base checkpoint is required." }, { status: 400 });
  if (!datasetName) return Response.json({ error: "A dataset name is required." }, { status: 400 });

  // Reference face + captions want a caption; default to the dataset name if none.
  const caption = triggerWords || datasetName;

  let comfyBaseUrl: string | undefined;
  if (body.generationTarget === "runpod" && body.runpodPodId) {
    const pod = await getRunpodPod(body.runpodPodId);
    if (!pod?.comfyUrl) {
      return Response.json({ error: "Selected RunPod target needs a ComfyUI URL." }, { status: 400 });
    }
    comfyBaseUrl = pod.comfyUrl;
  }

  let datasetDir: string;
  try {
    datasetDir = trainingDatasetPath(datasetName);
  } catch {
    return Response.json({ error: "Invalid dataset name." }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeSend = (d: unknown) => {
        if (!closed) send(controller, d);
      };
      try {
        await mkdir(datasetDir, { recursive: true });
        let saved = await countExistingImages(datasetDir);
        safeSend({ type: "status", message: `Generating ${count} variation(s)...`, total: count });

        for (let i = 0; i < count; i += 1) {
          if (req.signal.aborted) break;
          const variation = VARIATIONS[i % VARIATIONS.length];
          const params: GenerationParams = {
            ...DEFAULT_PARAMS,
            backend: "comfyui",
            model: "comfyui/local-sdxl",
            model_name: baseModel,
            krea2_workflow: body.krea2Workflow ?? DEFAULT_PARAMS.krea2_workflow,
            prompt: [body.prompt?.trim(), variation].filter(Boolean).join(", "),
            negative_prompt: body.negativePrompt?.trim() || DEFAULT_PARAMS.negative_prompt,
            width: body.width ?? 832,
            height: body.height ?? 1216,
            num_images: 1,
            generation_mode: "image_to_image",
            source_image: sourceImage,
            denoise_strength: denoise,
            seed: randomGenerationSeed(),
          };

          try {
            const { images } = await generateWithComfyUI(
              params,
              comfyBaseUrl ? { baseUrl: comfyBaseUrl } : undefined
            );
            const img = images[0];
            if (!img) {
              safeSend({ type: "warn", message: `Variation ${i + 1} returned no image.` });
              continue;
            }
            const ext = IMG_EXT[img.contentType] ?? "png";
            const stem = String(saved + 1).padStart(3, "0");
            await writeFile(join(datasetDir, `${stem}.${ext}`), img.buffer);
            await writeFile(join(datasetDir, `${stem}.txt`), `${caption}\n`);
            saved += 1;
            safeSend({ type: "image", index: i + 1, total: count, file: `${stem}.${ext}`, saved });
          } catch (err) {
            safeSend({
              type: "warn",
              message: `Variation ${i + 1} failed: ${err instanceof Error ? err.message : "error"}`,
            });
          }
        }

        safeSend({
          type: "complete",
          datasetName,
          saved,
          message: `Saved ${saved} image(s) to the '${datasetName}' dataset.`,
        });
      } catch (error) {
        safeSend({
          type: "error",
          message: error instanceof Error ? error.message : "Bootstrap failed.",
        });
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
