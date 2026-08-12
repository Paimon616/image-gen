import "server-only";

import { readFile } from "fs/promises";
import { basename } from "path";

import { parseCivitaiUrlIds } from "@/lib/civitai-url";
import type { ImportedCivitaiResource } from "@/lib/types";
import { resolveVideoWorkflowPath } from "@/lib/video-pipelines";

// One model file a video pipeline's workflow needs on the ComfyUI models dir,
// resolved to a downloadable resource via data/model-catalog.json.
export interface VideoPipelineModel {
  /** Path relative to ComfyUI/models, e.g. "loras/foo.safetensors". */
  path: string;
  folder: string;
  filename: string;
  resource: ImportedCivitaiResource;
  /** Resolved download URL (empty when the catalog has no source for it). */
  url: string;
  hasUrl: boolean;
  /** Host of the resolved URL, for display ("huggingface.co", "civitai.red"). */
  source: string;
  note?: string;
}

interface CatalogEntry {
  name?: string;
  version?: string;
  base_model?: string;
  civitai_url?: string | null;
  source_url?: string | null;
  note?: string;
}

type ResourceType = ImportedCivitaiResource["type"];

// Maps a models-dir folder to the resource "type" the RunPod downloader expects.
// The type only affects the folder *fallback* (we always pass an explicit
// targetPath) and how the item is labelled, so "other" is a safe default.
function typeForFolder(folder: string): ResourceType {
  switch (folder) {
    case "checkpoints":
      return "checkpoint";
    case "loras":
      return "lora";
    case "vae":
      return "vae";
    case "embeddings":
      return "embedding";
    case "upscale_models":
    case "latent_upscale_models":
      return "upscaler";
    default:
      return "other";
  }
}

function isDirectDownloadUrl(url: string | null | undefined) {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const path = parsed.pathname.toLowerCase();
  if (parsed.hostname.endsWith("huggingface.co") && path.includes("/resolve/")) {
    return true;
  }
  if (path.includes("/api/download/")) return true;
  return /\.(safetensors|ckpt|pt|pth|gguf|bin)$/i.test(path);
}

