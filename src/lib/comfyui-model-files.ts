import { access, open, readFile, stat } from "fs/promises";
import { join, normalize } from "path";

const MODEL_EXTENSIONS = new Set([".ckpt", ".pt", ".pth", ".safetensors"]);
const SAFETENSORS_HEADER_LIMIT = 64 * 1024 * 1024;

export const COMFYUI_MODELS_DIR =
  process.env.COMFYUI_MODELS_DIR ??
  join(Buffer.from("Q29tZnlVSQ==", "base64").toString("utf8"), "models");
export const ANIMA_CLIP_NAME = "qwen_3_06b_base.safetensors";
export const ANIMA_VAE_NAME = "qwen_image_vae.safetensors";
export const KREA2_CLIP_NAME = "qwen3vl_4b_fp8_scaled.safetensors";
export const KREA2_VAE_NAME = "qwen_image_vae.safetensors";
// The PornMaster Krea2 workflow ships its own stack: an abliterated ("heretic")
// int8 Qwen3-VL text encoder and the Wan 2.1 VAE. Kept separate from the official
// Krea 2 files so the "generic" workflow is unaffected.
export const PORNMASTER_CLIP_NAME = "qwen3-vl-4b-heretic_int8.safetensors";
export const PORNMASTER_VAE_NAME = "wan_2.1_vae.safetensors";
// Z-Image (Tongyi-MAI) is a Lumina2-architecture DiT: the diffusion weights ship
// alone and pair with a Qwen3-4B text encoder plus the Flux-style 16-channel VAE.
// Names match Comfy-Org/z_image_turbo split_files (the official ComfyUI blueprint).
export const ZIMAGE_CLIP_NAME = "qwen_3_4b.safetensors";
export const ZIMAGE_VAE_NAME = "ae.safetensors";
// Real-ESRGAN's official weights (xinntao/Real-ESRGAN releases). A1111/Forge list
// these two as "R-ESRGAN 4x+" and "R-ESRGAN 4x+ Anime6B" — the labels Civitai image
// metadata carries — so both names have to resolve to these filenames.
export const REAL_ESRGAN_X4PLUS_NAME = "RealESRGAN_x4plus.pth";
export const REAL_ESRGAN_X4PLUS_ANIME_NAME = "RealESRGAN_x4plus_anime_6B.pth";
// The photo-restoration upscaler the Moody workflow finishes on (Phips/OpenModelDB,
// RealPLKSR trained on web photos). Shipped as safetensors, which spandrel loads the
// same as the .pth the original workflow references.
export const NOMOS_WEBPHOTO_UPSCALER_NAME = "4xNomosWebPhoto_RealPLKSR.safetensors";

