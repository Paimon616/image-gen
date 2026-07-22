import "server-only";

import type { GenerationParams } from "./types";

const A1111_BASE_URL =
  process.env.A1111_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:7860";
const FORGE_BASE_URL =
  process.env.FORGE_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:7861";
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

function webUiBaseUrl(backend: GenerationParams["backend"]) {
  return backend === "forge" ? FORGE_BASE_URL : A1111_BASE_URL;
}

async function resolveA1111Upscaler(
  baseUrl: string,
  requested: string,
  signal: AbortSignal
) {
  const cleanRequested = requested.replace(/\.(pth|safetensors|ckpt)$/i, "").trim();
  if (/^latent(?:\s|$|\()/i.test(cleanRequested)) {
    try {
      const latentResponse = await fetch(baseUrl + "/sdapi/v1/latent-upscale-modes", {
        signal,
        cache: "no-store",
      });
      if (latentResponse.ok) {
        const modes = (await latentResponse.json()) as Array<{ name?: string }>;
        const match = modes.find(
          (mode) => normalizeUpscalerName(mode.name ?? "") === normalizeUpscalerName(cleanRequested)
        );
        if (match?.name) return match.name;
      }
    } catch {
      // Older WebUI builds may not expose the discovery endpoint.
    }
    return cleanRequested;
  }

  const response = await fetch(baseUrl + "/sdapi/v1/upscalers", {
    signal,
    cache: "no-store",
  });
  if (!response.ok) return "ESRGAN_4x";

  const upscalers = (await response.json()) as A1111Upscaler[];
  const target = normalizeUpscalerName(requested);
  const exact =
    upscalers.find(
      (upscaler) => normalizeUpscalerName(upscaler.name ?? "") === target
    ) ??
    upscalers.find(
      (upscaler) => normalizeUpscalerName(upscaler.model_name ?? "") === target
    );
  if (exact?.name) return exact.name;


  return (
    upscalers.find((upscaler) => upscaler.name === "ESRGAN_4x")?.name ??
    upscalers.find((upscaler) => upscaler.name === "Lanczos")?.name ??
    "None"
  );
}

function roundToMultipleOfEight(value: number) {
  return Math.max(8, Math.round(value / 8) * 8);
}

// Read intrinsic pixel dimensions straight from the file header so img2img can
// resize relative to the source without pulling in an image library.
function readImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length >= 24 && buffer.toString("ascii", 12, 16) === "IHDR") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7),
        };
      }
      const segmentLength = buffer.readUInt16BE(offset + 2);
      if (segmentLength < 2) return null;
      offset += 2 + segmentLength;
    }
  }

  return null;
}