// Prefer a direct file URL (HF resolve, civitai /api/download with its fp query,
// etc.) so the downloader fetches the exact file; otherwise fall back to the
// civitai model-page URL, which the downloader resolves by modelVersionId.
function pickDownloadUrl(entry: CatalogEntry | undefined) {
  if (!entry) return "";
  const direct = entry.source_url && isDirectDownloadUrl(entry.source_url)
    ? entry.source_url
    : "";
  return direct || entry.civitai_url || entry.source_url || "";
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function readCatalog(): Promise<Record<string, CatalogEntry>> {
  try {
    return JSON.parse(await readFile("data/model-catalog.json", "utf8")) as Record<
      string,
      CatalogEntry
    >;
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Walk a ComfyUI API-format workflow and collect every model file it loads,
// keyed by "folder/filename". Covers the standard loader nodes plus the two
// LTX-specific ways loras are declared: the "easy loraNames" picker and the
// LoraManager `text` field (`<lora:name:strength:clip>` tags).
function collectRequiredFiles(workflow: unknown): Array<{ folder: string; filename: string }> {
  if (!isRecord(workflow)) return [];
  const out = new Map<string, { folder: string; filename: string }>();
  const add = (folder: string, raw: string) => {
    const filename = raw.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!filename) return;
    out.set(`${folder}/${filename}`, { folder, filename });
  };

  for (const node of Object.values(workflow)) {
    if (!isRecord(node)) continue;
    const classType = String(node.class_type ?? "");
    const inputs = isRecord(node.inputs) ? node.inputs : {};

    if (classType === "UNETLoader" && typeof inputs.unet_name === "string") {
      add("diffusion_models", inputs.unet_name);
    }
    if (typeof inputs.vae_name === "string") add("vae", inputs.vae_name);
    if (typeof inputs.ckpt_name === "string") add("checkpoints", inputs.ckpt_name);
    if (typeof inputs.text_encoder === "string") {
      add("text_encoders", inputs.text_encoder);
    }
    if (classType === "CLIPLoader" && typeof inputs.clip_name === "string") {
      add("text_encoders", inputs.clip_name);
    }
    if (classType === "LatentUpscaleModelLoader" && typeof inputs.model_name === "string") {
      add("latent_upscale_models", inputs.model_name);
    }
    if (
      (classType === "LoraLoader" ||
        classType === "LoraLoaderModelOnly" ||
        classType === "easy loraNames") &&
      typeof inputs.lora_name === "string"
    ) {
      add("loras", inputs.lora_name);
    }
    // LoraManager: parse `<lora:NAME:strength:clip>` tags out of its text field.
    if (typeof inputs.text === "string" && inputs.text.includes("<lora:")) {
      for (const match of inputs.text.matchAll(/<lora:([^:>]+)/g)) {
        const name = match[1]?.trim();
        if (name) add("loras", `${name}.safetensors`);
      }
    }
  }

  return [...out.values()];
}

// Resolve the models a video pipeline needs into downloadable resources. Each
// entry carries the pod-relative targetPath and a resource the RunPod download
// endpoint understands. Items without a resolvable URL are still returned (with
// hasUrl: false) so the UI can surface what must be sourced manually.
export async function collectVideoPipelineModels(
  idOrPath: string | undefined
): Promise<{ pipelineId: string; label: string; models: VideoPipelineModel[] }> {
  const { pipeline, absolutePath } = await resolveVideoWorkflowPath(idOrPath);
  const raw = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  const workflow = isRecord(raw) && "prompt" in raw ? (raw as { prompt: unknown }).prompt : raw;

  const catalog = await readCatalog();
  const byBasename = new Map<string, { key: string; entry: CatalogEntry }>();
  for (const [key, entry] of Object.entries(catalog)) {
    const base = basename(key);
    if (!byBasename.has(base)) byBasename.set(base, { key, entry });
  }

  const required = collectRequiredFiles(workflow);
  const models: VideoPipelineModel[] = required.map(({ folder, filename }) => {
    const key = `${folder}/${filename}`;
    const base = basename(filename);
    const entry = catalog[key] ?? byBasename.get(base)?.entry;
    const url = pickDownloadUrl(entry);
    const ids = parseCivitaiUrlIds(url || entry?.civitai_url || entry?.source_url || "");

    const resource: ImportedCivitaiResource = {
      type: typeForFolder(folder),
      name: entry?.name || base,
      versionName: entry?.version || "",
      baseModel: entry?.base_model || "",
      fileName: base,
      url,
      modelId: ids.modelId ? Number(ids.modelId) : undefined,
      modelVersionId: ids.modelVersionId ? Number(ids.modelVersionId) : undefined,
    };

    return {
      path: key,
      folder,
      filename,
      resource,
      url,
      hasUrl: Boolean(url),
      source: hostOf(url),
      note: entry?.note,
    };
  });

  return { pipelineId: pipeline.id, label: pipeline.label, models };
}

export interface NodeRepo {
  name: string;
  url: string;
}

// class_type -> custom-node git repo. Order matters: earlier rules win, so the
// LTX rule sits before KJNodes to claim LTXV*-prefixed nodes. AudioAdjustVolume
// and ResizeImageMaskNode are ComfyUI core built-ins, so they are intentionally
// absent (never installed). Only nodes actually missing from the pod are mapped.
const NODE_PACKS: Array<{ name: string; url: string; test: (ct: string) => boolean }> = [
  {
    name: "comfyui-various",
    url: "https://github.com/jamesWalker55/comfyui-various",
    test: (ct) => ct.startsWith("JW"),
  },
  {
    name: "ComfyUI-mxToolkit",
    url: "https://github.com/Smirnov75/ComfyUI-mxToolkit",
    test: (ct) => ct.startsWith("mxSlider") || ct.startsWith("mx"),
  },
  {
    name: "rgthree-comfy",
    url: "https://github.com/rgthree/rgthree-comfy",
    test: (ct) => ct.includes("(rgthree)"),
  },
  {
    name: "ComfyUI-Custom-Scripts",
    url: "https://github.com/pythongosssss/ComfyUI-Custom-Scripts",
    test: (ct) => ct.endsWith("|pysssss"),
  },
  {
    name: "ComfyUI-Lora-Manager",
    url: "https://github.com/willmiao/ComfyUI-Lora-Manager",
    test: (ct) => ct.includes("LoraManager"),
  },
  {
    name: "ComfyUI-Easy-Use",
    url: "https://github.com/yolain/ComfyUI-Easy-Use",
    test: (ct) => ct.startsWith("easy "),
  },
  {
    name: "ComfyUI_essentials",
    url: "https://github.com/cubiq/ComfyUI_essentials",
    test: (ct) => ct.endsWith("+"),
  },
  {
    name: "ComfyUI-LTXVideo",
    url: "https://github.com/Lightricks/ComfyUI-LTXVideo",
    test: (ct) =>
      ct.startsWith("LTX") ||
      ct === "STGGuiderAdvanced" ||
      ct === "RTXVideoSuperResolution" ||
      ct === "LatentUpscaleModelLoader",
  },
  {
    name: "ComfyUI-KJNodes",
    url: "https://github.com/kijai/ComfyUI-KJNodes",
    test: (ct) => ct.endsWith("KJv2") || ct.endsWith("KJ") || ct === "GetImageSize",
  },
  {
    name: "ComfyMath",
    url: "https://github.com/evanspearman/ComfyMath",
    test: (ct) => ct.startsWith("CM_") || ct === "ComfyMathExpression",
  },
  {
    name: "ComfyUI-VideoHelperSuite",
    url: "https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite",
    test: (ct) => ct.startsWith("VHS_"),
  },
  {
    name: "ComfyUI-DazzleSwitch",
    url: "https://github.com/DazzleNodes/ComfyUI-DazzleSwitch",
    test: (ct) => ct === "DazzleSwitch",
  },
  {
    name: "ControlAltAI-Nodes",
    url: "https://github.com/gseth/ControlAltAI-Nodes",
    test: (ct) => ct === "TwoWaySwitch",
  },
];

// Core/built-in class_types — used only as the fallback "not custom" filter when
// the pod's live node list (/object_info) is unavailable.
const BUILTIN_NODE_TYPES = new Set<string>([
  "CLIPTextEncode",
  "LoadImage",
  "VAEDecode",
  "VAEEncode",
  "VAELoader",
  "UNETLoader",
  "CheckpointLoaderSimple",
  "CLIPLoader",
  "EmptyLTXVLatentVideo",
  "LTXVConditioning",
  "LTXVScheduler",
  "SetLatentNoiseMask",
  "SolidMask",
  "KSamplerSelect",
  "RandomNoise",
  "SamplerCustomAdvanced",
  "PreviewImage",
  "PrimitiveFloat",
  "PrimitiveInt",
  "PrimitiveString",
  "Float",
  "CFGGuider",
  "AudioAdjustVolume",
  "ResizeImageMaskNode",
  // ComfyUI core (comfy_extras.* / nodes) used by the LTX-2.5 workflow — listed so
  // the fallback detector (used only when a pod's /object_info is unavailable) does
  // not flag these built-ins as custom nodes needing installation.
  "SaveVideo",
  "CreateVideo",
  "VAEDecodeTiled",
  "PrimitiveStringMultiline",
  "PrimitiveBoolean",
  "ManualSigmas",
]);

// Resolve which custom-node git repos a pipeline needs. When `installedTypes`
// (the pod's live class_type set from /object_info) is provided, only genuinely
// missing nodes are considered; otherwise falls back to the built-in allowlist.
export async function collectVideoPipelineNodePacks(
  idOrPath: string | undefined,
  installedTypes?: Set<string> | null
): Promise<{
  pipelineId: string;
  label: string;
  packs: NodeRepo[];
  missingClassTypes: string[];
  unmappedClassTypes: string[];
  detected: boolean;
}> {
  const { pipeline, absolutePath } = await resolveVideoWorkflowPath(idOrPath);
  const raw = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  const workflow = isRecord(raw) && "prompt" in raw ? (raw as { prompt: unknown }).prompt : raw;

  const classTypes = new Set<string>();
  if (isRecord(workflow)) {
    for (const node of Object.values(workflow)) {
      if (isRecord(node) && typeof node.class_type === "string") {
        classTypes.add(node.class_type);
      }
    }
  }

  const missing = [...classTypes].filter((ct) =>
    installedTypes ? !installedTypes.has(ct) : !BUILTIN_NODE_TYPES.has(ct)
  );

  const packs = new Map<string, NodeRepo>();
  const unmapped: string[] = [];
  for (const ct of missing) {
    const pack = NODE_PACKS.find((entry) => entry.test(ct));
    if (pack) packs.set(pack.url, { name: pack.name, url: pack.url });
    else unmapped.push(ct);
  }

  return {
    pipelineId: pipeline.id,
    label: pipeline.label,
    packs: [...packs.values()],
    missingClassTypes: missing,
    unmappedClassTypes: unmapped,
    detected: Boolean(installedTypes),
  };
}
