import "server-only";

import type { GenerationParams } from "./types";

const A1111_BASE_URL =
  process.env.A1111_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:7860";
const A1111_TIMEOUT_MS = Number(process.env.A1111_TIMEOUT_MS ?? 3_600_000);
const COMFYUI_BASE_URL =
  process.env.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8188";

interface A1111Txt2ImgResponse {
  images?: string[];
  info?: string;
}

interface A1111Upscaler {
  name?: string;
  model_name?: string | null;
}

export interface A1111GeneratedImage {
  buffer: Buffer;
  contentType: string;
  originalUrl: string;
}

function a1111SamplerName(params: GenerationParams) {
  const names: Record<string, string> = {
    euler_ancestral: "Euler a",
    euler: "Euler",
    heun: "Heun",
    lms: "LMS",
    ddim: "DDIM",
    dpmpp_2m: "DPM++ 2M",
    dpmpp_sde: "DPM++ SDE",
    dpmpp_2m_sde: "DPM++ 2M SDE",
    uni_pc: "UniPC",
  };

  return names[params.sampler_name] ?? "DPM++ 2M";
}

function stripLoraTags(prompt: string) {
  return prompt.replace(/<lora:[^>]+>/gi, " ").replace(/\s+/g, " ").trim();
}

function normalizeUpscalerName(value: string) {
  return value
    .replace(/\.(pth|safetensors|ckpt)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

async function resolveA1111Upscaler(requested: string, signal: AbortSignal) {
  const response = await fetch(A1111_BASE_URL + "/sdapi/v1/upscalers", {
    signal,
    cache: "no-store",
  });
  if (!response.ok) return "ESRGAN_4x";

  const upscalers = (await response.json()) as A1111Upscaler[];
  const target = normalizeUpscalerName(requested);
  const exact = upscalers.find(
    (upscaler) =>
      normalizeUpscalerName(upscaler.name ?? "") === target ||
      normalizeUpscalerName(upscaler.model_name ?? "") === target
  );
  if (exact?.name) return exact.name;

  return (
    upscalers.find((upscaler) => upscaler.name === "ESRGAN_4x")?.name ??
    upscalers.find((upscaler) => upscaler.name === "Lanczos")?.name ??
    "None"
  );
}

function loraPrompt(params: GenerationParams) {
  const tags = (params.loras ?? [])
    .filter((lora) => lora.path.trim())
    .map((lora) => {
      const name = lora.path.split(/[\\/]/).pop()?.replace(/\.(safetensors|ckpt|pt)$/i, "");
      return name ? "<lora:" + name + ":" + lora.scale + ">" : "";
    })
    .filter(Boolean);

  return [stripLoraTags(params.prompt), ...tags].filter(Boolean).join(", ");
}

function decodeBase64Image(value: string) {
  const match = /^data:([^;]+);base64,/.exec(value);
  const contentType = match?.[1] ?? "image/png";
  const encoded = match ? value.slice(match[0].length) : value;

  return {
    buffer: Buffer.from(encoded, "base64"),
    contentType,
    originalUrl: "a1111://txt2img",
  } satisfies A1111GeneratedImage;
}

async function releaseComfyUiMemory() {
  try {
    await fetch(COMFYUI_BASE_URL + "/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      cache: "no-store",
    });
  } catch {
    // ComfyUI is optional when A1111 is selected.
  }
}

export async function generateWithA1111(
  params: GenerationParams,
  signal?: AbortSignal
) {
  if (params.generation_mode !== "text_to_image") {
    throw new Error("A1111 backend currently supports Text to Image only.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), A1111_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    await releaseComfyUiMemory();
    const requestedHiresScale = Number(params.hires_upscale);
    const autoHires =
      requestedHiresScale <= 1 && params.width * params.height > 2_000_000;
    const enableHr = requestedHiresScale > 1 || autoHires;
    const hiresScale = requestedHiresScale > 1 ? requestedHiresScale : 2;
    const width = autoHires ? Math.round(params.width / 2 / 8) * 8 : params.width;
    const height = autoHires ? Math.round(params.height / 2 / 8) * 8 : params.height;
    const imageCount = Math.min(Math.max(Number(params.num_images) || 1, 1), 4);
    const hrUpscaler = enableHr
      ? await resolveA1111Upscaler(
          params.upscale_model_name || "ESRGAN_4x",
          controller.signal
        )
      : "None";
    const payload = {
      prompt: loraPrompt(params),
      negative_prompt: params.negative_prompt,
      seed: params.seed,
      sampler_name: a1111SamplerName(params),
      scheduler: params.scheduler === "karras" ? "Karras" : "Automatic",
      batch_size: 1,
      n_iter: imageCount,
      steps: params.num_inference_steps,
      cfg_scale: params.guidance_scale,
      width,
      height,
      enable_hr: enableHr,
      denoising_strength: params.denoise_strength,
      hr_scale: enableHr ? hiresScale : 1,
      hr_upscaler: hrUpscaler,
      hr_second_pass_steps: enableHr ? params.hires_steps : 0,
      override_settings: {
        sd_model_checkpoint: params.model_name,
        CLIP_stop_at_last_layers: Math.max(1, params.clip_skip),
        ...(params.vae_name ? { sd_vae: params.vae_name } : {}),
      },
      override_settings_restore_afterwards: true,
      send_images: true,
      save_images: false,
    };

    const response = await fetch(A1111_BASE_URL + "/sdapi/v1/txt2img", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        "A1111 " + response.status + ": " + ((await response.text()) || response.statusText)
      );
    }

    const result = (await response.json()) as A1111Txt2ImgResponse;
    if (!result.images?.length) {
      throw new Error("A1111 completed without returning an image.");
    }

    return result.images.map(decodeBase64Image);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function interruptA1111() {
  await fetch(A1111_BASE_URL + "/sdapi/v1/interrupt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
}