import { NextRequest, NextResponse } from "next/server";
import { generateWithComfyUI } from "@/lib/comfyui";
import { generateWithA1111 } from "@/lib/a1111";
import { writeFile, mkdir } from "fs/promises";
import { randomUUID } from "crypto";
import {
  getModelConfig,
  normalizeGenerationSeed,
  normalizeImageDimension,
} from "@/lib/types";
import type { GenerationParams } from "@/lib/types";
import { imageUrl, OUTPUT_DIR, thumbnailUrl } from "@/lib/server-images";
import { buildGenerationResources } from "@/lib/generation-resource-links";

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

function extensionForContentType(contentType: string) {
  return contentType === "image/png" ? "png" : "jpeg";
}

async function saveBufferedImages({
  images,
  params,
  endpoint,
}: {
  images: { buffer: Buffer; contentType: string; originalUrl: string }[];
  params: GenerationParams;
  endpoint: string;
}) {
  await ensureOutputDir();

  return Promise.all(
    images.map(async (img, i) => {
      const id = randomUUID();
      const filename = `${id}.${extensionForContentType(img.contentType)}`;

      await writeFile(`${OUTPUT_DIR}/${filename}`, img.buffer);

      const metaFilename = `${id}.json`;
      const timestamp = Date.now();
      const resources = await buildGenerationResources(params);

      await writeFile(
        `${OUTPUT_DIR}/${metaFilename}`,
        JSON.stringify(
          {
            id,
            filename,
            params,
            size_semantics: "final",
            resources,
            endpoint,
            timestamp,
            original_url: img.originalUrl,
            index: i,
          },
          null,
          2
        )
      );

      return {
        id,
        url: imageUrl(filename),
        thumbnailUrl: thumbnailUrl(filename),
        filename,
        params,
        sizeSemantics: "final" as const,
        timestamp,
      };
    })
  );
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = (await req.json()) as GenerationParams;
    const body: GenerationParams = {
      ...rawBody,
      width: normalizeImageDimension(rawBody.width),
      height: normalizeImageDimension(rawBody.height),
      seed: normalizeGenerationSeed(rawBody.seed),
    };
    const modelConfig = getModelConfig(body.model);

    if (
      body.generation_mode === "pose_reference" &&
      (!body.pose_reference_image || !body.pose_reference_model?.trim())
    ) {
      return NextResponse.json(
        { error: "Pose Reference mode requires an image and a ControlNet model." },
        { status: 400 }
      );
    }

    if (body.generation_mode === "image_to_image" && !body.source_image) {
      return NextResponse.json(
        { error: "Image to Image mode requires a source image." },
        { status: 400 }
      );
    }

    const images =
      body.backend === "a1111" || body.backend === "forge"
        ? await generateWithA1111(body, req.signal)
        : await generateWithComfyUI(body);
    const savedImages = await saveBufferedImages({
      images,
      params: body,
      endpoint:
        body.backend === "a1111" || body.backend === "forge"
          ? `${body.backend}/local`
          : modelConfig.id,
    });

    return NextResponse.json({ images: savedImages });
  } catch (error) {
    console.error("Generation error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
