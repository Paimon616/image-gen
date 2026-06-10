import type {
  ControlNetConfig,
  EmbeddingConfig,
  GenerationParams,
  LoraConfig,
} from "./types";

const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
export const COMFYUI_BASE_URL =
  process.env.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_COMFYUI_URL;
const COMFYUI_TIMEOUT_MS = Number(process.env.COMFYUI_TIMEOUT_MS ?? 300_000);

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyQueuedPrompt {
  prompt_id: string;
  client_id: string;
}

interface ComfyHistoryOutput {
  images?: ComfyImageRef[];
}

interface ComfyHistoryItem {
  outputs?: Record<string, ComfyHistoryOutput>;
}

export interface ComfyGeneratedImage {
  buffer: Buffer;
  contentType: string;
  originalUrl: string;
}

type WorkflowControlNetConfig = ControlNetConfig & {
  preprocessor?: "openpose";
};

interface ResolvedControlNetConfig extends WorkflowControlNetConfig {
  image: string;
}

function cleanLoras(loras: LoraConfig[]) {
  return loras
    .map((lora) => ({
      path: lora.path.trim(),
      scale: Number.isFinite(lora.scale) ? lora.scale : 1,
    }))
    .filter((lora) => lora.path.length > 0);
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
  return tokens ? `${prompt}, ${tokens}` : prompt;
}

function isRemoteImageRef(image: string) {
  return /^https?:\/\//i.test(image);
}

function extensionForContentType(contentType: string | null) {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  return "jpg";
}

async function uploadImageToComfyUI(imageUrl: string) {
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

  const uploadRes = await comfyFetch("/upload/image", {
    method: "POST",
    body: formData,
  });
  const uploaded = (await uploadRes.json()) as { name?: string };

  return uploaded.name ?? filename;
}

async function resolveControlNetImage(image: string) {
  if (!isRemoteImageRef(image)) return image;
  return uploadImageToComfyUI(image);
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

async function buildDefaultWorkflow(params: GenerationParams) {
  const loras = cleanLoras(params.loras);
  const controlnets = await cleanControlnets(params);
  const checkpoint = params.model_name.trim() || "sd_xl_base_1.0.safetensors";
  const seed = params.seed ?? Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
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

  if (params.vae_name.trim()) {
    workflow["21"] = {
      class_type: "VAELoader",
      inputs: {
        vae_name: params.vae_name.trim(),
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
        width: params.width,
        height: params.height,
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
        width: params.width,
        height: params.height,
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
  workflow["7"] = {
    class_type: "SaveImage",
    inputs: {
      filename_prefix: "image-gen",
      images: ["6", 0],
    },
  };

  return workflow;
}

async function comfyFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${COMFYUI_BASE_URL}${path}`, init);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ComfyUI ${res.status}: ${text || res.statusText}`);
  }

  return res;
}

export async function queueComfyPrompt(params: GenerationParams, clientId = crypto.randomUUID()) {
  const prompt = await buildDefaultWorkflow(params);
  const res = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      prompt,
    }),
  });

  const queued = (await res.json()) as Omit<ComfyQueuedPrompt, "client_id">;
  return { ...queued, client_id: clientId };
}

async function getHistory(promptId: string) {
  const res = await comfyFetch(`/history/${encodeURIComponent(promptId)}`);
  return (await res.json()) as Record<string, ComfyHistoryItem>;
}

function imageRefsFromHistory(history: ComfyHistoryItem | undefined) {
  return Object.values(history?.outputs ?? {}).flatMap((output) => output.images ?? []);
}

export async function waitForComfyImageRefs(promptId: string) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < COMFYUI_TIMEOUT_MS) {
    const history = await getHistory(promptId);
    const images = imageRefsFromHistory(history[promptId]);

    if (images.length > 0) {
      return images;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("ComfyUI generation timed out");
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

export async function generateWithComfyUI(params: GenerationParams) {
  const queued = await queueComfyPrompt(params);
  const imageRefs = await waitForComfyImageRefs(queued.prompt_id);

  return fetchComfyImages(imageRefs);
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

export async function fetchComfyImages(imageRefs: ComfyImageRef[]) {
  return Promise.all(
    imageRefs.map(async (image) => {
      const originalUrl = `${COMFYUI_BASE_URL}${viewPath(image)}`;
      const response = await comfyFetch(viewPath(image));
      const buffer = Buffer.from(await response.arrayBuffer());

      return {
        buffer,
        contentType: contentTypeFor(image.filename),
        originalUrl,
      } satisfies ComfyGeneratedImage;
    })
  );
}
