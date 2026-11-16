import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { buildComfyWorkflow, type ComfyClientOptions } from "@/lib/comfyui";
import { getRunpodPod } from "@/lib/settings";
import { readImageMetadata, readOriginalImage } from "@/lib/server-images";
import { normalizeImageDimension, type GenerationParams } from "@/lib/types";
import {
  extractStyleSpec,
  SEED_SENTINEL,
  sentinelPrompt,
  type ComfyApiWorkflow,
  type StyleSpec,
} from "@/lib/style-spec";

interface ExportRequest {
  /** A generated image: its stored params are the style, the image its thumbnail. */
  imageFilename: string;
  meta: {
    id: string;
    version: number;
    name: { ko: string; en: string };
    description?: string;
  };
  promptTemplate: string;
  generationTarget?: "local" | "runpod" | "workers";
  runpodPodId?: string;
}

const THUMBNAIL_EDGE = 512;

async function makeThumbnail(filename: string): Promise<StyleSpec["thumbnail"]> {
  const original = await readOriginalImage(filename);
  if (!original) return undefined;
  const { data, info } = await sharp(original.buffer)
    .resize(THUMBNAIL_EDGE, THUMBNAIL_EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return {
    dataUrl: `data:image/webp;base64,${data.toString("base64")}`,
    width: info.width,
    height: info.height,
  };
}

// Rebuilds the exact ComfyUI graph a generated image was made with, with the
// prompt and seed replaced by sentinels, and turns it into a portable style spec
// (see src/lib/style-spec.ts). Nothing is queued.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ExportRequest;
    const { meta, promptTemplate, imageFilename } = body;

    const metadataBuffer = imageFilename ? await readImageMetadata(imageFilename) : null;
    if (!metadataBuffer) {
      return NextResponse.json({ error: "No generation metadata for this image." }, { status: 404 });
    }
    const params = (JSON.parse(metadataBuffer.toString("utf8")) as { params?: GenerationParams })
      .params;
    if (!params) {
      return NextResponse.json({ error: "This image has no generation settings." }, { status: 400 });
    }
    if (params.backend !== "comfyui") {
      return NextResponse.json(
        { error: "Style export supports images generated with ComfyUI only." },
        { status: 400 }
      );
    }
    // GPU workers are leased per job, so the "workers" target builds against the
    // local ComfyUI settings (most graphs need no live server to be built).
    let options: ComfyClientOptions | undefined;
    if (body.generationTarget === "runpod") {
      const pod = body.runpodPodId ? await getRunpodPod(body.runpodPodId) : undefined;
      if (!pod?.comfyUrl) {
        return NextResponse.json(
          { error: "Select a RunPod target with a ComfyUI URL first." },
          { status: 400 }
        );
      }
      options = { baseUrl: pod.comfyUrl, remoteKind: "runpod" };
    }

    const width = normalizeImageDimension(params.width);
    const height = normalizeImageDimension(params.height);
    // A style is text-to-image only: per-user reference images are a later step.
    const exportParams: GenerationParams = {
      ...params,
      width,
      height,
      prompt: sentinelPrompt(promptTemplate),
      seed: SEED_SENTINEL,
      num_images: 1,
      generation_mode: "text_to_image",
      style_image: null,
      character_image: null,
      scene_reference_image: null,
      character_face_image: null,
      identity_reference_image: null,
      character_sheet_image: null,
      source_image: null,
      pose_reference_image: null,
      controlnets: [],
    };

    const workflow = (await buildComfyWorkflow(exportParams, options)) as ComfyApiWorkflow;
    const spec = extractStyleSpec({
      workflow,
      meta,
      promptTemplate,
      negativePrompt: params.negative_prompt,
      width,
      height,
      source: {
        model_name: params.model_name,
        loras: (params.loras ?? []).filter((lora) => lora.path.trim()),
        steps: params.num_inference_steps,
        cfg: params.guidance_scale,
        sampler: params.sampler_name,
        scheduler: params.scheduler,
      },
    });
    spec.thumbnail = await makeThumbnail(imageFilename);

    return NextResponse.json(spec);
  } catch (error) {
    console.error("Style export error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
