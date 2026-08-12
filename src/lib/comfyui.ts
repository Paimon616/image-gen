import type {
  ControlNetConfig,
  EmbeddingConfig,
  GenerationParams,
  LoraConfig,
  VideoGenerationParams,
} from "./types";
import { readFile } from "fs/promises";
import { isAbsolute, join } from "path";
import {
  ANIMA_CLIP_NAME,
  ANIMA_VAE_NAME,
  KREA2_CLIP_NAME,
  KREA2_VAE_NAME,
  PORNMASTER_CLIP_NAME,
  PORNMASTER_VAE_NAME,
  getCheckpointCapabilities,
  getMissingRequiredModelFiles,
  isAnimaCheckpointName,
  isKrea2CheckpointName,
} from "./comfyui-model-files";
import { normalizeGenerationSeed } from "./types";
import type { VideoPipelineLoraSlot } from "./video-pipelines";
import { resolveVideoPipeline, resolveVideoWorkflowPath } from "./video-pipelines";

const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
export const COMFYUI_BASE_URL =
  process.env.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_COMFYUI_URL;
const COMFYUI_TIMEOUT_MS = Number(process.env.COMFYUI_TIMEOUT_MS ?? 300_000);
// FaceDetailer samples the whole face crop (crop = bbox * this factor) at full
// resolution when force_inpaint is on. A larger factor includes more surrounding
// context so the detailed face blends in — too tight (≈1) leaves a visible seam.
// The stock Impact Pack default of 3 is safe now that output is no longer silently
// upscaled (a normal 832x1216 render has a ~260px face → ~800px crop that fits MPS).
// Memory scales ~O(crop_px²), so on Apple Silicon lower this toward 1 only when
// running ADetailer on very large (multi-MP hires) images to avoid an MPS OOM.
const COMFYUI_ADETAILER_CROP_FACTOR = Number(
  process.env.COMFYUI_ADETAILER_CROP_FACTOR ?? 3
);
const A1111_BASE_URL =
  process.env.A1111_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:7860";
const FORGE_BASE_URL =
  process.env.FORGE_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:7861";

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

type ComfyMediaRef = ComfyImageRef;

export interface ComfyQueuedPrompt {
  prompt_id: string;
  client_id: string;
}

interface ComfyHistoryOutput {
  images?: ComfyImageRef[];
  gifs?: ComfyMediaRef[];
  videos?: ComfyMediaRef[];
  audio?: ComfyMediaRef[];
  audios?: ComfyMediaRef[];
  text?: string[] | string;
  string?: string[] | string;
  strings?: string[] | string;
  result?: string[] | string;
}

interface ComfyHistoryStatus {
  status_str?: string;
  completed?: boolean;
  messages?: unknown[];
}

interface ComfyHistoryItem {
  outputs?: Record<string, ComfyHistoryOutput>;
  status?: ComfyHistoryStatus;
}

interface ComfyQueue {
  queue_running?: unknown[];
  queue_pending?: unknown[];
}

interface ComfyObjectInfo {
  input?: {
    required?: Record<string, unknown>;
  };
}

export interface ComfyGeneratedImage {
  buffer: Buffer;
  contentType: string;
  originalUrl: string;
}

export interface ComfyGeneratedMedia {
  buffer: Buffer;
  contentType: string;
  originalUrl: string;
  filename: string;
}

export interface ComfyClientOptions {
  baseUrl?: string;
}

type WorkflowControlNetConfig = ControlNetConfig & {
  preprocessor?: "openpose";
};

interface ResolvedControlNetConfig extends WorkflowControlNetConfig {
  image: string;
}

async function addUpscaleWorkflowNodes(
  workflow: Record<string, unknown>,
  params: GenerationParams,
  imageRef: [string, number],
  loaderNodeId: string,
  upscaleNodeId: string
) {
  const modelName = await resolveAvailableUpscaleModelName(
    params.upscale_model_name?.trim() ?? ""
  );

  if (!modelName) {
    return imageRef;
  }

  workflow[loaderNodeId] = {
    class_type: "UpscaleModelLoader",
    inputs: {
      model_name: modelName,
    },
  };
  workflow[upscaleNodeId] = {
    class_type: "ImageUpscaleWithModel",
    inputs: {
      upscale_model: [loaderNodeId, 0],
      image: imageRef,
    },
  };

  return [upscaleNodeId, 0] satisfies [string, number];
}

function addFaceDetailerWorkflowNode(
  workflow: Record<string, unknown>,
  params: GenerationParams,
  imageRef: [string, number],
  modelRef: [string, number],
  clipRef: [string, number],
  vaeRef: [string, number],
  positiveRef: [string, number],
  negativeRef: [string, number],
  seed: number
) {
  if (!params.adetailer_enabled) return imageRef;

  const requestedModel = params.adetailer_model.trim();
  const normalizedDetectorModel = requestedModel.startsWith("bbox/")
    ? requestedModel
    : requestedModel
      ? "bbox/" + requestedModel
      : "";
  const detectorModel = [
    "bbox/face_yolov8n_v2.pt",
    "bbox/face_yolov8m.pt",
  ].includes(normalizedDetectorModel)
    ? normalizedDetectorModel
    : "bbox/face_yolov8n_v2.pt";
  let detailModelRef = modelRef;
  let detailClipRef = clipRef;
  let detailVaeRef = vaeRef;
  let detailPositiveRef = positiveRef;
  let detailNegativeRef = negativeRef;
  const detailCheckpoint = params.adetailer_checkpoint.trim();

  if (detailCheckpoint) {
    workflow["84"] = {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: detailCheckpoint,
      },
    };
    detailModelRef = ["84", 0];
    detailClipRef = ["84", 1];
    detailVaeRef = ["84", 2];
  }

  const detailLoras = cleanLoras(params.adetailer_loras);
  detailLoras.forEach((lora, index) => {
    const nodeId = String(85 + index);
    workflow[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.path,
        strength_model: lora.scale,
        strength_clip: lora.scale,
        model: detailModelRef,
        clip: detailClipRef,
      },
    };
    detailModelRef = [nodeId, 0];
    detailClipRef = [nodeId, 1];
  });

  if (params.adetailer_prompt.trim() || detailCheckpoint || detailLoras.length > 0) {
    workflow["81"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: params.adetailer_prompt.trim() || params.prompt,
        clip: detailClipRef,
      },
    };
    detailPositiveRef = ["81", 0];
  }

  if (
    params.adetailer_negative_prompt.trim() ||
    detailCheckpoint ||
    detailLoras.length > 0
  ) {
    workflow["83"] = {
      class_type: "CLIPTextEncode",
      inputs: {
        text: params.adetailer_negative_prompt.trim() || params.negative_prompt,
        clip: detailClipRef,
      },
    };
    detailNegativeRef = ["83", 0];
  }

  workflow["80"] = {
    class_type: "UltralyticsDetectorProvider",
    inputs: {
      model_name: detectorModel,
    },
  };
  workflow["82"] = {
    class_type: "FaceDetailer",
    inputs: {
      image: imageRef,
      model: detailModelRef,
      clip: detailClipRef,
      vae: detailVaeRef,
      guide_size: 512,
      guide_size_for: true,
      max_size: 1024,
      seed,
      steps: Math.max(
        1,
        params.adetailer_use_steps
          ? params.adetailer_steps
          : params.num_inference_steps
      ),
      cfg: params.guidance_scale,
      sampler_name: params.sampler_name || "dpmpp_2m",
      scheduler: params.scheduler || "karras",
      positive: detailPositiveRef,
      negative: detailNegativeRef,
      denoise: clampDenoiseStrength(params.adetailer_denoise),
      feather: params.adetailer_mask_blur,
      noise_mask: params.adetailer_inpaint_only_masked,
      // Keep inpainting even when the face is already larger than guide_size — otherwise
      // Impact Pack skips detailing on hires images ("segment skip (enough big)"). The full
      // crop can hit ~9MP, which historically deadlocked MPS in a single attention bmm; that
      // is why ComfyUI is launched with --use-split-cross-attention on macOS (run-comfyui.sh).
      force_inpaint: true,
      bbox_threshold: params.adetailer_confidence,
      bbox_dilation: 10,
      bbox_crop_factor: Number.isFinite(COMFYUI_ADETAILER_CROP_FACTOR)
        ? COMFYUI_ADETAILER_CROP_FACTOR
        : 1,
      sam_detection_hint: "none",
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: "False",
      drop_size: 10,
      bbox_detector: ["80", 0],
      wildcard: "",
      cycle: 1,
    },
  };

  return ["82", 0] satisfies [string, number];
}
function cleanLoras(loras: LoraConfig[]) {
  return loras
    .map((lora) => ({
      path: lora.path.trim(),
      scale: Number.isFinite(lora.scale) ? lora.scale : 1,
    }))
    .filter((lora) => lora.path.length > 0)
    .filter(
      (lora, index, all) =>
        all.findIndex(
          (candidate) => candidate.path.toLowerCase() === lora.path.toLowerCase()
        ) === index
    );
}

function embeddingTokens(embeddings: EmbeddingConfig[]) {
  return embeddings
    .flatMap((embedding) =>
      embedding.tokens
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean)
    )
    .join(", ");
}

