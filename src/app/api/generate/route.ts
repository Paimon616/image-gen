import { NextRequest, NextResponse } from "next/server";
import { fal } from "@/lib/fal";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { getModelConfig } from "@/lib/types";
import type { EmbeddingConfig, LoraConfig } from "@/lib/types";

const OUTPUT_DIR = join(process.cwd(), "output");

async function ensureOutputDir() {
  await mkdir(OUTPUT_DIR, { recursive: true });
}

function isLikelyBlankPlaceholder(buffer: Buffer, width: number, height: number) {
  const megapixels = (width * height) / 1_000_000;
  const bytesPerMegapixel = buffer.byteLength / Math.max(megapixels, 0.1);

  return width >= 512 && height >= 512 && bytesPerMegapixel < 35_000;
}

function compactLoras(loras: LoraConfig[] | undefined) {
  return (loras ?? [])
    .map((lora) => ({
      path: lora.path.trim(),
      scale: Number.isFinite(lora.scale) ? lora.scale : 1,
    }))
    .filter((lora) => lora.path.length > 0);
}

function compactEmbeddings(embeddings: EmbeddingConfig[] | undefined) {
  return (embeddings ?? [])
    .map((embedding) => ({
      path: embedding.path.trim(),
      tokens: embedding.tokens
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean),
    }))
    .filter((embedding) => embedding.path.length > 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInput(body: Record<string, any>): { endpoint: string; input: Record<string, any> } {
  const {
    model,
    model_name,
    prompt,
    negative_prompt,
    num_inference_steps,
    guidance_scale,
    width,
    height,
    num_images,
    output_format,
    seed,
    loras,
    embeddings,
    prompt_weighting,
    style_image,
    character_image,
    enable_safety_checker,
  } = body;

  const modelConfig = getModelConfig(model);
  const endpoint = modelConfig.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: Record<string, any> = { prompt };
  const cleanLoras = compactLoras(loras);
  const cleanEmbeddings = compactEmbeddings(embeddings);

  if (modelConfig.supports.custom_model) {
    input.model_name = model_name || "stabilityai/stable-diffusion-xl-base-1.0";
    input.prompt_weighting = prompt_weighting !== false;
  }

  if (modelConfig.supports.negative_prompt && negative_prompt) {
    input.negative_prompt = negative_prompt;
  }

  input.num_inference_steps = num_inference_steps;

  if (guidance_scale > 0) {
    input.guidance_scale = guidance_scale;
  }

  input.enable_safety_checker = enable_safety_checker;
  input.num_images = Math.min(Math.max(Number(num_images) || 1, 1), 4);

  if (seed != null) {
    input.seed = seed;
  }

  if (modelConfig.supports.lora && cleanLoras.length > 0) {
    input.loras = cleanLoras;
  }

  if (modelConfig.supports.embeddings && cleanEmbeddings.length > 0) {
    input.embeddings = cleanEmbeddings;
  }

  if (modelConfig.supports.face_id && character_image) {
    input.face_image_url = character_image;
  }

  if (modelConfig.supports.ip_adapter && style_image) {
    input.ip_adapter_image_url = style_image;
  }

  // Size format varies by model
  switch (endpoint) {
    case "fal-ai/fast-sdxl":
      input.image_size = { width, height };
      input.format = output_format || "jpeg";
      break;
    case "fal-ai/lora":
      input.image_size = { width, height };
      input.image_format = output_format || "jpeg";
      break;
    case "fal-ai/flux/dev":
    case "fal-ai/flux/schnell":
    case "fal-ai/flux-lora":
      input.image_size = { width, height };
      input.output_format = output_format || "jpeg";
      break;
    case "fal-ai/stable-diffusion-v35-large":
      input.image_size = { width, height };
      input.output_format = output_format || "jpeg";
      break;
    default:
      input.width = width;
      input.height = height;
      break;
  }

  return { endpoint, input };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { endpoint, input } = buildInput(body);

    const result = await fal.subscribe(endpoint, {
      input,
      logs: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = result.data as any;
    const images = data?.images || (data?.image ? [data.image] : []);
    const nsfwFlags = Array.isArray(data?.has_nsfw_concepts)
      ? data.has_nsfw_concepts
      : [];

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
          const isBlankPlaceholder = isLikelyBlankPlaceholder(
            buffer,
            body.width,
            body.height
          );
          const wasFlagged = Boolean(nsfwFlags[i]);

          if (isBlankPlaceholder || wasFlagged) {
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
                  rejected: true,
                  likely_blank_placeholder: isBlankPlaceholder,
                  has_nsfw_concepts: wasFlagged,
                },
                null,
                2
              )
            );

            return null;
          }

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
                has_nsfw_concepts: wasFlagged,
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

    const validImages = savedImages.filter(Boolean);

    if (!validImages.length) {
      return NextResponse.json(
        {
          error:
            "The model returned a blank or filtered image. Try a less restricted prompt, a different model, or remove conflicting LoRA/embedding inputs.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ images: validImages });
  } catch (error) {
    console.error("Generation error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