function upscalerAliasKey(label: string) {
  return label
    .replace(/\.(pth|pt|safetensors|ckpt)$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// A1111/Forge name their upscalers by display label, and Civitai image metadata carries
// that label verbatim. ComfyUI only ever lists real filenames, so an unmapped label
// becomes a phantom "missing file" on the pod *and* an upscale pass that is silently
// dropped at generation time. Entries mapping to "" are A1111 resize modes rather than
// model files, so no file is required for them. Keys are alias keys, and every real
// filename maps to itself, which keeps resolveUpscalerFileName idempotent.
const UPSCALER_FILE_BY_ALIAS: Record<string, string> = {
  resrgan4x: REAL_ESRGAN_X4PLUS_NAME,
  realesrganx4plus: REAL_ESRGAN_X4PLUS_NAME,
  resrgan4xanime6b: REAL_ESRGAN_X4PLUS_ANIME_NAME,
  realesrganx4plusanime6b: REAL_ESRGAN_X4PLUS_ANIME_NAME,
  esrgan4x: "ESRGAN_4x.pth",
  "4xultrasharp": "4x-UltraSharp.pth",
  remacri: "remacri_original.safetensors",
  remacrioriginal: "remacri_original.safetensors",
  "4xfoolhardyremacri": "remacri_original.safetensors",
  none: "",
  lanczos: "",
  nearest: "",
};

// Maps an upscaler label to the filename ComfyUI would list, or "" when the label is a
// modeless resize. Unknown labels pass through untouched: a real but unlisted filename
// must keep reaching ComfyUI, and an unrecognised label is better reported as missing
// than silently swallowed. A1111 spells latent hires modes many ways
// ("Latent (bicubic antialiased)"), all of which mean "no upscale model".
export function resolveUpscalerFileName(label: string) {
  const trimmed = label.trim();
  if (!trimmed) return "";

  const key = upscalerAliasKey(trimmed);
  if (key.startsWith("latent")) return "";

  const mapped = UPSCALER_FILE_BY_ALIAS[key];
  return mapped === undefined ? trimmed : mapped;
}

export interface CheckpointCapabilities {
  clip: boolean;
  vae: boolean;
}

function safeModelPath(folder: string, modelName: string) {
  const root = join(COMFYUI_MODELS_DIR, folder);
  const fullPath = normalize(join(root, modelName));

  if (
    fullPath !== root &&
    !fullPath.startsWith(`${root}/`) &&
    !fullPath.startsWith(`${root}\\`)
  ) {
    throw new Error("Invalid model path");
  }

  return fullPath;
}

export function isAnimaCheckpointName(modelName: string) {
  return /anima/i.test(modelName);
}

export function isKrea2CheckpointName(modelName: string) {
  return /krea[-_ ]?2/i.test(modelName);
}

export function isZImageCheckpointName(modelName: string) {
  return /z[-_ ]?image/i.test(modelName);
}

export type CheckpointFamily = "krea2" | "zimage" | "anima" | null;

const MODEL_CATALOG_PATH = join(process.cwd(), "data", "model-catalog.json");
let catalogBaseModelCache: { mtimeMs: number; baseModels: Map<string, string> } | null =
  null;

function familyFromLabel(label: string): CheckpointFamily {
  if (isKrea2CheckpointName(label)) return "krea2";
  if (isZImageCheckpointName(label)) return "zimage";
  if (isAnimaCheckpointName(label)) return "anima";
  return null;
}

// data/model-catalog.json records the Civitai base model for every checkpoint this app
// downloaded or imported, keyed by "<folder>/<filename>". Cached by mtime because the
// model listing routes resolve a family per asset.
async function readCatalogBaseModels() {
  try {
    const { mtimeMs } = await stat(MODEL_CATALOG_PATH);
    if (catalogBaseModelCache?.mtimeMs === mtimeMs) {
      return catalogBaseModelCache.baseModels;
    }

    const catalog = JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      { base_model?: string } | null
    >;
    const baseModels = new Map<string, string>();
    for (const [key, entry] of Object.entries(catalog)) {
      const match = /^(?:checkpoints|diffusion_models)\/(.+)$/.exec(key);
      if (!match) continue;
      const baseModel = entry?.base_model?.trim();
      if (!baseModel) continue;
      // One filename can appear under both checkpoints/ and diffusion_models/. Keep
      // whichever entry actually names a pipeline family, so a generic label on the
      // other copy can't shadow it.
      const existing = baseModels.get(match[1]);
      if (existing && familyFromLabel(existing) && !familyFromLabel(baseModel)) {
        continue;
      }
      baseModels.set(match[1], baseModel);
    }
    catalogBaseModelCache = { mtimeMs, baseModels };
    return baseModels;
  } catch {
    return new Map<string, string>();
  }
}

// The Civitai base model recorded for a checkpoint, or "" when this app never
// downloaded/imported it (ComfyUI itself only knows filenames).
async function catalogBaseModel(modelName: string) {
  const name = modelName.trim();
  if (!name) return "";

  const baseModels = await readCatalogBaseModels();
  return (
    baseModels.get(name) ?? baseModels.get(name.replace(/^.*\//, "")) ?? ""
  );
}

// Which dedicated pipeline a checkpoint belongs to. The filename is the primary signal
// (it is all ComfyUI itself knows), but plenty of merges don't carry their family in the
// name — animij_ai.safetensors is an Anima base, moodyProMix is Z-Image — so fall back to
// the catalog's base_model. Without that fallback those checkpoints reach the standard
// SDXL workflow and die on their missing bundled CLIP.
export async function resolveCheckpointFamily(modelName: string): Promise<CheckpointFamily> {
  const name = modelName.trim();
  if (!name) return null;

  const fromName = familyFromLabel(name);
  if (fromName) return fromName;

  return familyFromLabel(await catalogBaseModel(name));
}

// Whether a Z-Image checkpoint is a distilled Turbo build, which samples at cfg 1
// with its negative zeroed out. Same filename-then-catalog order as the family
// lookup above: merges like moodyRealMix_zitV7 and moodyProMix only declare
// "ZImageTurbo" in the catalog, and taking one for a Base build runs it at real CFG
// against an authored negative — exactly the recipe it was distilled away from.
export async function resolveZImageTurbo(modelName: string) {
  const name = modelName.trim();
  if (!name) return false;

  return /turbo/i.test(name) || /turbo/i.test(await catalogBaseModel(name));
}

// Diffusion-only image checkpoints. They are usually installed under
// models/diffusion_models (UNETLoader) rather than models/checkpoints, yet they
// generate images, so the image model list has to reach into that folder too.
export function isDiffusionOnlyImageCheckpointName(modelName: string) {
  return isKrea2CheckpointName(modelName) || isZImageCheckpointName(modelName);
}

export async function modelFileExists(folder: string, modelName: string) {
  try {
    await access(safeModelPath(folder, modelName));
    return true;
  } catch {
    return false;
  }
}

export type Krea2WorkflowVariant = "generic" | "refined" | "pornmaster" | "moody";

// Which upscale model the Moody finish runs. An explicit UI pick wins so the recipe
// stays tunable; otherwise it is the model the original workflow was built around.
export function moodyFinishUpscalerName(upscaleModelName: string) {
  return (
    resolveUpscalerFileName(upscaleModelName ?? "") || NOMOS_WEBPHOTO_UPSCALER_NAME
  );
}

export interface RequiredSupportFile {
  folder: string;
  name: string;
  label: string;
}

// The external files a checkpoint's pipeline loads but the weights don't bundle: the
// text encoder and VAE every diffusion-only family needs, plus the upscale model the
// Moody finish runs instead of a refine pass. Returns [] for checkpoints that route to
// the standard SDXL graph, which bundles its own CLIP and VAE.
export async function requiredSupportFiles(
  checkpointName: string,
  krea2Workflow: Krea2WorkflowVariant = "generic",
  upscaleModelName = ""
): Promise<RequiredSupportFile[]> {
  const family = await resolveCheckpointFamily(checkpointName);
  const isKrea2 = family === "krea2";
  const isPornmaster = isKrea2 && krea2Workflow === "pornmaster";
  const isZImage = family === "zimage";
  const clipName = isKrea2
    ? isPornmaster
      ? PORNMASTER_CLIP_NAME
      : KREA2_CLIP_NAME
    : isZImage
      ? ZIMAGE_CLIP_NAME
      : family === "anima"
        ? ANIMA_CLIP_NAME
        : null;

  if (!clipName) {
    return [];
  }

  const vaeName = isKrea2
    ? isPornmaster
      ? PORNMASTER_VAE_NAME
      : KREA2_VAE_NAME
    : isZImage
      ? ZIMAGE_VAE_NAME
      : ANIMA_VAE_NAME;
  const files: RequiredSupportFile[] = [
    { folder: "text_encoders", name: clipName, label: "" },
    { folder: "vae", name: vaeName, label: "" },
  ];
  // The Moody finish is an upscale, not a diffusion pass: without its upscale model
  // the workflow would silently degrade to a plain lanczos resize.
  if (isKrea2 && krea2Workflow === "moody") {
    files.push({
      folder: "upscale_models",
      name: moodyFinishUpscalerName(upscaleModelName),
      label: "",
    });
  }

  return files.map((file) => ({
    ...file,
    label: `ComfyUI/models/${file.folder}/${file.name}`,
  }));
}

export async function getMissingRequiredModelFiles(
  checkpointName: string,
  krea2Workflow: Krea2WorkflowVariant = "generic",
  upscaleModelName = ""
) {
  const required = await requiredSupportFiles(
    checkpointName,
    krea2Workflow,
    upscaleModelName
  );
  const missing = await Promise.all(
    required.map(async (file) =>
      (await modelFileExists(file.folder, file.name)) ? null : file.label
    )
  );

  return missing.filter((file): file is string => Boolean(file));
}

// The Civitai page this app recorded for a downloaded/imported checkpoint, used to
// re-fetch a file that is in the catalog but missing from disk.
export async function catalogSourceUrl(modelName: string) {
  const name = modelName.trim().replace(/^.*\//, "");
  if (!name) return "";

  try {
    const catalog = JSON.parse(await readFile(MODEL_CATALOG_PATH, "utf8")) as Record<
      string,
      { civitai_url?: string | null; source_url?: string | null } | null
    >;
    for (const [key, entry] of Object.entries(catalog)) {
      if (key.replace(/^.*\//, "") !== name) continue;
      const url = entry?.civitai_url || entry?.source_url;
      if (url) return url;
    }
  } catch {
    // No catalog on disk (fresh install) — nothing to resolve.
  }

  return "";
}

function hasCheckpointClip(keys: string[]) {
  return keys.some(
    (key) =>
      key.startsWith("conditioner.embedders.") ||
      key.startsWith("cond_stage_model.") ||
      key.startsWith("clip_l.") ||
      key.startsWith("clip_g.") ||
      key.includes("text_model")
  );
}

function hasCheckpointVae(keys: string[]) {
  return keys.some(
    (key) => key.startsWith("first_stage_model.") || key.startsWith("vae.")
  );
}

export async function getCheckpointCapabilities(
  checkpointName: string
): Promise<CheckpointCapabilities | null> {
  if (!checkpointName.endsWith(".safetensors")) {
    return null;
  }

  let file: Awaited<ReturnType<typeof open>> | null = null;

  try {
    file = await open(safeModelPath("checkpoints", checkpointName), "r");
    const sizeBuffer = Buffer.alloc(8);
    await file.read(sizeBuffer, 0, sizeBuffer.length, 0);
    const headerSize = Number(sizeBuffer.readBigUInt64LE(0));

    if (!Number.isSafeInteger(headerSize) || headerSize > SAFETENSORS_HEADER_LIMIT) {
      return null;
    }

    const headerBuffer = Buffer.alloc(headerSize);
    await file.read(headerBuffer, 0, headerBuffer.length, sizeBuffer.length);
    const header = JSON.parse(headerBuffer.toString("utf8")) as Record<string, unknown>;
    const keys = Object.keys(header).filter((key) => key !== "__metadata__");

    return {
      clip: hasCheckpointClip(keys),
      vae: hasCheckpointVae(keys),
    };
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

export function hasModelExtension(filename: string) {
  return [...MODEL_EXTENSIONS].some((ext) => filename.endsWith(ext));
}