function withEmbeddingTokens(prompt: string, embeddings: EmbeddingConfig[]) {
  const tokens = embeddingTokens(embeddings);
  const cleanPrompt = prompt.replace(/<lora:[^>]+>/gi, " ").replace(/\s+/g, " ").trim();
  return tokens ? `${cleanPrompt}, ${tokens}` : cleanPrompt;
}

function generationDimension(value: number, scale: number) {
  const divisor = Number.isFinite(scale) && scale > 1 ? scale : 1;
  return Math.max(8, Math.floor(value / divisor / 8) * 8);
}

function isRemoteImageRef(image: string) {
  return /^https?:\/\//i.test(image);
}

function extensionForContentType(contentType: string | null) {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  return "jpg";
}

export async function uploadImageToComfyUI(
  imageUrl: string,
  options?: ComfyClientOptions
) {
  const imageRes = await fetch(imageUrl);

  if (!imageRes.ok) {
    throw new Error(`Failed to fetch reference image: ${imageRes.status}`);
  }

  const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
  const blob = new Blob([await imageRes.arrayBuffer()], { type: contentType });
  const filename = `image-gen-ref-${crypto.randomUUID()}.${extensionForContentType(
    contentType
  )}`;
  const formData = new FormData();

  formData.append("image", blob, filename);
  formData.append("type", "input");
  formData.append("overwrite", "true");

  // Upload to the SAME ComfyUI that will run the prompt (local or the RunPod
  // pod). Uploading to the wrong instance makes LoadImage fail validation with
  // "Invalid image file" because the target ComfyUI never received the file.
  const uploadRes = await comfyFetch(
    "/upload/image",
    {
      method: "POST",
      body: formData,
    },
    options
  );
  const uploaded = (await uploadRes.json()) as { name?: string };

  return uploaded.name ?? filename;
}

async function resolveControlNetImage(image: string, options?: ComfyClientOptions) {
  if (!isRemoteImageRef(image)) return image;
  return uploadImageToComfyUI(image, options);
}

function clampDenoiseStrength(value: unknown) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0.45;
  }

  return Math.min(Math.max(numericValue, 0.05), 1);
}

async function cleanControlnets(params: GenerationParams) {
  const controlnets: WorkflowControlNetConfig[] = [];

  if (params.generation_mode === "pose_reference" && params.pose_reference_image) {
    controlnets.push({
      model: params.pose_reference_model,
      image: params.pose_reference_image,
      strength: params.pose_reference_strength,
      start_percent: 0,
      end_percent: 1,
      preprocessor: "openpose",
    });
  }

  controlnets.push(...(params.controlnets ?? []));

  const resolved = await Promise.all(
    controlnets
      .map((controlnet) => ({
        model: controlnet.model.trim(),
        image: controlnet.image?.trim() ?? "",
        strength: Number.isFinite(controlnet.strength)
          ? controlnet.strength
          : 0.8,
        start_percent: Number.isFinite(controlnet.start_percent)
          ? controlnet.start_percent
          : 0,
        end_percent: Number.isFinite(controlnet.end_percent)
          ? controlnet.end_percent
          : 1,
        preprocessor: controlnet.preprocessor,
      }))
      .filter((controlnet) => controlnet.model && controlnet.image)
      .map(async (controlnet) => ({
        ...controlnet,
        image: await resolveControlNetImage(controlnet.image),
      }))
  );

  return resolved satisfies ResolvedControlNetConfig[];
}

async function assertAnimaSupportFiles(checkpoint: string) {
  const missing = await getMissingRequiredModelFiles(checkpoint);

  if (missing.length > 0) {
    throw new Error(
      `Anima generation requires these additional files: ${missing.join(", ")}`
    );
  }
}

async function buildAnimaWorkflow(params: GenerationParams, checkpoint: string) {
  await assertAnimaSupportFiles(checkpoint);

  const loras = cleanLoras(params.loras);
  const controlnets = await cleanControlnets(params);
  const seed = normalizeGenerationSeed(params.seed);
  const samplerName =
    !params.sampler_name || params.sampler_name === "dpmpp_2m"
      ? "er_sde"
      : params.sampler_name;
  const scheduler =
    !params.scheduler || params.scheduler === "karras" ? "simple" : params.scheduler;
  const cfg = params.guidance_scale === 7.5 ? 4 : params.guidance_scale;
  const workflow: Record<string, unknown> = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: checkpoint,
      },
    },
    "8": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: ANIMA_CLIP_NAME,
        type: "stable_diffusion",
        device: "default",
      },
    },
    "9": {
      class_type: "VAELoader",
      inputs: {
        vae_name: ANIMA_VAE_NAME,
      },
    },
  };

  let modelRef: [string, number] = ["1", 0];
  let clipRef: [string, number] = ["8", 0];
  const vaeRef: [string, number] = ["9", 0];

  loras.forEach((lora, index) => {
    const nodeId = String(10 + index);
    workflow[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.path,
        strength_model: lora.scale,
        strength_clip: lora.scale,
        model: modelRef,
        clip: clipRef,
      },
    };
    modelRef = [nodeId, 0];
    clipRef = [nodeId, 1];
  });

  workflow["2"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: withEmbeddingTokens(params.prompt, params.embeddings),
      clip: clipRef,
    },
  };
  workflow["3"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: withEmbeddingTokens(params.negative_prompt, []),
      clip: clipRef,
    },
  };

  let latentRef: [string, number] = ["4", 0];
  let denoise = 1;

  if (params.generation_mode === "image_to_image" && params.source_image) {
    const sourceImage = await resolveControlNetImage(params.source_image);

    workflow["4"] = {
      class_type: "LoadImage",
      inputs: {
        image: sourceImage,
      },
    };
    workflow["22"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["4", 0],
        upscale_method: "lanczos",
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        crop: "center",
      },
    };
    workflow["23"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["22", 0],
        vae: vaeRef,
      },
    };
    latentRef = ["23", 0];
    denoise = clampDenoiseStrength(params.denoise_strength);
  } else {
    workflow["4"] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        batch_size: Math.min(Math.max(Number(params.num_images) || 1, 1), 4),
      },
    };
  }

  let positiveRef: [string, number] = ["2", 0];
  let negativeRef: [string, number] = ["3", 0];

  controlnets.forEach((controlnet, index) => {
    const imageNodeId = String(30 + index * 4);
    const preprocessorNodeId = String(31 + index * 4);
    const loaderNodeId = String(32 + index * 4);
    const applyNodeId = String(33 + index * 4);

    workflow[imageNodeId] = {
      class_type: "LoadImage",
      inputs: {
        image: controlnet.image,
      },
    };

    const controlImageRef: [string, number] =
      controlnet.preprocessor === "openpose"
        ? [preprocessorNodeId, 0]
        : [imageNodeId, 0];

    if (controlnet.preprocessor === "openpose") {
      workflow[preprocessorNodeId] = {
        class_type: "OpenposePreprocessor",
        inputs: {
          image: [imageNodeId, 0],
          detect_hand: "enable",
          detect_body: "enable",
          detect_face: "disable",
          resolution: Math.min(Math.max(Math.max(params.width, params.height), 512), 1024),
          scale_stick_for_xinsr_cn: "disable",
        },
      };
    }

    workflow[loaderNodeId] = {
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: controlnet.model,
      },
    };
    workflow[applyNodeId] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        strength: controlnet.strength,
        start_percent: controlnet.start_percent,
        end_percent: controlnet.end_percent,
        positive: positiveRef,
        negative: negativeRef,
        control_net: [loaderNodeId, 0],
        image: controlImageRef,
      },
    };

    positiveRef = [applyNodeId, 0];
    negativeRef = [applyNodeId, 1];
  });

  workflow["5"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps: params.num_inference_steps,
      cfg,
      sampler_name: samplerName,
      scheduler,
      denoise,
      model: modelRef,
      positive: positiveRef,
      negative: negativeRef,
      latent_image: latentRef,
    },
  };
  workflow["6"] = {
    class_type: "VAEDecode",
    inputs: {
      samples: ["5", 0],
      vae: vaeRef,
    },
  };
  const hiresScale = Number(params.hires_upscale);
  const useHiresFix = Number.isFinite(hiresScale) && hiresScale > 1;
  let saveImageRef: [string, number];

  if (useHiresFix) {
    const upscaledRef = await addUpscaleWorkflowNodes(workflow, params, ["6", 0], "70", "71");
    workflow["72"] = {
      class_type: "ImageScale",
      inputs: {
        image: upscaledRef,
        upscale_method: "lanczos",
        width: params.width,
        height: params.height,
        crop: "disabled",
      },
    };
    workflow["73"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["72", 0], vae: vaeRef },
    };
    workflow["74"] = {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: params.hires_steps > 0 ? params.hires_steps : params.num_inference_steps,
        cfg: params.guidance_scale,
        sampler_name: params.sampler_name || "dpmpp_2m",
        scheduler: params.scheduler || "karras",
        denoise: clampDenoiseStrength(params.hires_denoise),
        model: modelRef,
        positive: positiveRef,
        negative: negativeRef,
        latent_image: ["73", 0],
      },
    };
    workflow["75"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["74", 0], vae: vaeRef },
    };
    saveImageRef = ["75", 0];
  } else {
    // Hires is off: the upscale model belongs to the Hires-fix pass (it enlarges the
    // first pass, then ImageScale brings it back to the requested final size). Running
    // it here would apply the model's native factor (e.g. Remacri 4x) with no downscale,
    // inflating output well past the requested width/height. Keep the base decode.
    saveImageRef = ["6", 0];
  }
  saveImageRef = addFaceDetailerWorkflowNode(workflow, params, saveImageRef, modelRef, clipRef, vaeRef, positiveRef, negativeRef, seed);
  workflow["7"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "image-gen-anima",
      images: saveImageRef,
    },
  };

  return workflow;
}

