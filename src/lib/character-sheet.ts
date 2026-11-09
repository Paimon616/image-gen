// BETA: 캐릭터 기준 시트 (character reference sheet).
//
// A character gets one confirmed turnaround / expression sheet at creation time;
// every later render of that character is conditioned on it with IP-Adapter
// (SDXL/Illustrious, ComfyUI_IPAdapter_plus) so the face, hair and outfit stop
// drifting between images. Everything runs on our own ComfyUI (local or a LAN
// GPU worker) — never a paid API.
//
// Pure logic only (no fs, no fetch, no React) so both the server route and the
// client studio can use it, and node --test can cover it. See
// docs/character-reference-sheet.md.

import type {
  CharacterReferenceSheet,
  GenerationParams,
  LoraConfig,
} from "./types.ts";

// Situation id the sheet candidates are linked under (images API), so they stay
// out of the 기본/상황 strips and the studio can list them on their own.
export const CHARACTER_SHEET_SITUATION_ID = "__sheet__";

export const SHEET_CANDIDATE_COUNT = 4;
// Landscape SDXL bucket: room for front / side / back full-body views plus an
// expression row.
export const SHEET_WIDTH = 1216;
export const SHEET_HEIGHT = 832;

// IP-Adapter weight applied to renders of a sheet-confirmed character. 0.5 keeps
// identity/outfit without dragging the sheet's multi-view layout into the scene.
export const DEFAULT_SHEET_STRENGTH = 0.5;
export const MAX_SHEET_STRENGTH = 1.5;

// Illustrious-friendly turnaround + expression chart tags.
const SHEET_PROMPT_HEAD = [
  "masterpiece",
  "best quality",
  "amazing quality",
  "character reference sheet",
  "character turnaround",
  "multiple views",
  "front view",
  "side view",
  "back view",
  "from behind",
  "full body",
  "standing",
  "straight-on",
  "expression chart",
  "multiple expressions",
  "smile",
  "angry",
  "surprised",
  "embarrassed",
  "simple background",
  "white background",
];

const SHEET_NEGATIVE = [
  "worst quality",
  "low quality",
  "lowres",
  "bad anatomy",
  "bad hands",
  "text",
  "watermark",
  "signature",
  "cropped",
  "scenery",
  "detailed background",
  "multiple girls",
  "multiple boys",
  "different outfits",
  "inconsistent clothing",
  "nsfw",
];

// Added to the negative of every sheet-conditioned render so IP-Adapter does not
// reproduce the sheet's grid/turnaround layout inside the scene.
export const SHEET_RENDER_NEGATIVE = [
  "character sheet",
  "reference sheet",
  "multiple views",
  "turnaround",
  "expression chart",
];

