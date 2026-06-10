import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { generateOpenPosePreview } from "@/lib/comfyui";
import { IMAGE_SIZE_CONSTRAINTS } from "@/lib/types";

const OUTPUT_DIR = join(process.cwd(), "output");

function normalizeResolution(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 1024;

  const { min, max, step } = IMAGE_SIZE_CONSTRAINTS;
  const stepped = Math.round(numericValue / step) * step;
  return Math.min(Math.max(stepped, min), max);
}

function extensionForContentType(contentType: string) {
  return contentType === "image/png" ? "png" : "jpeg";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      image?: string | null;
      resolution?: number;
    };

    if (!body.image) {
      return NextResponse.json({ error: "image is required" }, { status: 400 });
    }

    const images = await generateOpenPosePreview(
      body.image,
      normalizeResolution(body.resolution)
    );
    const image = images[0];

    if (!image) {
      return NextResponse.json({ error: "No preview image generated" }, { status: 500 });
    }

    await mkdir(OUTPUT_DIR, { recursive: true });
    const id = randomUUID();
    const filename = `${id}.${extensionForContentType(image.contentType)}`;
    await writeFile(join(OUTPUT_DIR, filename), image.buffer);

    return NextResponse.json({
      url: `/api/images/${filename}`,
      filename,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pose preview failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