async function assertKrea2SupportFiles(
  checkpoint: string,
  krea2Workflow: "generic" | "refined" | "pornmaster" = "generic",
  options?: ComfyClientOptions
) {
  // Support files live on whichever ComfyUI runs the job. When building for a
  // remote pod (options.baseUrl set), the files are on the pod — presence is
  // verified separately by checkRunpodGenerationFiles — so a local-only gap must
  // not block the build. Only check the local filesystem for local generation.
  if (options?.baseUrl) return;

  const missing = await getMissingRequiredModelFiles(checkpoint, krea2Workflow);

  if (missing.length > 0) {
    throw new Error(
      `Krea 2 generation requires these additional files: ${missing.join(", ")}`
    );
  }
}

async function buildKrea2Workflow(
  params: GenerationParams,
  checkpoint: string,
  options?: ComfyClientOptions
) {
  await assertKrea2SupportFiles(checkpoint, "generic", options);

  const loras = cleanLoras(params.loras);
  const vaeName = (await resolveAvailableVaeName(params.vae_name)) || KREA2_VAE_NAME;
  const seed = normalizeGenerationSeed(params.seed);
  const samplerName =
    !params.sampler_name || params.sampler_name === "dpmpp_2m"
      ? "euler"
      : params.sampler_name;
  const scheduler =
    !params.scheduler || params.scheduler === "karras" ? "simple" : params.scheduler;
  // Krea 2 Turbo is distilled and runs at cfg 1 with a zeroed-out negative.
  const cfg = params.guidance_scale === 7.5 ? 1 : params.guidance_scale;
  const workflow: Record<string, unknown> = {
    "1": {
      class_type: "UNETLoader",
      inputs: {
        unet_name: checkpoint,
        weight_dtype: "default",
      },
    },
    "8": {
      class_type: "CLIPLoader",
      inputs: {
        clip_name: KREA2_CLIP_NAME,
        type: "krea2",
        device: "default",
      },
    },
    "9": {
      class_type: "VAELoader",
      inputs: {
        vae_name: vaeName,
      },
    },
  };

  let modelRef: [string, number] = ["1", 0];
  const clipRef: [string, number] = ["8", 0];
  const vaeRef: [string, number] = ["9", 0];

  // Krea 2 LoRAs are diffusion-model-only (no CLIP side).
  loras.forEach((lora, index) => {
    const nodeId = String(10 + index);
    workflow[nodeId] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: lora.path,
        strength_model: lora.scale,
        model: modelRef,
      },
    };
    modelRef = [nodeId, 0];
  });

  workflow["2"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: withEmbeddingTokens(params.prompt, params.embeddings),
      clip: clipRef,
    },
  };
  workflow["3"] = {
    class_type: "ConditioningZeroOut",
    inputs: {
      conditioning: ["2", 0],
    },
  };

  let latentRef: [string, number] = ["4", 0];
  let denoise = 1;

  if (params.generation_mode === "image_to_image" && params.source_image) {
    const sourceImage = await resolveControlNetImage(params.source_image);

    workflow["4"] = {
      class_type: "LoadImage",
      inputs: {
        image: sourceImage,
      },
    };
    workflow["22"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["4", 0],
        upscale_method: "lanczos",
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        crop: "center",
      },
    };
    workflow["23"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["22", 0],
        vae: vaeRef,
      },
    };
    latentRef = ["23", 0];
    denoise = clampDenoiseStrength(params.denoise_strength);
  } else {
    workflow["4"] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        batch_size: Math.min(Math.max(Number(params.num_images) || 1, 1), 4),
      },
    };
  }

  workflow["5"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps: params.num_inference_steps,
      cfg,
      sampler_name: samplerName,
      scheduler,
      denoise,
      model: modelRef,
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: latentRef,
    },
  };

  // "refined" variant: a low-denoise second pass on the base latent. Krea 2 Turbo is
  // distilled and a single short euler/simple pass tends to leave residual grain. The
  // key to actually removing that grain (rather than just re-rolling it) is switching
  // the refine pass to a higher-order multistep solver — dpmpp_2m + karras — which is
  // the stock-node stand-in for the PornMaster recipe's res_4s/kl_optimal refinement.
  // Same-solver refining (euler again) barely moves the noise, so we intentionally use
  // a different, smoother sampler here. Stock nodes only — no RES4LYF on the pod.
  let sampledLatentRef: [string, number] = ["5", 0];
  if (params.krea2_workflow === "refined") {
    workflow["50"] = {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: Math.max(6, Math.round(Number(params.num_inference_steps) || 8)),
        cfg,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: 0.35,
        model: modelRef,
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["5", 0],
      },
    };
    sampledLatentRef = ["50", 0];
  }

  workflow["6"] = {
    class_type: "VAEDecode",
    inputs: {
      samples: sampledLatentRef,
      vae: vaeRef,
    },
  };
  const hiresScale = Number(params.hires_upscale);
  const useHiresFix = Number.isFinite(hiresScale) && hiresScale > 1;
  let saveImageRef: [string, number];

  if (useHiresFix) {
    const upscaledRef = await addUpscaleWorkflowNodes(workflow, params, ["6", 0], "70", "71");
    workflow["72"] = {
      class_type: "ImageScale",
      inputs: {
        image: upscaledRef,
        upscale_method: "lanczos",
        width: params.width,
        height: params.height,
        crop: "disabled",
      },
    };
    workflow["73"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["72", 0], vae: vaeRef },
    };
    workflow["74"] = {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: params.hires_steps > 0 ? params.hires_steps : params.num_inference_steps,
        cfg: params.guidance_scale,
        sampler_name: params.sampler_name || "dpmpp_2m",
        scheduler: params.scheduler || "karras",
        denoise: clampDenoiseStrength(params.hires_denoise),
        model: modelRef,
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["73", 0],
      },
    };
    workflow["75"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["74", 0], vae: vaeRef },
    };
    saveImageRef = ["75", 0];
  } else {
    // Hires is off: the upscale model belongs to the Hires-fix pass (it enlarges the
    // first pass, then ImageScale brings it back to the requested final size). Running
    // it here would apply the model's native factor (e.g. Remacri 4x) with no downscale,
    // inflating output well past the requested width/height. Keep the base decode.
    saveImageRef = ["6", 0];
  }
  saveImageRef = addFaceDetailerWorkflowNode(workflow, params, saveImageRef, modelRef, clipRef, vaeRef, ["2", 0], ["3", 0], seed);
  workflow["7"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "image-gen-krea2",
      images: saveImageRef,
    },
  };

  return workflow;
}

// --- Krea 2 "PornMaster" RES4LYF workflow -----------------------------------
// A faithful reproduction of the PornMaster Krea2 Turbo T2I workflow, which
// samples in two ClownsharKSampler_Beta stages (a base pass + a low-denoise
// refinement) from the RES4LYF custom node pack. Because that node's widget set
// varies by version, we introspect the live /object_info schema and populate
// inputs by name, snapping combo values to valid options and filling any
// remaining required widget from its schema default so /prompt always validates.

async function getComfyObjectInfoEntry(
  classType: string,
  options?: ComfyClientOptions
): Promise<ComfyObjectInfo | null> {
  try {
    const res = await comfyFetch(
      "/object_info/" + encodeURIComponent(classType),
      undefined,
      options
    );
    const data = (await res.json()) as Record<string, ComfyObjectInfo>;
    return data[classType] ?? null;
  } catch {
    return null;
  }
}

function comfyInputComboOptions(spec: unknown): string[] {
  if (!Array.isArray(spec)) return [];

  // Older ComfyUI: [[...options], config?]. Newer: ["COMBO", { options: [...] }].
  if (Array.isArray(spec[0])) {
    return spec[0].filter((item: unknown): item is string => typeof item === "string");
  }

  const config = spec[1];
  if (
    spec[0] === "COMBO" &&
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    "options" in config &&
    Array.isArray((config as { options: unknown[] }).options)
  ) {
    return (config as { options: unknown[] }).options.filter(
      (item: unknown): item is string => typeof item === "string"
    );
  }

  return [];
}

function comfyInputDefault(spec: unknown): unknown {
  if (!Array.isArray(spec)) return undefined;

  const type = spec[0];
  const config = spec[1];
  if (config && typeof config === "object" && !Array.isArray(config) && "default" in config) {
    return (config as { default: unknown }).default;
  }

  const combo = comfyInputComboOptions(spec);
  if (combo.length) return combo[0];
  if (type === "INT" || type === "FLOAT") return 0;
  if (type === "BOOLEAN") return false;
  if (type === "STRING") return "";
  return undefined;
}

function pickComfyCombo(spec: unknown, desired: string): string {
  const options = comfyInputComboOptions(spec);
  if (options.includes(desired)) return desired;
  const fallback = comfyInputDefault(spec);
  if (typeof fallback === "string" && options.includes(fallback)) return fallback;
  return options[0] ?? desired;
}

