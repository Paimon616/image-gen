import type { EmbeddingConfig, GenerationParams, LoraConfig } from "./types";

const DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188";
const COMFYUI_BASE_URL =
  process.env.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_COMFYUI_URL;
const COMFYUI_TIMEOUT_MS = Number(process.env.COMFYUI_TIMEOUT_MS ?? 300_000);

interface ComfyImageRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface ComfyQueuedPrompt {
  prompt_id: string;
}

interface ComfyHistoryOutput {
  images?: ComfyImageRef[];
}

interface ComfyHistoryItem {
  outputs?: Record<string, ComfyHistoryOutput>;
}

interface ComfyGeneratedImage {
  buffer: Buffer;
  contentType: string;
  originalUrl: string;
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

function buildDefaultWorkflow(params: GenerationParams) {
  const loras = cleanLoras(params.loras);
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
  workflow["4"] = {
    class_type: "EmptyLatentImage",
    inputs: {
      width: params.width,
      height: params.height,
      batch_size: Math.min(Math.max(Number(params.num_images) || 1, 1), 4),
    },
  };
  workflow["5"] = {
    class_type: "KSampler",
    inputs: {
      seed,
      steps: params.num_inference_steps,
      cfg: params.guidance_scale,
      sampler_name: "euler",
      scheduler: "normal",
      denoise: 1,
      model: modelRef,
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
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

async function queuePrompt(params: GenerationParams) {
  const clientId = crypto.randomUUID();
  const res = await comfyFetch("/prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      prompt: buildDefaultWorkflow(params),
    }),
  });

  return (await res.json()) as ComfyQueuedPrompt;
}

async function getHistory(promptId: string) {
  const res = await comfyFetch(`/history/${encodeURIComponent(promptId)}`);
  return (await res.json()) as Record<string, ComfyHistoryItem>;
}

function imageRefsFromHistory(history: ComfyHistoryItem | undefined) {
  return Object.values(history?.outputs ?? {}).flatMap((output) => output.images ?? []);
}

async function waitForImages(promptId: string) {
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
  const queued = await queuePrompt(params);
  const imageRefs = await waitForImages(queued.prompt_id);

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
