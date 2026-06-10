import { NextRequest, NextResponse } from "next/server";
import { generateWithComfyUI } from "@/lib/comfyui";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getModelConfig, normalizeImageDimension } from "@/lib/types";
import type { GenerationParams } from "@/lib/types";

const OUTPUT_DIR = join(process.cwd(), "output");

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

      await writeFile(join(OUTPUT_DIR, filename), img.buffer);

      const metaFilename = `${id}.json`;
      await writeFile(
        join(OUTPUT_DIR, metaFilename),
        JSON.stringify(
          {
            id,
            filename,
            params,
            endpoint,
            timestamp: Date.now(),
            original_url: img.originalUrl,
            index: i,
          },
          null,
          2
        )
      );

      return {
        id,
        url: `/api/images/${filename}`,
        filename,
        params,
        timestamp: Date.now(),
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

    const images = await generateWithComfyUI(body);
    const savedImages = await saveBufferedImages({
      images,
      params: body,
      endpoint: modelConfig.id,
    });

    return NextResponse.json({ images: savedImages });
  } catch (error) {
    console.error("Generation error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