function buildClownsharkNode(
  specs: Record<string, unknown>,
  required: Record<string, unknown>,
  wiring: Record<string, [string, number]>,
  overrides: Record<string, unknown>
) {
  const inputs: Record<string, unknown> = { ...wiring };

  for (const [name, value] of Object.entries(overrides)) {
    if (!(name in specs) || name in wiring) continue;
    inputs[name] =
      typeof value === "string" && comfyInputComboOptions(specs[name]).length
        ? pickComfyCombo(specs[name], value)
        : value;
  }

  // Every required widget must be present for /prompt to validate.
  for (const [name, spec] of Object.entries(required)) {
    if (name in inputs) continue;
    const fallback = comfyInputDefault(spec);
    if (fallback !== undefined) inputs[name] = fallback;
  }

  return { class_type: "ClownsharKSampler_Beta", inputs };
}

async function buildKrea2PornmasterWorkflow(
  params: GenerationParams,
  checkpoint: string,
  options?: ComfyClientOptions
) {
  await assertKrea2SupportFiles(checkpoint, "pornmaster", options);

  const clownInfo = await getComfyObjectInfoEntry("ClownsharKSampler_Beta", options);
  const required = clownInfo?.input?.required as Record<string, unknown> | undefined;
  if (!required) {
    throw new Error(
      "커스텀 Krea PornMaster 워크플로우에는 RES4LYF 커스텀 노드(ClownsharKSampler_Beta)가 필요합니다. " +
        "ComfyUI Manager에서 'RES4LYF'를 설치한 뒤 다시 시도하거나, 생성 백엔드에서 'Krea 워크플로우 → 범용'을 선택하세요. " +
        "(The custom Krea PornMaster workflow requires the RES4LYF nodes — install 'RES4LYF' via ComfyUI Manager, or switch the Krea workflow to Generic.)"
    );
  }
  const optional =
    (clownInfo?.input as { optional?: Record<string, unknown> } | undefined)?.optional ?? {};
  const specs: Record<string, unknown> = { ...optional, ...required };

  const loras = cleanLoras(params.loras);
  // Faithful to the original: the abliterated int8 Qwen3-VL text encoder and the
  // Wan 2.1 VAE. The VAE stays overridable from the UI VAE picker.
  const vaeName = (await resolveAvailableVaeName(params.vae_name)) || PORNMASTER_VAE_NAME;
  const seed = normalizeGenerationSeed(params.seed);

  const workflow: Record<string, unknown> = {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: checkpoint, weight_dtype: "default" },
    },
    "8": {
      class_type: "CLIPLoader",
      inputs: { clip_name: PORNMASTER_CLIP_NAME, type: "krea2", device: "default" },
    },
    "9": {
      class_type: "VAELoader",
      inputs: { vae_name: vaeName },
    },
  };

  let modelRef: [string, number] = ["1", 0];
  const clipRef: [string, number] = ["8", 0];
  const vaeRef: [string, number] = ["9", 0];

  // Krea 2 LoRAs are diffusion-model-only (no CLIP side).
  loras.forEach((lora, index) => {
    const nodeId = String(10 + index);
    workflow[nodeId] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: lora.path,
        strength_model: lora.scale,
        model: modelRef,
      },
    };
    modelRef = [nodeId, 0];
  });

  workflow["2"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: withEmbeddingTokens(params.prompt, params.embeddings),
      clip: clipRef,
    },
  };
  // Turbo default: the negative is a zeroed-out copy of the positive conditioning
  // (the distilled model runs at cfg 1, so an authored negative prompt is inert).
  workflow["3"] = {
    class_type: "ConditioningZeroOut",
    inputs: { conditioning: ["2", 0] },
  };

  let latentRef: [string, number] = ["4", 0];
  let baseDenoise = 1;

  if (params.generation_mode === "image_to_image" && params.source_image) {
    const sourceImage = await resolveControlNetImage(params.source_image, options);
    workflow["4"] = {
      class_type: "LoadImage",
      inputs: { image: sourceImage },
    };
    workflow["22"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["4", 0],
        upscale_method: "lanczos",
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        crop: "center",
      },
    };
    workflow["23"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["22", 0], vae: vaeRef },
    };
    latentRef = ["23", 0];
    baseDenoise = clampDenoiseStrength(params.denoise_strength);
  } else {
    workflow["4"] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        batch_size: Math.min(Math.max(Number(params.num_images) || 1, 1), 4),
      },
    };
  }

  const baseSteps = Math.max(1, Math.round(Number(params.num_inference_steps) || 6));

  // Stage 1 — base pass (euler / beta).
  workflow["5"] = buildClownsharkNode(
    specs,
    required,
    { model: modelRef, positive: ["2", 0], negative: ["3", 0], latent_image: latentRef },
    {
      seed,
      steps: baseSteps,
      cfg: 1,
      sampler_name: "linear/euler",
      scheduler: "beta",
      denoise: baseDenoise,
      eta: 0.5,
    }
  );
  // Stage 2 — low-denoise refinement (res_4s munthe-kaas / kl_optimal).
  workflow["6"] = buildClownsharkNode(
    specs,
    required,
    { model: modelRef, positive: ["2", 0], negative: ["3", 0], latent_image: ["5", 0] },
    {
      seed,
      steps: 2,
      cfg: 1,
      sampler_name: "exponential/res_4s_munthe-kaas",
      scheduler: "kl_optimal",
      denoise: 0.25,
      eta: 0.5,
    }
  );

  workflow["7"] = {
    class_type: "VAEDecode",
    inputs: { samples: ["6", 0], vae: vaeRef },
  };

  let saveImageRef: [string, number] = ["7", 0];
  saveImageRef = addFaceDetailerWorkflowNode(
    workflow,
    params,
    saveImageRef,
    modelRef,
    clipRef,
    vaeRef,
    ["2", 0],
    ["3", 0],
    seed
  );

  workflow["27"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "image-gen-krea2-pornmaster",
      images: saveImageRef,
    },
  };

  return workflow;
}