function splitTags(text: string): string[] {
  return text
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

// Appends tags not already present (case-insensitive), keeping the original
// text and order intact.
export function appendUniqueTags(text: string, tags: string[]): string {
  const existing = new Set(splitTags(text).map((tag) => tag.toLowerCase()));
  const missing = tags.filter((tag) => !existing.has(tag.toLowerCase()));
  if (missing.length === 0) return text;
  const trimmed = text.replace(/[\s,]+$/, "");
  return trimmed ? `${trimmed}, ${missing.join(", ")}` : missing.join(", ");
}

// Tags that describe a scene/pose rather than identity. They fight the plain
// turnaround layout, so they are dropped from the appearance prompt.
const SCENE_TAG_PATTERN =
  /^(solo|solo focus|looking at viewer|upper body|cowboy shot|portrait|close-up|from (above|below|side|behind)|dutch angle|sitting|lying|kneeling|outdoors|indoors|night|day|sky|(.* )?background|scenery)$/i;

export function buildCharacterSheetPrompt(input: {
  appearancePrompt: string;
  triggerWords?: string[];
}): { prompt: string; negative: string } {
  const appearance = splitTags(input.appearancePrompt).filter(
    (tag) => !SCENE_TAG_PATTERN.test(tag.replace(/[()]/g, "").replace(/:[\d.]+$/, ""))
  );
  const head = [...(input.triggerWords ?? []), ...SHEET_PROMPT_HEAD];
  const prompt = appendUniqueTags(head.join(", "), appearance);
  return { prompt, negative: SHEET_NEGATIVE.join(", ") };
}

export function clampSheetStrength(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_SHEET_STRENGTH;
  return Math.round(Math.min(Math.max(number, 0), MAX_SHEET_STRENGTH) * 100) / 100;
}

const SHEET_URL_PATTERN = /^\/api\/images\/[A-Za-z0-9._-]+$/;
const SHEET_FILENAME_PATTERN = /^[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i;

// Storage normalization: only an app-served gallery image can be a sheet.
export function normalizeReferenceSheet(raw: unknown): CharacterReferenceSheet | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  const filename = typeof record.filename === "string" ? record.filename.trim() : "";
  if (!SHEET_URL_PATTERN.test(url) || !SHEET_FILENAME_PATTERN.test(filename)) return null;
  const seed =
    typeof record.seed === "number" && Number.isFinite(record.seed)
      ? Math.trunc(record.seed)
      : null;
  return {
    url,
    filename,
    thumbnailUrl:
      typeof record.thumbnailUrl === "string" && record.thumbnailUrl.startsWith("/api/")
        ? record.thumbnailUrl
        : undefined,
    confirmed: record.confirmed === true,
    enabled: record.enabled !== false,
    prompt: typeof record.prompt === "string" ? record.prompt.slice(0, 8000) : "",
    seed,
    strength: clampSheetStrength(record.strength),
    confirmedAt:
      typeof record.confirmedAt === "number" && Number.isFinite(record.confirmedAt)
        ? record.confirmedAt
        : undefined,
  };
}

// Does this render get the sheet's reference conditioning?
//  - beta on (global settings flag)
//  - the character has a confirmed sheet that is switched on for it
//  - not a sheet candidate itself (those must stay unconditioned)
//  - ComfyUI backend (A1111/Forge have no IP-Adapter path here)
export function shouldApplyReferenceSheet(input: {
  betaEnabled: boolean;
  sheet: CharacterReferenceSheet | null | undefined;
  situationId?: string | null;
  backend: GenerationParams["backend"];
}): boolean {
  const { betaEnabled, sheet, situationId, backend } = input;
  if (!betaEnabled || !sheet) return false;
  if (!sheet.confirmed || !sheet.enabled) return false;
  if (situationId === CHARACTER_SHEET_SITUATION_ID) return false;
  return backend === "comfyui";
}

// Applies the sheet, honouring the generator's per-render overrides
// (character_sheet_disabled / character_sheet_strength_override). Returns the
// params unchanged when the render opted out.
export function applyReferenceSheet(
  params: GenerationParams,
  sheet: CharacterReferenceSheet
): GenerationParams {
  if (params.character_sheet_disabled) return { ...params, character_sheet_image: null };
  const override = params.character_sheet_strength_override;
  return {
    ...params,
    character_sheet_image: sheet.url,
    character_sheet_strength: clampSheetStrength(
      typeof override === "number" && Number.isFinite(override) ? override : sheet.strength
    ),
  };
}

// Distinct non-negative 32-bit seeds for the candidate batch.
export function sheetCandidateSeeds(count: number, random: () => number = Math.random) {
  const seeds = new Set<number>();
  while (seeds.size < count) {
    seeds.add(Math.floor(random() * 0xffffffff));
  }
  return [...seeds];
}

// One params object per candidate. The baseline (the main image's settings, or
// the generator's current params) supplies model / sampler / LoRAs; everything
// that would pull the layout away from a clean turnaround is reset.
export function buildSheetCandidateParams(input: {
  base: GenerationParams;
  appearancePrompt: string;
  loras: LoraConfig[];
  triggerWords?: string[];
  seeds: number[];
}): GenerationParams[] {
  const { prompt, negative } = buildCharacterSheetPrompt({
    appearancePrompt: input.appearancePrompt,
    triggerWords: input.triggerWords,
  });
  return input.seeds.map((seed) => ({
    ...input.base,
    // Own GPUs only: the sheet is always a ComfyUI render.
    backend: "comfyui",
    prompt,
    negative_prompt: appendUniqueTags(input.base.negative_prompt ?? "", splitTags(negative)),
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    num_images: 1,
    seed,
    generation_mode: "text_to_image",
    loras: input.loras,
    controlnets: [],
    source_image: null,
    pose_reference_image: null,
    style_image: null,
    character_image: null,
    character_sheet_image: null,
    // Several small faces in one frame: a face detailer pass would smear them.
    adetailer_enabled: false,
  }));
}

// --- IP-Adapter assets -------------------------------------------------------

export const IPADAPTER_NODE_REPO = {
  name: "ComfyUI_IPAdapter_plus",
  url: "https://github.com/cubiq/ComfyUI_IPAdapter_plus.git",
  ref: "a0f451a5113cf9becb0847b92884cb10cbdec0ef",
} as const;

export interface IpAdapterModelAsset {
  // Relative to the ComfyUI models dir.
  targetFile: string;
  fileName: string;
  downloadUrl: string;
  bytes: number;
}

// SDXL "PLUS" adapter (ViT-H image encoder). Works on Illustrious/NoobAI/Pony.
export const IPADAPTER_MODEL: IpAdapterModelAsset = {
  targetFile: "ipadapter/ip-adapter-plus_sdxl_vit-h.safetensors",
  fileName: "ip-adapter-plus_sdxl_vit-h.safetensors",
  downloadUrl:
    "https://huggingface.co/h94/IP-Adapter/resolve/main/sdxl_models/ip-adapter-plus_sdxl_vit-h.safetensors",
  bytes: 847517512,
};

// The ViT-H image encoder, saved under the name IPAdapter_plus expects.
export const IPADAPTER_CLIP_VISION: IpAdapterModelAsset = {
  targetFile: "clip_vision/CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
  fileName: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
  downloadUrl:
    "https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors",
  bytes: 2528373448,
};

export const IPADAPTER_ASSETS = [IPADAPTER_MODEL, IPADAPTER_CLIP_VISION] as const;

// Picks a usable SDXL IP-Adapter + matching CLIP Vision encoder from what the
// target ComfyUI lists. FaceID files need insightface + a LoRA and SD1.5 files
// don't fit SDXL, so both are skipped. Returns the missing pieces instead of
// guessing, so the caller can report them before queueing.
export function pickIpAdapterFiles(
  ipadapterOptions: string[],
  clipVisionOptions: string[]
): { ipadapter: string; clipVision: string } | { missing: ("ipadapter" | "clip_vision")[] } {
  const sdxl = ipadapterOptions.filter(
    (name) => /sdxl/i.test(name) && !/faceid/i.test(name)
  );
  const ipadapter =
    sdxl.find((name) => /plus_sdxl_vit-?h/i.test(name)) ??
    sdxl.find((name) => /plus/i.test(name) && !/face/i.test(name) && /vit-?h/i.test(name)) ??
    sdxl.find((name) => /vit-?h/i.test(name)) ??
    sdxl.find((name) => !/vit-?h/i.test(name));
  // vit-h adapters pair with the ViT-H encoder; the plain ip-adapter_sdxl uses bigG.
  const wantsBigG = ipadapter ? !/vit-?h/i.test(ipadapter) : false;
  const clipVision = wantsBigG
    ? clipVisionOptions.find((name) => /bigg/i.test(name))
    : clipVisionOptions.find((name) => /vit-?h/i.test(name)) ??
      clipVisionOptions.find((name) => /^model\.safetensors$|image_encoder/i.test(name));

  const missing: ("ipadapter" | "clip_vision")[] = [];
  if (!ipadapter) missing.push("ipadapter");
  if (!clipVision) missing.push("clip_vision");
  if (missing.length > 0 || !ipadapter || !clipVision) return { missing };
  return { ipadapter, clipVision };
}

export type IpAdapterFeature = "sheet" | "style";

const FEATURE_LABEL: Record<IpAdapterFeature, { tag: string; skip: string; en: string }> = {
  sheet: {
    tag: "[IP-Adapter · 기준 시트 BETA]",
    skip: "또는 이 캐릭터의 기준 시트를 끄고 생성하세요.",
    en: "Reference sheet",
  },
  style: {
    tag: "[IP-Adapter · 스타일 참조]",
    skip: "또는 스타일 이미지를 비우고 생성하세요.",
    en: "Style reference",
  },
};

export function ipAdapterMissingMessage(
  what: "node" | ("ipadapter" | "clip_vision")[],
  target: string,
  feature: IpAdapterFeature = "sheet"
): string {
  const label = FEATURE_LABEL[feature];
  if (what === "node") {
    return (
      `${label.tag} ${target}에 IP-Adapter 커스텀 노드(ComfyUI_IPAdapter_plus)가 없습니다. ` +
      "로컬: npm run setup:ipadapter / GPU 워커: worker-kit 최신본으로 start-worker.bat 재실행. " +
      `${label.skip} ` +
      `(${label.en} needs the ComfyUI_IPAdapter_plus custom node on this ComfyUI.)`
    );
  }
  const files = what
    .map((kind) => (kind === "ipadapter" ? IPADAPTER_MODEL.targetFile : IPADAPTER_CLIP_VISION.targetFile))
    .join(", ");
  return (
    `${label.tag} ${target}에 IP-Adapter 모델 파일이 없습니다: ${files}. ` +
    "캐릭터 스튜디오 > 기준 시트 탭의 '모델 받기'로 내려받거나 npm run setup:ipadapter 를 실행하세요. " +
    `(${label.en} is missing model files: ${files}.)`
  );
}

export function isIpAdapterSetupError(message: string): boolean {
  return /\[IP-Adapter · /.test(message);
}

// Style reference (generator's 스타일 이미지) IP-Adapter weight.
export const DEFAULT_STYLE_STRENGTH = 0.8;