async function resolveSourceImage(source: string, signal: AbortSignal) {
  const dataUrlMatch = /^data:[^;]+;base64,/.exec(source);
  if (dataUrlMatch) {
    const base64 = source.slice(dataUrlMatch[0].length);
    return { base64, buffer: Buffer.from(base64, "base64") };
  }

  const response = await fetch(source, { signal, cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load source image: " + response.status);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return { base64: buffer.toString("base64"), buffer };
}

async function extrasUpscale(
  baseUrl: string,
  imageBase64: string,
  resize: number,
  upscaler: string,
  signal: AbortSignal
) {
  const response = await fetch(baseUrl + "/sdapi/v1/extra-single-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resize_mode: 0,
      upscaling_resize: resize,
      upscaler_1: upscaler,
      image: imageBase64,
    }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) return imageBase64;
  const result = (await response.json()) as { image?: string };
  return result.image || imageBase64;
}

function buildAlwaysOnScripts(params: GenerationParams) {
  if (!params.adetailer_enabled) return undefined;

  const adPrompt = stripLoraTags(
    [params.adetailer_prompt, loraPrompt(params)].find((value) => value?.trim()) ?? ""
  );

  return {
    ADetailer: {
      args: [
        true,
        false,
        {
          ad_model: params.adetailer_model || "face_yolov8n.pt",
          ad_prompt: adPrompt,
          ad_negative_prompt: params.negative_prompt,
          ad_denoising_strength: params.adetailer_denoise,
        },
      ],
    },
  };
}

export async function listWebUiOptions(
  backend: GenerationParams["backend"],
  signal?: AbortSignal
) {
  const baseUrl = webUiBaseUrl(backend);
  const fetchJson = async <T>(path: string): Promise<T | null> => {
    try {
      const response = await fetch(baseUrl + path, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    }
  };

  const [upscalers, latentModes, adModels] = await Promise.all([
    fetchJson<A1111Upscaler[]>("/sdapi/v1/upscalers"),
    fetchJson<Array<{ name?: string }>>("/sdapi/v1/latent-upscale-modes"),
    fetchJson<{ ad_model?: string[] }>("/adetailer/v1/ad_model"),
  ]);

  const upscalerNames = [
    ...(upscalers ?? []).map((item) => item.name ?? "").filter(Boolean),
    ...(latentModes ?? [])
      .map((item) => item.name ?? "")
      .filter((name) => name && !/^latent$/i.test(name)),
  ];

  return {
    upscalers: Array.from(new Set(upscalerNames)),
    adetailerModels: (adModels?.ad_model ?? []).filter(
      (name) => name && name !== "None"
    ),
  };
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

async function releaseWebUiMemory(activeBaseUrl: string) {
  await Promise.all(
    [A1111_BASE_URL, FORGE_BASE_URL]
      .filter((baseUrl) => baseUrl !== activeBaseUrl)
      .map(async (baseUrl) => {
        try {
          await fetch(baseUrl + "/sdapi/v1/unload-checkpoint", {
            method: "POST",
            signal: AbortSignal.timeout(10_000),
            cache: "no-store",
          });
        } catch {
          // The alternate WebUI backend may not be running.
        }
      })
  );
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
  if (params.generation_mode === "pose_reference") {
    throw new Error("Pose Reference mode requires the ComfyUI backend.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), A1111_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const baseUrl = webUiBaseUrl(params.backend);
    const backendLabel = params.backend === "forge" ? "Forge" : "A1111";
    await Promise.all([releaseComfyUiMemory(), releaseWebUiMemory(baseUrl)]);

    const imageCount = Math.min(Math.max(Number(params.num_images) || 1, 1), 4);
    const alwaysOnScripts = buildAlwaysOnScripts(params);
    const commonPayload = {
      prompt: loraPrompt(params),
      negative_prompt: params.negative_prompt,
      seed: params.seed,
      sampler_name: a1111SamplerName(params),
      scheduler: params.scheduler === "karras" ? "Karras" : "Automatic",
      batch_size: 1,
      n_iter: imageCount,
      steps: params.num_inference_steps,
      cfg_scale: params.guidance_scale,
      override_settings: {
        sd_model_checkpoint: params.model_name,
        CLIP_stop_at_last_layers: Math.max(1, params.clip_skip),
        ...(params.vae_name ? { sd_vae: params.vae_name } : {}),
      },
      // Keep the requested checkpoint active. Restoring the previous checkpoint after
      // every request can leave WebUI tensors split between CPU and CUDA.
      override_settings_restore_afterwards: false,
      ...(alwaysOnScripts ? { alwayson_scripts: alwaysOnScripts } : {}),
      send_images: true,
      save_images: false,
    };

    let endpoint: string;
    let payload: Record<string, unknown>;

    if (params.generation_mode === "image_to_image") {
      if (!params.source_image) {
        throw new Error("Image to Image mode requires a source image.");
      }
      const resize = Math.min(Math.max(Number(params.img2img_resize) || 1, 1), 4);
      const source = await resolveSourceImage(params.source_image, controller.signal);
      const dimensions = readImageDimensions(source.buffer);
      const baseWidth = dimensions?.width ?? params.width;
      const baseHeight = dimensions?.height ?? params.height;

      // Optionally pre-upscale the init image with a real ESRGAN model so the
      // requested upscaler actually contributes detail; img2img resize alone is
      // just a latent interpolation.
      let initImage = source.base64;
      const requestedUpscaler = params.upscale_model_name.trim();
      if (resize > 1 && requestedUpscaler) {
        const upscaler = await resolveA1111Upscaler(
          baseUrl,
          requestedUpscaler,
          controller.signal
        );
        if (upscaler && upscaler !== "None") {
          initImage = await extrasUpscale(
            baseUrl,
            source.base64,
            resize,
            upscaler,
            controller.signal
          );
        }
      }

      endpoint = "/sdapi/v1/img2img";
      payload = {
        ...commonPayload,
        init_images: [initImage],
        resize_mode: 0,
        denoising_strength: params.denoise_strength,
        width: roundToMultipleOfEight(baseWidth * resize),
        height: roundToMultipleOfEight(baseHeight * resize),
      };
    } else {
      const requestedHiresScale = Number(params.hires_upscale);
      const autoHires =
        requestedHiresScale <= 1 && params.width * params.height > 2_000_000;
      const enableHr = requestedHiresScale > 1 || autoHires;
      const hiresScale = requestedHiresScale > 1 ? requestedHiresScale : 2;
      const width = autoHires ? Math.round(params.width / 2 / 8) * 8 : params.width;
      const height = autoHires ? Math.round(params.height / 2 / 8) * 8 : params.height;
      const hrUpscaler = enableHr
        ? await resolveA1111Upscaler(
            baseUrl,
            params.upscale_model_name || "ESRGAN_4x",
            controller.signal
          )
        : "None";

      endpoint = "/sdapi/v1/txt2img";
      payload = {
        ...commonPayload,
        width,
        height,
        enable_hr: enableHr,
        denoising_strength: params.denoise_strength,
        hr_scale: enableHr ? hiresScale : 1,
        hr_upscaler: hrUpscaler,
        hr_second_pass_steps: enableHr ? params.hires_steps : 0,
        // Keep the second pass on the same recipe instead of Forge's nullable/API
        // defaults (notably hr_cfg=1), which can substantially change the image.
        hr_cfg: params.guidance_scale,
        hr_sampler_name: a1111SamplerName(params),
        hr_scheduler: params.scheduler === "karras" ? "Karras" : "Automatic",
        // Forge leaves this nullable but iterates it during Hires fix.
        hr_additional_modules: [],
      };
    }

    const requestImage = () =>
      fetch(baseUrl + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });

    let response = await requestImage();
    let responseError = response.ok ? "" : await response.text();
    if (
      !response.ok &&
      /Expected all tensors to be on the same device|cpu and cuda/i.test(responseError)
    ) {
      // WebUI can retain a partially offloaded checkpoint after switching backends
      // or models. A full unload/reload repairs that state; retry only once.
      await fetch(baseUrl + "/sdapi/v1/unload-checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
        cache: "no-store",
      });
      await fetch(baseUrl + "/sdapi/v1/reload-checkpoint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
        cache: "no-store",
      });
      response = await requestImage();
      responseError = response.ok ? "" : await response.text();
    }

    if (!response.ok) {
      throw new Error(
        backendLabel + " " + response.status + ": " + (responseError || response.statusText)
      );
    }

    const result = (await response.json()) as A1111Txt2ImgResponse;
    if (!result.images?.length) {
      throw new Error(backendLabel + " completed without returning an image.");
    }

    return result.images.map(decodeBase64Image);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function interruptA1111(backend: GenerationParams["backend"] = "a1111") {
  await fetch(webUiBaseUrl(backend) + "/sdapi/v1/interrupt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
}