async function buildDefaultWorkflow(params: GenerationParams, options?: ComfyClientOptions) {
  const checkpoint = params.model_name.trim() || "sd_xl_base_1.0.safetensors";

  if (isKrea2CheckpointName(checkpoint)) {
    return params.krea2_workflow === "pornmaster"
      ? buildKrea2PornmasterWorkflow(params, checkpoint, options)
      : buildKrea2Workflow(params, checkpoint, options);
  }

  const checkpointCapabilities = await getCheckpointCapabilities(checkpoint);

  if (checkpointCapabilities?.clip === false) {
    if (isAnimaCheckpointName(checkpoint)) {
      return buildAnimaWorkflow(params, checkpoint);
    }

    throw new Error(
      `${checkpoint} is a diffusion-only model without a bundled CLIP text encoder. ` +
        "Use an SD/SDXL checkpoint in this generator, or move this file to ComfyUI/models/diffusion_models and run it with its matching ComfyUI blueprint."
    );
  }

  const vaeName = await resolveAvailableVaeName(params.vae_name);

  if (checkpointCapabilities?.vae === false && !vaeName) {
    throw new Error(
      `${checkpoint} does not include a bundled VAE. Select an installed VAE before generating.`
    );
  }

  const loras = cleanLoras(params.loras);
  const controlnets = await cleanControlnets(params);
  const seed = normalizeGenerationSeed(params.seed);
  const workflow: Record<string, unknown> = {
    "1": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: checkpoint,
      },
    },
  };

  let modelRef: [string, number] = ["1", 0];
  let clipRef: [string, number] = ["1", 1];
  let vaeRef: [string, number] = ["1", 2];

  loras.forEach((lora, index) => {
    const nodeId = String(10 + index);
    workflow[nodeId] = {
      class_type: "LoraLoader",
      inputs: {
        lora_name: lora.path,
        strength_model: lora.scale,
        strength_clip: lora.scale,
        model: modelRef,
        clip: clipRef,
      },
    };
    modelRef = [nodeId, 0];
    clipRef = [nodeId, 1];
  });

  if (params.clip_skip > 1) {
    workflow["20"] = {
      class_type: "CLIPSetLastLayer",
      inputs: {
        stop_at_clip_layer: -Math.max(Math.min(params.clip_skip, 12), 1),
        clip: clipRef,
      },
    };
    clipRef = ["20", 0];
  }

  if (vaeName) {
    workflow["21"] = {
      class_type: "VAELoader",
      inputs: {
        vae_name: vaeName,
      },
    };
    vaeRef = ["21", 0];
  }

  workflow["2"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: withEmbeddingTokens(params.prompt, params.embeddings),
      clip: clipRef,
    },
  };
  workflow["3"] = {
    class_type: "CLIPTextEncode",
    inputs: {
      text: withEmbeddingTokens(params.negative_prompt, []),
      clip: clipRef,
    },
  };
  let latentRef: [string, number] = ["4", 0];
  let denoise = 1;

  if (params.generation_mode === "image_to_image" && params.source_image) {
    const sourceImage = await resolveControlNetImage(params.source_image);

    workflow["4"] = {
      class_type: "LoadImage",
      inputs: {
        image: sourceImage,
      },
    };
    workflow["22"] = {
      class_type: "ImageScale",
      inputs: {
        image: ["4", 0],
        upscale_method: "lanczos",
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        crop: "center",
      },
    };
    workflow["23"] = {
      class_type: "VAEEncode",
      inputs: {
        pixels: ["22", 0],
        vae: vaeRef,
      },
    };
    latentRef = ["23", 0];
    denoise = clampDenoiseStrength(params.denoise_strength);
  } else {
    workflow["4"] = {
      class_type: "EmptyLatentImage",
      inputs: {
        width: generationDimension(params.width, Number(params.hires_upscale)),
        height: generationDimension(params.height, Number(params.hires_upscale)),
        batch_size: Math.min(Math.max(Number(params.num_images) || 1, 1), 4),
      },
    };
  }

  let positiveRef: [string, number] = ["2", 0];
  let negativeRef: [string, number] = ["3", 0];

  controlnets.forEach((controlnet, index) => {
    const imageNodeId = String(30 + index * 4);
    const preprocessorNodeId = String(31 + index * 4);
    const loaderNodeId = String(32 + index * 4);
    const applyNodeId = String(33 + index * 4);

    workflow[imageNodeId] = {
      class_type: "LoadImage",
      inputs: {
        image: controlnet.image,
      },
    };

    const controlImageRef: [string, number] =
      controlnet.preprocessor === "openpose"
        ? [preprocessorNodeId, 0]
        : [imageNodeId, 0];

    if (controlnet.preprocessor === "openpose") {
      workflow[preprocessorNodeId] = {
        class_type: "OpenposePreprocessor",
        inputs: {
          image: [imageNodeId, 0],
          detect_hand: "enable",
          detect_body: "enable",
          detect_face: "disable",
          resolution: Math.min(Math.max(Math.max(params.width, params.height), 512), 1024),
          scale_stick_for_xinsr_cn: "disable",
        },
      };
    }

    workflow[loaderNodeId] = {
      class_type: "ControlNetLoader",
      inputs: {
        control_net_name: controlnet.model,
      },
    };
    workflow[applyNodeId] = {
      class_type: "ControlNetApplyAdvanced",
      inputs: {
        strength: controlnet.strength,
        start_percent: controlnet.start_percent,
        end_percent: controlnet.end_percent,
        positive: positiveRef,
        negative: negativeRef,
        control_net: [loaderNodeId, 0],
        image: controlImageRef,
      },
    };

    positiveRef = [applyNodeId, 0];
    negativeRef = [applyNodeId, 1];
  });

  workflow["5"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps: params.num_inference_steps,
      cfg: params.guidance_scale,
      sampler_name: params.sampler_name || "dpmpp_2m",
      scheduler: params.scheduler || "karras",
      denoise,
      model: modelRef,
      positive: positiveRef,
      negative: negativeRef,
      latent_image: latentRef,
    },
  };
  workflow["6"] = {
    class_type: "VAEDecode",
    inputs: {
      samples: ["5", 0],
      vae: vaeRef,
    },
  };
  const hiresScale = Number(params.hires_upscale);
  const useHiresFix = Number.isFinite(hiresScale) && hiresScale > 1;
  let saveImageRef: [string, number];

  if (useHiresFix) {
    const upscaledRef = await addUpscaleWorkflowNodes(workflow, params, ["6", 0], "70", "71");
    workflow["72"] = {
      class_type: "ImageScale",
      inputs: {
        image: upscaledRef,
        upscale_method: "lanczos",
        width: params.width,
        height: params.height,
        crop: "disabled",
      },
    };
    workflow["73"] = {
      class_type: "VAEEncode",
      inputs: { pixels: ["72", 0], vae: vaeRef },
    };
    workflow["74"] = {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: params.hires_steps > 0 ? params.hires_steps : params.num_inference_steps,
        cfg: params.guidance_scale,
        sampler_name: params.sampler_name || "dpmpp_2m",
        scheduler: params.scheduler || "karras",
        denoise: clampDenoiseStrength(params.hires_denoise),
        model: modelRef,
        positive: positiveRef,
        negative: negativeRef,
        latent_image: ["73", 0],
      },
    };
    workflow["75"] = {
      class_type: "VAEDecode",
      inputs: { samples: ["74", 0], vae: vaeRef },
    };
    saveImageRef = ["75", 0];
  } else {
    // Hires is off: the upscale model belongs to the Hires-fix pass (it enlarges the
    // first pass, then ImageScale brings it back to the requested final size). Running
    // it here would apply the model's native factor (e.g. Remacri 4x) with no downscale,
    // inflating output well past the requested width/height. Keep the base decode.
    saveImageRef = ["6", 0];
  }
  saveImageRef = addFaceDetailerWorkflowNode(workflow, params, saveImageRef, modelRef, clipRef, vaeRef, positiveRef, negativeRef, seed);
  workflow["7"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "image-gen",
      images: saveImageRef,
    },
  };

  return workflow;
}

function comfyBaseUrl(options?: ComfyClientOptions) {
  return options?.baseUrl?.replace(/\/$/, "") || COMFYUI_BASE_URL;
}

