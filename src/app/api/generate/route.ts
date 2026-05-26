import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const OUTPUT_DIR = join(process.cwd(), "output");

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      prompt,
      negative_prompt,
      num_inference_steps,
      guidance_scale,
      width,
      height,
      seed,
      loras,
      style_image,
      character_image,
      enable_safety_checker,
    } = body;

    const hasStyleImage = !!style_image;
    const hasCharacterImage = !!character_image;

    let endpoint: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let input: Record<string, any>;

    if (hasCharacterImage && hasStyleImage) {
      endpoint = "fal-ai/ip-adapter-face-id";
      input = {
        prompt,
        negative_prompt,
        face_image_url: character_image,
        ip_adapter_image_url: style_image,
        num_inference_steps,
        guidance_scale,
        width,
        height,
        enable_safety_checker,
        ...(seed != null && { seed }),
        ...(loras.length > 0 && { loras }),
      };
    } else if (hasCharacterImage) {
      endpoint = "fal-ai/ip-adapter-face-id";
      input = {
        prompt,
        negative_prompt,
        face_image_url: character_image,
        num_inference_steps,
        guidance_scale,
        width,
        height,
        enable_safety_checker,
        ...(seed != null && { seed }),
        ...(loras.length > 0 && { loras }),
      };
    } else if (hasStyleImage) {
      endpoint = "fal-ai/ip-adapter";
      input = {
        prompt,
        negative_prompt,
        ip_adapter_image_url: style_image,
        num_inference_steps,
        guidance_scale,
        width,
        height,
        enable_safety_checker,
        ...(seed != null && { seed }),
        ...(loras.length > 0 && { loras }),
      };
    } else {
      endpoint = "fal-ai/fast-sdxl";
      input = {
        prompt,
        negative_prompt,
        num_inference_steps,
        guidance_scale,
        image_size: { width, height },
        enable_safety_checker,
        ...(seed != null && { seed }),
        ...(loras.length > 0 && { loras }),
      };
    }

    const result = await fal.subscribe(endpoint, {
      input,
      logs: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    const images = data?.images || data?.image ? [data.image] : [];

    if (!images.length) {
      return NextResponse.json(
        { error: "No images generated" },
        { status: 500 }
      );
    }

    await ensureOutputDir();

    const savedImages = await Promise.all(
      images.map(
        async (img: { url: string; content_type?: string }, i: number) => {
          const id = randomUUID();
          const ext =
            img.content_type === "image/png" ? "png" : "jpeg";
          const filename = `${id}.${ext}`;

          const response = await fetch(img.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          await writeFile(join(OUTPUT_DIR, filename), buffer);

          const metaFilename = `${id}.json`;
          await writeFile(
            join(OUTPUT_DIR, metaFilename),
            JSON.stringify(
              {
                id,
                filename,
                params: body,
                endpoint,
                timestamp: Date.now(),
                original_url: img.url,
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
            params: body,
            timestamp: Date.now(),
          };
        }
      )
    );

    return NextResponse.json({ images: savedImages });
  } catch (error) {
    console.error("Generation error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