async function comfyFetch(path: string, init?: RequestInit, options?: ComfyClientOptions) {
  const res = await fetch(`${comfyBaseUrl(options)}${path}`, init);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI ${res.status}: ${text || res.statusText}`);
  }

  return res;
}

export async function queueComfyWorkflow(
  prompt: Record<string, unknown>,
  clientId = crypto.randomUUID(),
  options?: ComfyClientOptions
) {
  const res = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      prompt,
    }),
  }, options);

  const queued = (await res.json()) as Omit<ComfyQueuedPrompt, "client_id">;
  return { ...queued, client_id: clientId };
}

async function releaseWebUiMemory() {
  await Promise.all(
    [A1111_BASE_URL, FORGE_BASE_URL].map(async (baseUrl) => {
      try {
        await fetch(baseUrl + "/sdapi/v1/unload-checkpoint", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
          cache: "no-store",
        });
      } catch {
        // WebUI backends are optional when ComfyUI is selected.
      }
    })
  );
}

export async function queueComfyPrompt(
  params: GenerationParams,
  clientId = crypto.randomUUID(),
  options?: ComfyClientOptions
) {
  const hiresScale = Number(params.hires_upscale);
  const baseWidth = generationDimension(params.width, hiresScale);
  const baseHeight = generationDimension(params.height, hiresScale);
  const basePixels = baseWidth * baseHeight;
  const finalPixels = params.width * params.height;
  // Permit high-resolution single-pass recipes imported explicitly from ComfyUI,
  // while retaining the final-pixel guard that blocks runaway 4K/8K jobs.
  if (basePixels > 4_200_000 || finalPixels > 4_200_000) {
    throw new Error(
      `ComfyUI resolution is too large for this GPU: ${params.width}x${params.height}` +
        (hiresScale > 1 ? `, Hires ${hiresScale}x` : "") +
        ". Reduce the base size or disable Hires fix."
    );
  }
  await releaseWebUiMemory();
  const prompt = await buildDefaultWorkflow(params, options);
  const queued = await queueComfyWorkflow(prompt, clientId, options);
  // Surface the exact API-format graph we submitted so callers can persist it
  // alongside the image (shown in the detail modal's ComfyUI workflow panel).
  return { ...queued, workflow: prompt };
}

async function getHistory(promptId: string, options?: ComfyClientOptions) {
  const res = await comfyFetch(`/history/${encodeURIComponent(promptId)}`, undefined, options);
  return (await res.json()) as Record<string, ComfyHistoryItem>;
}

async function getQueue(options?: ComfyClientOptions) {
  const res = await comfyFetch("/queue", undefined, options);
  return (await res.json()) as ComfyQueue;
}

async function getComfyObjectInputOptions(
  classType: string,
  inputName: string
): Promise<string[]> {
  const res = await comfyFetch(
    "/object_info/" + encodeURIComponent(classType)
  );
  const data = (await res.json()) as Record<string, ComfyObjectInfo>;
  const input = data[classType]?.input?.required?.[inputName];

  if (!Array.isArray(input)) {
    return [];
  }

  // Older ComfyUI versions expose combo choices as [[...options]].
  if (Array.isArray(input[0])) {
    return input[0].filter((item: unknown): item is string => typeof item === "string");
  }

  // Newer versions expose them as ["COMBO", { options: [...] }].
  const config = input[1];
  if (
    input[0] === "COMBO" &&
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    "options" in config &&
    Array.isArray(config.options)
  ) {
    return config.options.filter(
      (item: unknown): item is string => typeof item === "string"
    );
  }

  return [];
}

async function resolveAvailableVaeName(vaeName: string) {
  const trimmed = vaeName.trim();

  if (!trimmed) {
    return "";
  }

  try {
    const vaeNames = await getComfyObjectInputOptions("VAELoader", "vae_name");
    return vaeNames.includes(trimmed) ? trimmed : "";
  } catch {
    return trimmed;
  }
}

function promptIdFromQueueItem(item: unknown) {
  if (Array.isArray(item)) {
    return typeof item[1] === "string" ? item[1] : "";
  }

  if (item && typeof item === "object" && "prompt_id" in item) {
    const promptId = (item as { prompt_id?: unknown }).prompt_id;
    return typeof promptId === "string" ? promptId : "";
  }

  return "";
}

async function resolveAvailableUpscaleModelName(modelName: string) {
  const trimmed = modelName.trim();
  if (!trimmed) return "";

  try {
    const names = await getComfyObjectInputOptions("UpscaleModelLoader", "model_name");
    if (names.includes(trimmed)) return trimmed;
    const normalize = (value: string) =>
      value
        .replace(/\.(pth|pt|safetensors|ckpt)$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "");
    const normalized = normalize(trimmed);
    return names.find((name) => normalize(name) === normalized) ?? "";
  } catch {
    return trimmed;
  }
}
async function isPromptActive(promptId: string, options?: ComfyClientOptions) {
  const queue = await getQueue(options);
  const queuedItems = [
    ...(queue.queue_running ?? []),
    ...(queue.queue_pending ?? []),
  ];

  return queuedItems.some((item) => promptIdFromQueueItem(item) === promptId);
}

function imageRefsFromHistory(history: ComfyHistoryItem | undefined) {
  return Object.values(history?.outputs ?? {}).flatMap((output) => output.images ?? []);
}

function isVideoMediaRef(ref: ComfyMediaRef) {
  return /\.(mp4|webm|gif)$/i.test(ref.filename);
}

function isAudioMediaRef(ref: ComfyMediaRef) {
  return /\.(wav|mp3|flac|m4a|aac|ogg|opus)$/i.test(ref.filename);
}

function videoRefsFromHistory(history: ComfyHistoryItem | undefined) {
  const all = Object.values(history?.outputs ?? {}).flatMap((output) => [
    ...(output.videos ?? []),
    ...(output.gifs ?? []),
    ...(output.images ?? []).filter(isVideoMediaRef),
  ]);
  // Some workflows emit intermediate previews alongside the final render — e.g.
  // the 10Eros triple-pass has a VHS_VideoCombine with save_output=false that
  // writes a first-pass clip to the temp dir. ComfyUI tags those with
  // type "temp", so keeping only saved "output" media stops one run from
  // producing two videos. Fall back to everything if a workflow marks its sole
  // result as temp, so we never regress to zero outputs.
  const saved = all.filter((ref) => (ref.type ?? "output") === "output");
  return saved.length > 0 ? saved : all;
}

function audioRefsFromHistory(history: ComfyHistoryItem | undefined) {
  return Object.values(history?.outputs ?? {}).flatMap((output) => [
    ...(output.audio ?? []),
    ...(output.audios ?? []),
    ...(output.images ?? []).filter(isAudioMediaRef),
  ]);
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function errorFromHistory(history: ComfyHistoryItem | undefined) {
  const status = history?.status;

  for (const message of status?.messages ?? []) {
    if (
      !Array.isArray(message) ||
      (message[0] !== "execution_error" && message[0] !== "execution_interrupted")
    ) {
      continue;
    }

    const data = message[1];
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return "ComfyUI generation failed";
    }

    const record = data as Record<string, unknown>;
    const nodeType = stringFromRecord(record, "node_type");
    const nodeId = stringFromRecord(record, "node_id");
    const fallbackMessage =
      message[0] === "execution_interrupted" ? "execution_interrupted" : "execution_error";
    const exceptionMessage =
      stringFromRecord(record, "exception_message") ||
      stringFromRecord(record, "exception_type") ||
      fallbackMessage;
    const nodeLabel = [nodeType, nodeId ? `node ${nodeId}` : ""]
      .filter(Boolean)
      .join(" ");

    return nodeLabel
      ? `ComfyUI ${nodeLabel} error: ${exceptionMessage}`
      : `ComfyUI error: ${exceptionMessage}`;
  }

  if (status?.status_str === "error") {
    return "ComfyUI generation failed";
  }

  return "";
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new Error("ComfyUI generation canceled"));
      },
      { once: true }
    );
  });
}

export async function waitForComfyImageRefs(
  promptId: string,
  options: {
    idleTimeoutMs?: number;
    getLastActivityAt?: () => number;
    signal?: AbortSignal;
    baseUrl?: string;
  } = {}
) {
  const idleTimeoutMs = options.idleTimeoutMs ?? COMFYUI_TIMEOUT_MS;
  let lastActivityAt = Date.now();

  while (!options.signal?.aborted) {
    const history = await getHistory(promptId, options);
    const promptHistory = history[promptId];
    const images = imageRefsFromHistory(promptHistory);

    if (images.length > 0) {
      return images;
    }

    const historyError = errorFromHistory(promptHistory);
    if (historyError) {
      throw new Error(historyError);
    }

    const externalActivityAt = options.getLastActivityAt?.() ?? 0;

    if (externalActivityAt > lastActivityAt) {
      lastActivityAt = externalActivityAt;
    }

    try {
      if (await isPromptActive(promptId, options)) {
        lastActivityAt = Date.now();
      }
    } catch {
      // If the queue endpoint is temporarily unavailable, fall back to idle timeout.
    }

    if (Date.now() - lastActivityAt >= idleTimeoutMs) {
      throw new Error("ComfyUI generation timed out");
    }

    await wait(1000, options.signal);
  }

  throw new Error("ComfyUI generation canceled");
}

export async function waitForComfyVideoRefs(
  promptId: string,
  options: {
    idleTimeoutMs?: number;
    getLastActivityAt?: () => number;
    signal?: AbortSignal;
    baseUrl?: string;
  } = {}
) {
  const idleTimeoutMs = options.idleTimeoutMs ?? COMFYUI_TIMEOUT_MS;
  let lastActivityAt = Date.now();

  while (!options.signal?.aborted) {
    const history = await getHistory(promptId, options);
    const promptHistory = history[promptId];
    const videos = videoRefsFromHistory(promptHistory);

    if (videos.length > 0) {
      return videos;
    }

    const historyError = errorFromHistory(promptHistory);
    if (historyError) {
      throw new Error(historyError);
    }

    const externalActivityAt = options.getLastActivityAt?.() ?? 0;

    if (externalActivityAt > lastActivityAt) {
      lastActivityAt = externalActivityAt;
    }

    try {
      if (await isPromptActive(promptId, options)) {
        lastActivityAt = Date.now();
      }
    } catch {
      // If the queue endpoint is temporarily unavailable, fall back to idle timeout.
    }

    if (Date.now() - lastActivityAt >= idleTimeoutMs) {
      throw new Error("ComfyUI video generation timed out");
    }

    await wait(1000, options.signal);
  }

  throw new Error("ComfyUI video generation canceled");
}

export async function waitForComfyAudioRefs(
  promptId: string,
  options: {
    idleTimeoutMs?: number;
    getLastActivityAt?: () => number;
    signal?: AbortSignal;
    baseUrl?: string;
  } = {}
) {
  const idleTimeoutMs = options.idleTimeoutMs ?? COMFYUI_TIMEOUT_MS;
  let lastActivityAt = Date.now();

  while (!options.signal?.aborted) {
    const history = await getHistory(promptId, options);
    const promptHistory = history[promptId];
    const audios = audioRefsFromHistory(promptHistory);

    if (audios.length > 0) {
      return audios;
    }

    const historyError = errorFromHistory(promptHistory);
    if (historyError) {
      throw new Error(historyError);
    }

    const externalActivityAt = options.getLastActivityAt?.() ?? 0;

    if (externalActivityAt > lastActivityAt) {
      lastActivityAt = externalActivityAt;
    }

    try {
      if (await isPromptActive(promptId, options)) {
        lastActivityAt = Date.now();
      }
    } catch {
      // If the queue endpoint is temporarily unavailable, fall back to idle timeout.
    }

    if (Date.now() - lastActivityAt >= idleTimeoutMs) {
      throw new Error("ComfyUI audio generation timed out");
    }

    await wait(1000, options.signal);
  }

  throw new Error("ComfyUI audio generation canceled");
}

export async function cancelComfyPrompt(promptId?: string, options?: ComfyClientOptions) {
  const errors: string[] = [];
  let canceled = false;

  if (promptId?.trim()) {
    try {
      await comfyFetch("/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
      }, options);
      canceled = true;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Failed to update queue");
    }
  }

  try {
    await comfyFetch("/interrupt", { method: "POST" }, options);
    canceled = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Failed to interrupt ComfyUI");
  }

  if (!canceled && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

function viewPath(image: ComfyImageRef) {
  const params = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output",
  });

  return `/view?${params.toString()}`;
}

function contentTypeFor(filename: string) {
  return filename.toLowerCase().endsWith(".jpg") ||
    filename.toLowerCase().endsWith(".jpeg")
    ? "image/jpeg"
    : "image/png";
}

function mediaContentTypeFor(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".flac")) return "audio/flac";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg")) return "audio/ogg";
  if (lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

function replaceWorkflowPlaceholders(value: unknown, params: VideoGenerationParams): unknown {
  if (typeof value === "string") {
    const soundPrompt = params.sound_prompt.trim() || params.prompt;
    const replacements: Record<string, string | number> = {
      prompt: params.prompt,
      negative_prompt: params.negative_prompt,
      sound_prompt: soundPrompt,
      audio_prompt: soundPrompt,
      negative_sound_prompt: params.negative_sound_prompt,
      negative_audio_prompt: params.negative_sound_prompt,
      width: params.width,
      height: params.height,
      num_frames: params.num_frames,
      frames: params.num_frames,
      fps: params.fps,
      duration_seconds: params.duration_seconds,
      sound_duration_seconds: params.sound_duration_seconds,
      audio_duration_seconds: params.sound_duration_seconds,
      steps: params.num_inference_steps,
      num_inference_steps: params.num_inference_steps,
      high_noise_end_step: Math.max(1, Math.floor(params.num_inference_steps / 2)),
      low_noise_start_step: Math.max(1, Math.floor(params.num_inference_steps / 2)),
      cfg: params.guidance_scale,
      guidance_scale: params.guidance_scale,
      vae_tile_size: params.vae_tile_size,
      vae_tile_overlap: params.vae_tile_overlap,
      vae_temporal_size: params.vae_temporal_size,
      vae_temporal_overlap: params.vae_temporal_overlap,
      smooth_xxx_strength: params.smooth_xxx_strength,
      mating_press_strength: params.mating_press_strength,
      lightx2v_high_strength: params.lightx2v_high_strength,
      lightx2v_low_strength: params.lightx2v_low_strength,
      ltx_dr34_strength: params.ltx_dr34_strength,
      ltx_dasiwa_strength: params.ltx_dasiwa_strength,
      seed: normalizeGenerationSeed(params.seed),
      source_image: params.source_image ?? "",
      enable_sound: params.enable_sound ? 1 : 0,
    };

    const exactPlaceholder = value.match(/^\{\{([a-zA-Z0-9_]+)\}\}$/);
    if (exactPlaceholder) {
      return replacements[exactPlaceholder[1]] ?? "";
    }

    return value.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key: string) =>
      String(replacements[key] ?? "")
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceWorkflowPlaceholders(item, params));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceWorkflowPlaceholders(item, params),
      ])
    );
  }

  return value;
}

function applyVideoParamsToWorkflow(
  workflow: Record<string, unknown>,
  params: VideoGenerationParams
) {
  const sourceImage = params.source_image ?? "";
  let patchedPositiveText = false;
  let patchedNegativeText = false;

  for (const node of Object.values(workflow)) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;

    const record = node as {
      class_type?: unknown;
      inputs?: Record<string, unknown>;
      _meta?: { title?: unknown };
    };
    const classType = String(record.class_type ?? "");
    const title = String(record._meta?.title ?? "");
    const inputs = record.inputs;
    if (!inputs) continue;

    if (classType === "PrimitiveStringMultiline") {
      // A node titled with "negative" carries the negative prompt; check it first
      // so workflows with separate "Prompt (positive)"/"Prompt (negative)" string
      // nodes (e.g. LTX-2.5) route each side correctly instead of both getting the
      // positive text. Any other prompt-titled string node stays the positive one.
      if (/negative/i.test(title) && !patchedNegativeText) {
        inputs.value = params.negative_prompt;
        patchedNegativeText = true;
        continue;
      }
      if (/prompt/i.test(title) && !patchedPositiveText) {
        inputs.value = params.prompt;
        patchedPositiveText = true;
        continue;
      }
    }

    if (classType === "CLIPTextEncode" && typeof inputs.text === "string") {
      const text = String(inputs.text);
      const looksNegative =
        /negative|bad quality|watermark|subtitles|ugly|cartoon|still image/i.test(text);
      if (looksNegative && !patchedNegativeText) {
        inputs.text = params.negative_prompt;
        patchedNegativeText = true;
        continue;
      }
      if (!looksNegative && !patchedPositiveText) {
        inputs.text = params.prompt;
        patchedPositiveText = true;
        continue;
      }
    }

    if (classType === "LoadImage" && sourceImage) {
      inputs.image = sourceImage;
      continue;
    }

    if (classType === "LTXVScheduler" && typeof inputs.steps === "number") {
      inputs.steps = params.num_inference_steps;
    }

    if (classType === "KSampler" && typeof inputs.steps === "number") {
      inputs.steps = params.num_inference_steps;
    }

    if (classType === "LTXVConditioning" && typeof inputs.frame_rate === "number") {
      inputs.frame_rate = params.fps;
    }

    if (classType === "CreateVideo" && typeof inputs.fps === "number") {
      inputs.fps = params.fps;
    }

    if (classType === "EmptyLTXVLatentVideo") {
      if (typeof inputs.width === "number") inputs.width = params.width;
      if (typeof inputs.height === "number") inputs.height = params.height;
      if (typeof inputs.length === "number") inputs.length = params.num_frames;
    }
  }

  return workflow;
}

function applyVideoPipelineSettingsToWorkflow(
  workflow: Record<string, unknown>,
  params: VideoGenerationParams
) {
  const pipeline = resolveVideoPipeline(params.video_pipeline || params.video_model);
  const settings = {
    ...pipeline.defaults,
    ...(params.video_pipeline_settings ?? {}),
  };

  for (const control of pipeline.controls) {
    const value = settings[control.key];
    if (value === undefined) continue;

    for (const patch of control.patches) {
      const node = workflow[patch.nodeId];
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const inputs = (node as { inputs?: Record<string, unknown> }).inputs;
      if (!inputs) continue;
      inputs[patch.input] = value;
    }
  }

  for (const slot of pipeline.loraSlots ?? []) {
    injectVideoPipelineLora(workflow, slot, settings);
  }

  return workflow;
}

// Splice an optional LoRA loader into a video workflow's model graph. Unlike the
// value patches above, this inserts a new node between the base model loader and
// everything that reads its model output, so the LoRA affects every sampling pass.
// When the slot's select value is the off-value (or strength is 0) the workflow is
// left untouched and runs identically to before.
function injectVideoPipelineLora(
  workflow: Record<string, unknown>,
  slot: VideoPipelineLoraSlot,
  settings: Record<string, string | number | boolean>
) {
  const selected = String(settings[slot.selectKey] ?? "").trim();
  if (!selected || selected === slot.offValue) return;

  const rawStrength = Number(settings[slot.strengthKey]);
  const strength = Number.isFinite(rawStrength) ? rawStrength : 1;
  if (strength === 0) return;

  const sourceOutput = slot.sourceOutput ?? 0;

  // The source node must exist, or we would inject a dangling model edge.
  const sourceNode = workflow[slot.sourceNodeId];
  if (!sourceNode || typeof sourceNode !== "object" || Array.isArray(sourceNode)) {
    return;
  }

  // Repoint every consumer of [sourceNodeId, sourceOutput] to the injected loader.
  // Only the model edge (that exact output index) is rewired; clip/vae edges from
  // the same loader keep their original slot indices and are untouched.
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (nodeId === slot.injectNodeId) continue;
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const inputs = (node as { inputs?: Record<string, unknown> }).inputs;
    if (!inputs) continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        String(value[0]) === slot.sourceNodeId &&
        Number(value[1]) === sourceOutput
      ) {
        inputs[key] = [slot.injectNodeId, 0];
      }
    }
  }

  workflow[slot.injectNodeId] = {
    class_type: slot.loraClass ?? "LoraLoaderModelOnly",
    inputs: {
      lora_name: slot.loraName,
      strength_model: strength,
      model: [slot.sourceNodeId, sourceOutput],
    },
  };
}

async function loadWorkflowFromEnv(
  envName: "COMFYUI_VIDEO_WORKFLOW_PATH" | "COMFYUI_AUDIO_WORKFLOW_PATH",
  params: VideoGenerationParams,
  workflowPathOverride?: string,
  options?: ComfyClientOptions
) {
  const workflowPath = workflowPathOverride ?? process.env[envName]?.trim();

  if (!workflowPath) {
    throw new Error(
      `Set ${envName} to a ComfyUI API workflow JSON file before generating.`
    );
  }

  const resolvedSourceImage = params.source_image
    ? await resolveControlNetImage(params.source_image, options)
    : null;
  const resolvedParams = { ...params, source_image: resolvedSourceImage };
  const absolutePath = isAbsolute(workflowPath)
    ? workflowPath
    : join(/*turbopackIgnore: true*/ process.cwd(), workflowPath);
  const rawWorkflow = JSON.parse(await readFile(absolutePath, "utf-8")) as unknown;
  const workflow =
    rawWorkflow && typeof rawWorkflow === "object" && "prompt" in rawWorkflow
      ? (rawWorkflow as { prompt: unknown }).prompt
      : rawWorkflow;

  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error(`${envName} must point to a ComfyUI API workflow JSON object.`);
  }

  return applyVideoPipelineSettingsToWorkflow(
    applyVideoParamsToWorkflow(
      replaceWorkflowPlaceholders(workflow, resolvedParams) as Record<string, unknown>,
      resolvedParams
    ),
    resolvedParams
  );
}

async function loadVideoWorkflow(
  params: VideoGenerationParams,
  options?: ComfyClientOptions
) {
  const { absolutePath } = await resolveVideoWorkflowPath(
    params.video_pipeline || params.video_model
  );
  return loadWorkflowFromEnv(
    "COMFYUI_VIDEO_WORKFLOW_PATH",
    params,
    absolutePath,
    options
  );
}

async function loadAudioWorkflow(
  params: VideoGenerationParams,
  options?: ComfyClientOptions
) {
  return loadWorkflowFromEnv("COMFYUI_AUDIO_WORKFLOW_PATH", params, undefined, options);
}

export type InterrogateMode = "auto" | "wd14" | "florence";

interface InterrogateWorkflowParams {
  imageUrl: string;
  baseModel?: string;
  mode?: InterrogateMode;
}

const DANBOORU_BASE_MODEL_PATTERN = /illustrious|pony|noob|anima/i;

function resolveInterrogateMode(mode: InterrogateMode, baseModel: string) {
  if (mode !== "auto") {
    return mode;
  }

  if (DANBOORU_BASE_MODEL_PATTERN.test(baseModel)) {
    return "wd14";
  }

  return process.env.COMFYUI_ITP_FLORENCE_WORKFLOW_PATH?.trim()
    ? "florence"
    : "wd14";
}

function replaceInterrogateWorkflowPlaceholders(
  value: unknown,
  replacements: Record<string, string>
): unknown {
  if (typeof value === "string") {
    const exactPlaceholder = value.match(/^{{([a-zA-Z0-9_]+)}}$/);

    if (exactPlaceholder) {
      return replacements[exactPlaceholder[1]] ?? "";
    }

    return value.replace(/{{([a-zA-Z0-9_]+)}}/g, (_, key: string) =>
      replacements[key] ?? ""
    );
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      replaceInterrogateWorkflowPlaceholders(item, replacements)
    );
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        replaceInterrogateWorkflowPlaceholders(item, replacements),
      ])
    );
  }

  return value;
}

async function loadInterrogateWorkflowFromEnv(
  envName: "COMFYUI_ITP_WD14_WORKFLOW_PATH" | "COMFYUI_ITP_FLORENCE_WORKFLOW_PATH",
  image: string
) {
  const workflowPath = process.env[envName]?.trim();

  if (!workflowPath) {
    return null;
  }

  const absolutePath = isAbsolute(workflowPath)
    ? workflowPath
    : join(/*turbopackIgnore: true*/ process.cwd(), workflowPath);
  const rawWorkflow = JSON.parse(await readFile(absolutePath, "utf-8")) as unknown;
  const workflow =
    rawWorkflow && typeof rawWorkflow === "object" && "prompt" in rawWorkflow
      ? (rawWorkflow as { prompt: unknown }).prompt
      : rawWorkflow;

  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    throw new Error(
      envName + " must point to a ComfyUI API workflow JSON object."
    );
  }

  return replaceInterrogateWorkflowPlaceholders(workflow, {
    image,
    input_image: image,
  }) as Record<string, unknown>;
}

async function buildWd14InterrogateWorkflow(image: string) {
  const configuredWorkflow = await loadInterrogateWorkflowFromEnv(
    "COMFYUI_ITP_WD14_WORKFLOW_PATH",
    image
  );

  if (configuredWorkflow) {
    return configuredWorkflow;
  }

  return {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image,
      },
    },
    "2": {
      class_type: "WD14Tagger|pysssss",
      inputs: {
        image: ["1", 0],
        model: process.env.COMFYUI_ITP_WD14_MODEL ?? "wd-swinv2-tagger-v3",
        threshold: Number(process.env.COMFYUI_ITP_WD14_THRESHOLD ?? 0.35),
        character_threshold: Number(
          process.env.COMFYUI_ITP_WD14_CHARACTER_THRESHOLD ?? 0.85
        ),
        exclude_tags: process.env.COMFYUI_ITP_WD14_EXCLUDE_TAGS ?? "",
        replace_underscore: true,
        trailing_comma: false,
      },
    },
    "3": {
      class_type: "ShowText|pysssss",
      inputs: {
        text: ["2", 0],
      },
    },
  } satisfies Record<string, unknown>;
}

async function buildInterrogateWorkflow({
  imageUrl,
  baseModel = "",
  mode = "auto",
}: InterrogateWorkflowParams) {
  const image = await resolveControlNetImage(imageUrl);
  const resolvedMode = resolveInterrogateMode(mode, baseModel);

  if (resolvedMode === "florence") {
    const workflow = await loadInterrogateWorkflowFromEnv(
      "COMFYUI_ITP_FLORENCE_WORKFLOW_PATH",
      image
    );

    if (!workflow) {
      throw new Error(
        "Florence mode requires COMFYUI_ITP_FLORENCE_WORKFLOW_PATH to point to a ComfyUI API workflow JSON file."
      );
    }

    return { workflow, mode: resolvedMode };
  }

  return {
    workflow: await buildWd14InterrogateWorkflow(image),
    mode: resolvedMode,
  };
}

export async function generateWithComfyUI(params: GenerationParams) {
  const queued = await queueComfyPrompt(params);
  const imageRefs = await waitForComfyImageRefs(queued.prompt_id);
  const images = await fetchComfyImages(imageRefs);

  return { images, workflow: queued.workflow };
}
function normalizeHistoryText(value: string[] | string | undefined) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value ? [value] : [];
}

function textFromHistory(history: ComfyHistoryItem | undefined) {
  return Object.values(history?.outputs ?? {})
    .flatMap((output) => [
      ...normalizeHistoryText(output.text),
      ...normalizeHistoryText(output.string),
      ...normalizeHistoryText(output.strings),
      ...normalizeHistoryText(output.result),
    ])
    .map((value) => value.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function waitForComfyText(
  promptId: string,
  options: {
    idleTimeoutMs?: number;
    getLastActivityAt?: () => number;
    signal?: AbortSignal;
  } = {}
) {
  const idleTimeoutMs = options.idleTimeoutMs ?? COMFYUI_TIMEOUT_MS;
  let lastActivityAt = Date.now();

  while (!options.signal?.aborted) {
    const history = await getHistory(promptId);
    const promptHistory = history[promptId];
    const text = textFromHistory(promptHistory);

    if (text) {
      return text;
    }

    const historyError = errorFromHistory(promptHistory);
    if (historyError) {
      throw new Error(historyError);
    }

    const externalActivityAt = options.getLastActivityAt?.() ?? 0;

    if (externalActivityAt > lastActivityAt) {
      lastActivityAt = externalActivityAt;
    }

    try {
      if (await isPromptActive(promptId)) {
        lastActivityAt = Date.now();
      }
    } catch {
      // If the queue endpoint is temporarily unavailable, fall back to idle timeout.
    }

    if (Date.now() - lastActivityAt >= idleTimeoutMs) {
      throw new Error("ComfyUI image-to-prompt timed out");
    }

    await wait(1000, options.signal);
  }

  throw new Error("ComfyUI image-to-prompt canceled");
}

export async function interrogateImageWithComfyUI(
  params: InterrogateWorkflowParams,
  clientId = crypto.randomUUID()
) {
  const { workflow, mode } = await buildInterrogateWorkflow(params);
  const queued = await queueComfyWorkflow(workflow, clientId);
  const text = await waitForComfyText(queued.prompt_id);

  return {
    prompt: text,
    mode,
    prompt_id: queued.prompt_id,
  };
}


export async function queueComfyVideoPrompt(
  params: VideoGenerationParams,
  clientId = crypto.randomUUID(),
  options?: ComfyClientOptions
) {
  const prompt = await loadVideoWorkflow(params, options);
  const queued = await queueComfyWorkflow(prompt, clientId, options);
  return { ...queued, prompt };
}

export async function queueComfyAudioPrompt(
  params: VideoGenerationParams,
  clientId = crypto.randomUUID(),
  options?: ComfyClientOptions
) {
  const prompt = await loadAudioWorkflow(params, options);
  const queued = await queueComfyWorkflow(prompt, clientId, options);
  return { ...queued, prompt };
}

export async function generateOpenPosePreview(imageUrl: string, resolution: number) {
  const image = await resolveControlNetImage(imageUrl);
  const prompt: Record<string, unknown> = {
    "1": {
      class_type: "LoadImage",
      inputs: {
        image,
      },
    },
    "2": {
      class_type: "OpenposePreprocessor",
      inputs: {
        image: ["1", 0],
        detect_hand: "enable",
        detect_body: "enable",
        detect_face: "disable",
        resolution,
        scale_stick_for_xinsr_cn: "disable",
      },
    },
    "3": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "image-gen-pose-preview",
        images: ["2", 0],
      },
    },
  };
  const clientId = crypto.randomUUID();
  const res = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      prompt,
    }),
  });
  const queued = (await res.json()) as { prompt_id: string };
  const imageRefs = await waitForComfyImageRefs(queued.prompt_id);

  return fetchComfyImages(imageRefs);
}

export async function fetchComfyImages(
  imageRefs: ComfyImageRef[],
  options?: ComfyClientOptions
) {
  return Promise.all(
    imageRefs.map(async (image) => {
      const originalUrl = `${comfyBaseUrl(options)}${viewPath(image)}`;
      const response = await comfyFetch(viewPath(image), undefined, options);
      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        buffer,
        contentType: contentTypeFor(image.filename),
        originalUrl,
      } satisfies ComfyGeneratedImage;
    })
  );
}

export async function fetchComfyMedia(
  mediaRefs: ComfyMediaRef[],
  options?: ComfyClientOptions
) {
  return Promise.all(
    mediaRefs.map(async (media) => {
      const originalUrl = `${comfyBaseUrl(options)}${viewPath(media)}`;
      const response = await comfyFetch(viewPath(media), undefined, options);
      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        buffer,
        contentType: mediaContentTypeFor(media.filename),
        originalUrl,
        filename: media.filename,
      } satisfies ComfyGeneratedMedia;
    })
  );
}
