import { create } from "zustand";
import { useStore } from "./store";
import { useGenerationQueueStore } from "./generation-queue-store";
import type {
  Character,
  CharacterLora,
  EmbeddingConfig,
  GeneratedImage,
  GenerationParams,
  LoraConfig,
} from "./types";

export type PaimonChatRole = "user" | "assistant";

export interface PaimonChatMessage {
  id: string;
  role: PaimonChatRole;
  content: string;
}

export interface PaimonAttachment {
  id: string;
  kind: "clipboard_image" | "gallery_image";
  label: string;
  url?: string;
  dataUrl?: string;
  metadata?: Partial<GeneratedImage>;
}

export interface PaimonModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  tags?: string[];
}

export interface PaimonModelContext {
  currentCheckpoint?: PaimonModelAsset;
  compatibleLoras: PaimonModelAsset[];
  checkpoints: PaimonModelAsset[];
}

// The character's 메인 이미지 as a baseline: the prompt whose FORMAT a new
// situation render keeps, and the model settings that render is produced with.
// Only the fields actually reused ride along, so a 30-character library stays
// small in every request. Size and seed are deliberately absent — those stay
// whatever the generator screen currently has.
export interface PaimonCharacterBaseImage {
  prompt: string;
  negative_prompt: string;
  backend?: GenerationParams["backend"];
  model?: string;
  model_name?: string;
  loras?: LoraConfig[];
  embeddings?: EmbeddingConfig[];
  sampler_name?: string;
  scheduler?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
  clip_skip?: number;
  vae_name?: string;
}

export interface PaimonCharacter {
  id: string;
  name: string;
  summary: string;
  appearancePrompt: string;
  outfits: { name: string; prompt: string }[];
  backgrounds: { name: string; prompt: string }[];
  situations: {
    id: string;
    name: string;
    prompt: string;
    outfitName?: string;
    backgroundName?: string;
    // Resolved from outfitId/backgroundId at load time. The composer inlines
    // these verbatim so Paimon pastes them instead of re-wording them.
    outfitPrompt?: string;
    backgroundPrompt?: string;
  }[];
  // Absent when the character has no main image, or its image predates the
  // metadata sidecar.
  mainImage?: PaimonCharacterBaseImage;
  // 캐릭터 LoRA — the character's own trained LoRAs. Merged ON TOP of the
  // baseline's lora list on every render of this character (same path wins by
  // the character's scale), so a LoRA trained after the main image was made
  // still applies. Each entry's triggerWords are guaranteed into the prompt.
  loras?: CharacterLora[];
}

// Which of the three swappable segments a compose turn may rewrite. Unchecked
// segments are locked: the baseline's own outfit / background / situation tags
// stay verbatim, so "situation only" really does edit just the pose block.
export interface PaimonComposeScope {
  outfit: boolean;
  background: boolean;
  situation: boolean;
}

export const FULL_COMPOSE_SCOPE: PaimonComposeScope = {
  outfit: true,
  background: true,
  situation: true,
};

export interface PaimonComposeOptions {
  scope?: PaimonComposeScope;
  // Replaces the character's 메인 이미지 as the baseline (기준 이미지) — the
  // picker lets the user point at any saved image of that character instead.
  baseImage?: PaimonCharacterBaseImage;
  // Shown in the instruction so the turn knows which image it is working from.
  baseImageLabel?: string;
}

// Any generation params (a character's main image, or a picked gallery image)
// as a baseline record.
export function baseImageFromParams(
  params: Partial<GenerationParams> | null | undefined
): PaimonCharacterBaseImage | undefined {
  if (!params) return undefined;
  return {
    prompt: params.prompt ?? "",
    negative_prompt: params.negative_prompt ?? "",
    backend: params.backend,
    model: params.model,
    model_name: params.model_name,
    loras: params.loras,
    embeddings: params.embeddings,
    sampler_name: params.sampler_name,
    scheduler: params.scheduler,
    num_inference_steps: params.num_inference_steps,
    guidance_scale: params.guidance_scale,
    clip_skip: params.clip_skip,
    vae_name: params.vae_name,
  };
}

function baseImageFromCharacter(
  character: Character
): PaimonCharacterBaseImage | undefined {
  return baseImageFromParams(character.mainImage?.params);
}

// The baseline as a params patch — its settings AND its prompt/negative. It is
// applied to the generator BEFORE Paimon composes the situation, so the turn
// starts from the reference's own prompt on the reference's own checkpoint and
// only has to edit the segments in scope. Size, seed and reference images are
// left alone.
export function baseImageSettingsPatch(
  base: PaimonCharacterBaseImage
): Partial<GenerationParams> {
  const patch: Partial<GenerationParams> = {};
  if (base.backend) patch.backend = base.backend;
  if (base.model) patch.model = base.model;
  if (base.model_name) patch.model_name = base.model_name;
  // Stored character data can predate a field or have been hand-edited, so the
  // main image's asset lists go through the same normalization as a patch.
  if (base.loras) patch.loras = normalizeLoraList(base.loras);
  if (base.embeddings) patch.embeddings = normalizeEmbeddingList(base.embeddings);
  if (base.sampler_name) patch.sampler_name = base.sampler_name;
  if (base.scheduler) patch.scheduler = base.scheduler;
  if (typeof base.num_inference_steps === "number") {
    patch.num_inference_steps = base.num_inference_steps;
  }
  if (typeof base.guidance_scale === "number") {
    patch.guidance_scale = base.guidance_scale;
  }
  if (typeof base.clip_skip === "number") patch.clip_skip = base.clip_skip;
  if (typeof base.vae_name === "string") patch.vae_name = base.vae_name;
  // The baseline prompt/negative are the starting point for the composed ones:
  // loading them first is what makes a partial scope ("situation only") possible
  // — everything not in scope is already sitting in the field, verbatim.
  if (base.prompt.trim()) patch.prompt = base.prompt;
  patch.negative_prompt = base.negative_prompt;
  return patch;
}

export const PAIMON_INTRO_MESSAGE: PaimonChatMessage = {
  id: "intro",
  role: "assistant",
  content:
    "파이몬이에요. 현재 입력값과 참조 이미지를 읽고 이미지·영상 프롬프트, 모델 설정, LoRA, 업스케일을 바로 고쳐드릴게요.",
};

const EDITABLE_PARAM_KEYS = new Set<keyof GenerationParams>([
  "backend",
  "model",
  "model_name",
  "prompt",
  "negative_prompt",
  "num_inference_steps",
  "guidance_scale",
  "width",
  "height",
  "num_images",
  "output_format",
  "generation_mode",
  "seed",
  "sampler_name",
  "scheduler",
  "clip_skip",
  "vae_name",
  "upscale_model_name",
  "hires_upscale",
  "hires_steps",
  "hires_denoise",
  "img2img_resize",
  "adetailer_enabled",
  "adetailer_model",
  "adetailer_checkpoint",
  "adetailer_prompt",
  "adetailer_negative_prompt",
  "adetailer_use_steps",
  "adetailer_steps",
  "adetailer_confidence",
  "adetailer_mask_blur",
  "adetailer_noise_multiplier",
  "adetailer_inpaint_only_masked",
  "adetailer_loras",
  "adetailer_denoise",
  "loras",
  "embeddings",
  "controlnets",
  "prompt_weighting",
  "style_image",
  "character_image",
  "source_image",
  "denoise_strength",
  "pose_reference_image",
  "pose_reference_model",
  "pose_reference_strength",
  "enable_safety_checker",
]);

// The asset lists Paimon may rewrite. Their items carry a numeric field the UI
// dereferences directly (a LoRA weight slider calls `scale.toFixed(2)`), so an
// item that arrives without it — the model omitting `scale`, or naming it
// `weight` — would crash the generator page on the next render. Every other
// entry point into `params.loras` already defaults the weight; these lists are
// normalized the same way before a patch reaches the store.
const ASSET_LIST_KEYS = new Set<keyof GenerationParams>([
  "loras",
  "adetailer_loras",
  "embeddings",
]);

const DEFAULT_LORA_SCALE = 0.8;

function assetPath(item: Record<string, unknown>) {
  const candidate = item.path ?? item.name ?? item.modelName;
  return typeof candidate === "string" ? candidate.trim() : "";
}

function loraScale(item: Record<string, unknown>) {
  const candidate = item.scale ?? item.weight ?? item.strength;
  const numeric =
    typeof candidate === "number"
      ? candidate
      : typeof candidate === "string"
        ? Number(candidate)
        : NaN;

  return Number.isFinite(numeric) ? numeric : DEFAULT_LORA_SCALE;
}

function normalizeLoraList(value: unknown): LoraConfig[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim() ? { path: item.trim(), scale: DEFAULT_LORA_SCALE } : null;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const record = item as Record<string, unknown>;
      const path = assetPath(record);

      return path ? { path, scale: loraScale(record) } : null;
    })
    .filter((item): item is LoraConfig => Boolean(item));
}

// Character LoRAs ride on top of whatever lora list a baseline (or the LLM's
// patch) produced: an entry with the same path replaces the base one so the
// character's scale wins; anything else is appended.
export function mergeCharacterLoras(
  base: LoraConfig[] | undefined,
  characterLoras: LoraConfig[]
): LoraConfig[] {
  if (characterLoras.length === 0) return base ?? [];
  const overrides = new Map(
    characterLoras.map((lora) => [lora.path.toLowerCase(), lora])
  );
  const merged = (base ?? []).map(
    (lora) => overrides.get(lora.path.toLowerCase()) ?? lora
  );
  const present = new Set(merged.map((lora) => lora.path.toLowerCase()));
  for (const lora of characterLoras) {
    if (!present.has(lora.path.toLowerCase())) merged.push(lora);
  }
  return merged;
}

// The activation tags of a character's LoRAs, as individual tokens. These must
// appear in the prompt of every render of that character — a trained LoRA
// without its trigger words barely activates.
export function characterTriggerTokens(
  loras: CharacterLora[] | undefined
): string[] {
  if (!loras?.length) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const lora of loras) {
    for (const raw of (lora.triggerWords ?? "").split(",")) {
      const token = raw.trim();
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens;
}

// Guarantees every trigger token appears in the prompt: tokens the model (or a
// baseline) already placed are left where they are, missing ones are appended.
export function ensureTriggerWords(
  prompt: string,
  tokens: string[]
): string {
  if (tokens.length === 0) return prompt;
  const haystack = prompt.toLowerCase();
  const missing = tokens.filter(
    (token) => !haystack.includes(token.toLowerCase())
  );
  if (missing.length === 0) return prompt;
  const trimmed = prompt.replace(/[\s,]+$/, "");
  return trimmed ? `${trimmed}, ${missing.join(", ")}` : missing.join(", ");
}

function normalizeEmbeddingList(value: unknown): EmbeddingConfig[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim() ? { path: item.trim(), tokens: item.trim() } : null;
      }
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;

      const record = item as Record<string, unknown>;
      const path = assetPath(record);
      if (!path) return null;

      return {
        path,
        tokens: typeof record.tokens === "string" ? record.tokens : path,
      };
    })
    .filter((item): item is EmbeddingConfig => Boolean(item));
}

function normalizeAssetList(key: keyof GenerationParams, value: unknown) {
  return key === "embeddings"
    ? normalizeEmbeddingList(value)
    : normalizeLoraList(value);
}

function sanitizePatch(value: unknown): Partial<GenerationParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const patch: Partial<GenerationParams> = {};

  Object.entries(value).forEach(([key, nextValue]) => {
    const paramKey = key as keyof GenerationParams;
    if (!EDITABLE_PARAM_KEYS.has(paramKey)) return;

    if (ASSET_LIST_KEYS.has(paramKey)) {
      // A non-array here is the model answering in the wrong shape, not a
      // request to drop every LoRA, so the key is skipped instead of emptied.
      if (!Array.isArray(nextValue)) return;
      (patch as Record<string, unknown>)[key] = normalizeAssetList(
        paramKey,
        nextValue
      );
      return;
    }

    (patch as Record<string, unknown>)[key] = nextValue;
  });

  return patch;
}

function compactAsset(asset: unknown): PaimonModelAsset | null {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    return null;
  }

  const record = asset as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.name !== "string") {
    return null;
  }

  return {
    path: record.path,
    name: record.name,
    version: typeof record.version === "string" ? record.version : "",
    base_model: typeof record.base_model === "string" ? record.base_model : "",
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function isPaimonModelAsset(
  asset: PaimonModelAsset | null
): asset is PaimonModelAsset {
  return Boolean(asset);
}

function normalizeFamily(value: string | undefined) {
  const lower = (value ?? "").toLowerCase();

  if (/pony|pdxl/.test(lower)) return "pony";
  if (/illustrious|ilxl/.test(lower)) return "illustrious";
  if (/noob/.test(lower)) return "noobai";
  if (/anima/.test(lower)) return "anima";
  if (/flux/.test(lower)) return "flux";
  if (/krea/.test(lower)) return "krea";
  if (/sdxl|xl/.test(lower)) return "sdxl";
  if (/sd\s*1\.?5|sd15|1\.5/.test(lower)) return "sd15";

  return lower.trim();
}

function sameFamily(left: string | undefined, right: string | undefined) {
  const leftFamily = normalizeFamily(left);
  const rightFamily = normalizeFamily(right);

  if (!leftFamily || !rightFamily) return false;
  if (leftFamily === rightFamily) return true;

  return (
    (leftFamily === "illustrious" && rightFamily === "noobai") ||
    (leftFamily === "noobai" && rightFamily === "illustrious")
  );
}

// /api/models scans the local model folders, and a situation batch would
// otherwise re-scan them once per situation. The context only depends on the
// selected checkpoint, so cache it briefly and let a batch reuse one read.
const MODEL_CONTEXT_TTL_MS = 60_000;
let modelContextCache: {
  key: string;
  at: number;
  value: PaimonModelContext;
} | null = null;

async function loadModelContext(
  params: GenerationParams
): Promise<PaimonModelContext> {
  const cacheKey = params.model_name ?? "";
  if (
    modelContextCache &&
    modelContextCache.key === cacheKey &&
    Date.now() - modelContextCache.at < MODEL_CONTEXT_TTL_MS
  ) {
    return modelContextCache.value;
  }
  try {
    const res = await fetch("/api/models", { cache: "no-store" });
    const data = await res.json();
    const checkpointAssets: unknown[] = Array.isArray(data.checkpointAssets)
      ? data.checkpointAssets
      : [];
    const loraAssets: unknown[] = Array.isArray(data.loraAssets)
      ? data.loraAssets
      : [];
    const checkpoints = checkpointAssets
      .map(compactAsset)
      .filter(isPaimonModelAsset);
    const loras = loraAssets.map(compactAsset).filter(isPaimonModelAsset);
    const currentCheckpoint = checkpoints.find(
      (asset) => asset.path === params.model_name
    );
    const currentFamily =
      currentCheckpoint?.base_model ||
      currentCheckpoint?.path ||
      params.model_name;
    const compatibleLoras = loras
      .filter((asset) => sameFamily(currentFamily, asset.base_model || asset.path))
      .slice(0, 40);

    const value: PaimonModelContext = {
      currentCheckpoint,
      compatibleLoras,
      checkpoints: checkpoints.slice(0, 80),
    };
    modelContextCache = { key: cacheKey, at: Date.now(), value };
    return value;
  } catch {
    return {
      compatibleLoras: [],
      checkpoints: [],
    };
  }
}

// Loads the user's saved characters as a compact library so Paimon can compose a
// character's identity + outfit + background + situation into the prompt. Only
// prompt-bearing fields are sent; failures degrade to an empty library.
export async function loadCharacterLibrary(): Promise<PaimonCharacter[]> {
  try {
    const res = await fetch("/api/characters", { cache: "no-store" });
    const data = (await res.json()) as { characters?: Character[] };
    return (data.characters ?? [])
      .filter(
        (character) =>
          character.appearancePrompt.trim() ||
          character.backgrounds.some((background) => background.prompt.trim()) ||
          character.outfits.some((outfit) => outfit.prompt.trim()) ||
          character.situations.some((situation) => situation.prompt.trim())
      )
      .slice(0, 30)
      .map((character) => {
        // Resolve each situation's outfit/background id to a name so Paimon can
        // pair them without knowing the internal ids.
        const outfitById = new Map(
          character.outfits.map((outfit) => [outfit.id, outfit])
        );
        const backgroundById = new Map(
          character.backgrounds.map((background) => [background.id, background])
        );
        return {
          id: character.id,
          name: character.name,
          summary: character.summary,
          appearancePrompt: character.appearancePrompt,
          mainImage: baseImageFromCharacter(character),
          // Already normalized by the characters store; passed through as-is
          // (normalizeLoraList would strip each entry's triggerWords).
          loras: character.loras?.length ? character.loras : undefined,
          outfits: character.outfits
            .filter((outfit) => outfit.prompt.trim())
            .map((outfit) => ({ name: outfit.name, prompt: outfit.prompt })),
          backgrounds: character.backgrounds
            .filter((background) => background.prompt.trim())
            .map((background) => ({
              name: background.name,
              prompt: background.prompt,
            })),
          situations: character.situations
            .filter((situation) => situation.prompt.trim())
            .map((situation) => ({
              id: situation.id,
              name: situation.name,
              prompt: situation.prompt,
              outfitName: situation.outfitId
                ? outfitById.get(situation.outfitId)?.name
                : undefined,
              backgroundName: situation.backgroundId
                ? backgroundById.get(situation.backgroundId)?.name
                : undefined,
              outfitPrompt: situation.outfitId
                ? outfitById.get(situation.outfitId)?.prompt
                : undefined,
              backgroundPrompt: situation.backgroundId
                ? backgroundById.get(situation.backgroundId)?.prompt
                : undefined,
            })),
        };
      });
  } catch {
    return [];
  }
}

// Whole-figure cues in a saved situation (or in the baseline prompt). These
// checkpoints squash the figure whenever the whole body has to fit the frame —
// short legs, oversized head — so such a turn gets an explicit instruction to
// TIGHTEN the framing (rather than relying on the system prompt alone, which
// loses against "keep the situation prompt as is"). Older characters still hold
// full-body situations written before the generator stopped emitting them.
const FULL_BODY_PATTERN =
  /full[\s-]?body|full figure|head[\s-]to[\s-]toe|whole body|wide shot|feet visible|전신/i;

function fullBodyRequirements(...prompts: (string | undefined)[]) {
  if (!prompts.some((prompt) => prompt && FULL_BODY_PATTERN.test(prompt))) {
    return [];
  }
  return [
    "- 이 상황(또는 기준 프롬프트)에 전신 구도(full body / wide shot / head to toe / 전신)가 들어있어. 지금 모델은 전신을 프레임에 다 넣으면 다리가 짧고 머리가 큰 짧뚱한 몸으로 나와. 이 메시지에서 내가 직접 전신을 요청하지 않았다면 기본값은 '지우기'야: 그 태그들을 빼고 'cowboy shot'(허리 위)이나 'knee up'으로 좁혀서 구성하고, 포즈·팔다리 동작·카메라 각도·시선·표정은 그대로 유지해. 좁혔다는 걸 한마디로 알려줘.",
    "- 눕기·춤·점프·달리기·뒤돌아 걷기·무릎 꿇기·신발이나 전체 의상 보여주기 같은 동작도 전신을 정당화하지 않아. 'knee up'이나 'cowboy shot'으로 잡고 보이는 범위에서 동작이 읽히게 묘사해. 'from a distance', 'small in frame', 'entire silhouette' 같은 우회 표현으로 전신을 다시 넣지도 마.",
    "- 내가 이 메시지에서 전신을 명시적으로 요청한 경우에만 전신을 유지해. 그럴 때는: 'from above / slightly from above / high angle / overhead'는 지우고 눈높이나 약간 아래에서 잡아. 위에서 내려다보는 각도가 짧뚱해 보이는 가장 큰 원인이야. 그리고 프레이밍 태그 바로 옆에 다리·키 앵커를 붙여 — head to toe, feet visible, standing tall, long legs, slender legs, well-proportioned (자세에 맞는 것만).",
    "- 네거티브에는 short legs, stubby legs, stubby body, squat body, dwarf, chibi, bad proportions, deformed proportions, compressed body, foreshortening, oversized head, big head, wide body, cropped legs, cropped feet를 넣어.",
    "- 'wide hips', 'thick thighs' 같은 몸을 넓게 만드는 태그를 네가 새로 추가하지 마.",
  ];
}

// The baseline prompt can be long; inline enough of it that the turn can follow
// its formatting without dumping an unbounded blob into every request.
const MAX_BASE_PROMPT_CHARS = 2000;

function clip(value: string) {
  const trimmed = value.trim();
  return trimmed.length > MAX_BASE_PROMPT_CHARS
    ? `${trimmed.slice(0, MAX_BASE_PROMPT_CHARS)}…`
    : trimmed;
}

// The instruction for one character/situation → prompt turn. When the character
// has a main image, that image's metadata is the baseline: its prompt format is
// kept and only the appearance / outfit / background / situation segments are
// swapped in. Its model settings are applied separately (see composeSituation),
// so here Paimon is only told to leave them alone.
// What actually gets serialized into a request. Situation prompts are by far
// the biggest part of a saved character (one character can hold 200 of them),
// and a turn only ever needs the prompts of the character it is ABOUT — sending
// every prompt of every character made each turn carry tens of thousands of
// tokens, which is time the user waits before anything is queued. So every
// character still ships its identity, outfits, backgrounds and situation NAMES,
// while situation prompts (and the main-image baseline) ride along only for the
// characters the turn is about: the one the picker composed, or any whose name
// appears in the message. Ids are dropped — the client resolves those itself.
// Upper bound on how many situation prompts one character contributes when the
// message names the character but no particular situation.
const MAX_SITUATION_PROMPTS = 40;

function mentions(haystack: string, name: string) {
  const trimmed = name.trim().toLowerCase();
  return Boolean(trimmed) && haystack.includes(trimmed);
}

function libraryPayload(library: PaimonCharacter[], focusText: string) {
  const haystack = focusText.toLowerCase();
  return library.map((character) => {
    const focused = mentions(haystack, character.name);
    // Within a named character, a named situation narrows it further; otherwise
    // the first N situations carry prompts and the rest only their names.
    const named = focused
      ? character.situations.filter((situation) =>
          mentions(haystack, situation.name)
        )
      : [];
    const withPrompt = new Set(
      (named.length > 0
        ? named
        : focused
          ? character.situations.slice(0, MAX_SITUATION_PROMPTS)
          : []
      ).map((situation) => situation.id)
    );

    return {
      name: character.name,
      summary: character.summary,
      appearancePrompt: character.appearancePrompt,
      mainImage: focused ? character.mainImage : undefined,
      outfits: character.outfits,
      backgrounds: character.backgrounds,
      situations: character.situations.map((situation) =>
        withPrompt.has(situation.id)
          ? {
              name: situation.name,
              prompt: situation.prompt,
              outfitName: situation.outfitName,
              backgroundName: situation.backgroundName,
              outfitPrompt: situation.outfitPrompt,
              backgroundPrompt: situation.backgroundPrompt,
            }
          : { name: situation.name }
      ),
      // Marks the trim above so an omitted prompt never reads as an empty record.
      situationPromptsOmitted:
        withPrompt.size === character.situations.length ? undefined : true,
    };
  });
}

// The identity segment is the ONE thing that must not be re-composed per
// situation. Re-wording a hair/eye/face tag — even into a synonym the model
// family "prefers" — is a different person to the sampler, which is exactly how
// a character's situation renders drift apart from each other and from the main
// image. So the exact strings are inlined into the turn for Paimon to paste,
// rather than left for it to re-derive from the characterLibrary JSON.
function segmentBlock(
  character: PaimonCharacter,
  situation: PaimonCharacter["situations"][number] | null,
  scope: PaimonComposeScope
): string[] {
  const identity = character.appearancePrompt.trim();
  const outfit = situation?.outfitPrompt?.trim();
  const background = situation?.backgroundPrompt?.trim();
  const action = situation?.prompt.trim();
  const lines = [
    identity ? `- [고정] 외형(정체성) 프롬프트: ${identity}` : "",
    outfit && scope.outfit
      ? `- [교체] 의상 프롬프트${situation?.outfitName ? ` (${situation.outfitName})` : ""}: ${outfit}`
      : "",
    !scope.outfit
      ? "- [고정] 의상: 이번 턴에는 의상을 바꾸지 않아. 지금 프롬프트에 있는 옷·신발·액세서리 태그를 글자 그대로 남겨."
      : "",
    background && scope.background
      ? `- [교체] 배경 프롬프트${situation?.backgroundName ? ` (${situation.backgroundName})` : ""}: ${background}`
      : "",
    !scope.background
      ? "- [고정] 배경: 이번 턴에는 배경을 바꾸지 않아. 지금 프롬프트에 있는 장소·시간대·조명·분위기 태그를 글자 그대로 남겨."
      : "",
    action && scope.situation ? `- [교체] 상황 프롬프트: ${action}` : "",
    !scope.situation
      ? "- [고정] 상황: 이번 턴에는 포즈·구도를 바꾸지 않아. 지금 프롬프트에 있는 동작·포즈·프레이밍·카메라 앵글·시선·표정 태그를 글자 그대로 남겨."
      : "",
  ].filter(Boolean);
  return lines.length > 0 ? ["", "이번 턴에 쓸 구성 요소:", ...lines] : [];
}

const SCOPE_LABELS: [keyof PaimonComposeScope, string][] = [
  ["outfit", "의상"],
  ["background", "배경"],
  ["situation", "상황(포즈·구도)"],
];

export function scopeLabel(scope: PaimonComposeScope): string {
  const picked = SCOPE_LABELS.filter(([key]) => scope[key]).map(
    ([, label]) => label
  );
  return picked.length === 0 ? "없음" : picked.join(" · ");
}

// A partial scope is the whole point of the checkboxes, so it gets its own
// requirement line ahead of everything else — the model otherwise treats a
// character/situation turn as a licence to recompose the entire prompt.
function scopeRequirements(scope: PaimonComposeScope): string[] {
  if (scope.outfit && scope.background && scope.situation) return [];
  return [
    `- 부분 수정 턴이야. 이번에 교체할 수 있는 건 ${scopeLabel(scope)}뿐이고, 그 외의 프롬프트는 한 글자도 건드리지 마. 태그 순서·표기·품질 태그·나머지 [고정] 항목은 지금 값 그대로 다시 내보내.`,
    "- 교체 대상이 아닌 부분이 이번 상황과 안 어울려 보여도 그대로 둬. 어울리게 고치는 게 아니라 체크된 항목만 갈아끼우는 게 이 턴의 목적이야.",
  ];
}

// Ordered so the identity lock reads before the "adapt to this model" habits the
// system prompt otherwise licenses.
const IDENTITY_LOCK = [
  "- [고정] 외형 프롬프트는 위 문자열을 글자 그대로 복사해서 넣어. 단어 추가·삭제·동의어 교체·순서 변경·가중치 표기 변경·요약·압축 전부 금지야. 체크포인트 계열에 맞춘다는 이유로도, 상황과 안 어울려 보인다는 이유로도 이 블록만은 손대지 마.",
  "- 외형 블록 밖에서 머리(길이·색·가르마·앞머리·묶는 방식)·눈·눈썹·얼굴형·피부·체형에 관한 태그를 새로 만들어 넣지 마. 이미 고정 블록에 있는 내용이라 중복되면 서로 싸워서 얼굴이 흔들려.",
  "- 상황상 헤어스타일이나 몸매가 달라 보여야 할 것 같아도 고정 블록을 바꾸지 말고, 포즈·카메라 각도·조명·소품으로만 표현해.",
  "- 네가 실제로 구성하는 건 위에서 [교체]로 표시된 항목뿐이야. [고정]으로 표시된 건 지금 프롬프트에 있는 문자열을 그대로 유지해.",
  "- 교체 블록을 써넣을 때, 기준 프롬프트에 이미 있는 인물 수·상호작용 태그(1girl, 1boy, 1male, solo, interaction 등)를 다시 넣지 마. 중복되면 인물 수가 흔들려. 인물 구성이 바뀌어야 할 때는 기존 태그를 고쳐.",
];

// The character's own trained LoRA must survive the turn. It is already merged
// into the generator's lora list before the turn runs (and re-merged into the
// queued job), so this lock's job is to stop the model from patching it away
// or re-scaling it.
function characterLoraLock(character: PaimonCharacter): string[] {
  if (!character.loras?.length) return [];
  const list = character.loras
    .map((lora) => `${lora.path}(${lora.scale})`)
    .join(", ");
  const lines = [
    `- [고정] 캐릭터 LoRA: ${list} — 이 캐릭터 전용 학습 LoRA야. 이미 현재 생성 정보의 loras에 적용해 뒀어. paramsPatch에 loras를 넣게 되더라도 이 항목은 경로·스케일 그대로 반드시 포함하고, 빼거나 다른 LoRA로 대체하지 마.`,
  ];
  const triggers = characterTriggerTokens(character.loras);
  if (triggers.length > 0) {
    lines.push(
      `- [고정] 캐릭터 LoRA 트리거 워드: ${triggers.join(", ")} — 이 태그가 있어야 LoRA가 발동해. 프롬프트에 글자 그대로 반드시 포함하고(외형 [고정] 블록 바로 앞이 좋아), 바꿔 쓰거나 빼지 마.`
    );
  }
  return lines;
}

function buildInstruction(
  character: PaimonCharacter,
  situation: PaimonCharacter["situations"][number] | null,
  options?: PaimonComposeOptions
): string {
  const scope = options?.scope ?? FULL_COMPOSE_SCOPE;
  const base = options?.baseImage ?? character.mainImage;
  const baseLabel =
    options?.baseImage && options.baseImageLabel
      ? `선택한 기준 이미지(${options.baseImageLabel})`
      : options?.baseImage
        ? "선택한 기준 이미지"
        : "이 캐릭터의 메인 이미지";
  const situationName = situation?.name;
  const target = situationName
    ? `저장된 캐릭터 '${character.name}'를 '${situationName}' 상황으로 만들어줘.`
    : `저장된 캐릭터 '${character.name}'의 기본 모습으로 만들어줘.`;

  // A locked situation keeps the baseline's own pose and framing, so the
  // framing/proportion overrides only apply when this turn owns that segment.
  const framing = scope.situation
    ? fullBodyRequirements(situation?.prompt, base?.prompt)
    : [];

  if (!base) {
    const head = situationName
      ? `${target} 지금 설정된 모델·네거티브·이미지 크기는 그대로 두고, 그 상황의 의상·배경·상황 프롬프트를 캐릭터 정체성과 합쳐서 현재 모델에 맞게 프롬프트에 적용해줘.`
      : `${target} 지금 설정된 모델·네거티브·이미지 크기는 그대로 두고, 현재 모델에 맞게 프롬프트를 구성해줘.`;
    return [
      head,
      ...segmentBlock(character, situation, scope),
      "",
      "요구사항:",
      ...scopeRequirements(scope),
      ...IDENTITY_LOCK,
      ...characterLoraLock(character),
      ...framing,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const settings = [
    base.model_name ? `모델 ${base.model_name}` : "",
    base.loras?.length
      ? `LoRA ${base.loras
          .map((lora) => `${lora.path}(${lora.scale})`)
          .join(", ")}`
      : "",
    base.sampler_name
      ? `${base.sampler_name}${base.scheduler ? ` · ${base.scheduler}` : ""}`
      : "",
    typeof base.num_inference_steps === "number"
      ? `${base.num_inference_steps} steps`
      : "",
    typeof base.guidance_scale === "number" ? `CFG ${base.guidance_scale}` : "",
  ]
    .filter(Boolean)
    .join(" / ");

  return [
    target,
    "",
    `${baseLabel}의 메타데이터가 기준이야. 기준 프롬프트·네거티브·설정은 이미 현재 생성 정보에 그대로 불러와 뒀어 — 여기서 체크된 항목만 고쳐줘:`,
    `- 기준 프롬프트: ${clip(base.prompt) || "(없음)"}`,
    `- 기준 네거티브: ${clip(base.negative_prompt) || "(없음)"}`,
    settings ? `- 기준 설정: ${settings} — 이미 현재 생성 정보에 적용해 뒀어.` : "",
    ...segmentBlock(character, situation, scope),
    "",
    "요구사항:",
    ...scopeRequirements(scope),
    "- 기준 프롬프트의 양식을 최대한 그대로 유지해: 품질·스코어·레이팅 태그 블록과 그 위치, 태그 나열이냐 문장이냐, 태그 순서 관례, 가중치 표기 방식, 마지막 스타일·화질 태그까지 그대로 둬. 네 방식의 다른 템플릿으로 다시 쓰지 마.",
    "- 외형 블록의 위치도 기준 프롬프트에서 그 내용이 있던 자리 그대로 유지해. 자리만 유지하고 내용은 위 [고정] 문자열로 교체해.",
    ...IDENTITY_LOCK,
    ...characterLoraLock(character),
    scope.situation || scope.outfit || scope.background
      ? `- 기준 프롬프트에 남아 있는 이전 ${scopeLabel(scope)} 태그 중 이번에 교체하는 내용과 충돌하는 건 지워. 단 외형 태그와 [고정] 항목은 이 삭제 대상이 아니야 — 충돌해 보여도 남겨.`
      : "",
    "- 네거티브는 기준 네거티브를 출발점으로 이번 상황에 필요한 만큼만 조정해.",
    // Framing/proportion overrides come last so they win over "keep the
    // situation prompt as written" above.
    ...framing,
  ]
    .filter(Boolean)
    .join("\n");
}

export interface PaimonTurnOptions {
  // Replaces the library that would otherwise be read from /api/characters:
  // the picker already knows which character (and situation) the turn is about,
  // so nothing else has to be sent or even fetched.
  characterLibrary?: PaimonCharacter[];
  // Called the moment `paramsPatch` arrives — before the reply has finished
  // streaming — so a caller can queue the generation right away.
  onPatch?: (patch: Partial<GenerationParams>) => void;
}

export interface PaimonBatchProgress {
  done: number;
  total: number;
  current: string;
}

interface PaimonChatState {
  messages: PaimonChatMessage[];
  loading: boolean;
  status: string;
  error: string;
  // Non-null while a multi-situation run is composing + queueing. Lives here
  // (not in the panel) so the run keeps going after the page unmounts.
  batch: PaimonBatchProgress | null;

  setError: (error: string) => void;
  setLoading: (loading: boolean) => void;
  pushAssistantMessage: (content: string) => void;
  reset: () => void;
  // One Paimon turn. Resolves to the sanitized params patch, or null when the
  // turn failed, so callers can compose + generate off the result.
  runTurn: (
    content: string,
    attachments: PaimonAttachment[],
    options?: PaimonTurnOptions
  ) => Promise<Partial<GenerationParams> | null>;
  sendMessage: (content: string, attachments: PaimonAttachment[]) => void;
  composeSituation: (
    character: PaimonCharacter,
    situationId: string | undefined,
    generate: boolean,
    attachments: PaimonAttachment[],
    options?: PaimonComposeOptions
  ) => Promise<boolean>;
  runBatch: (
    character: PaimonCharacter,
    situationIds: string[],
    attachments: PaimonAttachment[],
    options?: PaimonComposeOptions
  ) => Promise<void>;
  cancelBatch: () => void;
}

// Module scope so the flag survives the panel unmounting mid-batch.
let batchCancelled = false;

export const usePaimonChatStore = create<PaimonChatState>((set, get) => ({
  messages: [PAIMON_INTRO_MESSAGE],
  loading: false,
  status: "",
  error: "",
  batch: null,

  setError: (error) => set({ error }),
  setLoading: (loading) => set({ loading }),

  pushAssistantMessage: (content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: crypto.randomUUID(), role: "assistant", content },
      ],
    })),

  reset: () => set({ messages: [PAIMON_INTRO_MESSAGE], error: "" }),

  runTurn: async (content, attachments, options) => {
    const trimmed = content.trim();
    if (!trimmed) return null;

    const params = useStore.getState().params;
    const userMessage: PaimonChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const compactMessages = get()
      .messages.filter((message) => message.id !== "intro")
      .slice(-10)
      .map(({ role, content: text }) => ({ role, content: text }));

    set((state) => ({
      messages: [...state.messages, userMessage],
      loading: true,
      status: "",
      error: "",
    }));

    const assistantId = crypto.randomUUID();
    let placeholderAdded = false;
    const ensurePlaceholder = () => {
      if (placeholderAdded) return;
      placeholderAdded = true;
      set((state) => ({
        messages: [
          ...state.messages,
          { id: assistantId, role: "assistant", content: "" },
        ],
      }));
    };
    const appendToAssistant = (text: string) => {
      ensurePlaceholder();
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + text }
            : message
        ),
      }));
    };
    const setAssistantContent = (text: string) => {
      ensurePlaceholder();
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: text } : message
        ),
      }));
    };

    try {
      const [modelContext, characterLibrary] = await Promise.all([
        loadModelContext(params),
        options?.characterLibrary ?? loadCharacterLibrary(),
      ]);
      const res = await fetch("/api/paimon/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentParams: params,
          modelContext,
          characterLibrary: libraryPayload(characterLibrary, trimmed),
          attachments: attachments.map((attachment, index) => ({
            ...attachment,
            referenceId: `참조${index + 1}`,
          })),
          messages: [...compactMessages, userMessage].map(
            ({ role, content: text }) => ({ role, content: text })
          ),
        }),
      });

      const contentType = res.headers.get("Content-Type") ?? "";

      // Non-streaming error responses (missing key, upstream failure) come back
      // as JSON.
      if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "파이몬 호출에 실패했습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";
      let done: {
        reply?: string;
        paramsPatch?: unknown;
        attachmentNotice?: string;
      } | null = null;
      let streamError = "";
      // The server forwards `paramsPatch` as soon as it closes, while the reply
      // is still being written. Applying it here (instead of at the end of the
      // turn) is what lets a situation start generating without waiting for the
      // rest of the answer.
      let earlyPatch: Partial<GenerationParams> | null = null;

      while (true) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;

          const eventLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("event:"));
          const dataLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("data:"));
          const event = eventLine?.slice("event:".length).trim() ?? "message";
          const payload = dataLine
            ? JSON.parse(dataLine.slice("data:".length).trim())
            : null;

          if (event === "status" && typeof payload?.message === "string") {
            set({ status: payload.message });
          } else if (event === "patch") {
            const patch = sanitizePatch(payload?.paramsPatch);
            if (!earlyPatch && Object.keys(patch).length > 0) {
              earlyPatch = patch;
              useStore.getState().setParams(patch);
              options?.onPatch?.(patch);
            }
          } else if (event === "delta" && typeof payload?.text === "string") {
            streamedText += payload.text;
            appendToAssistant(payload.text);
          } else if (event === "done") {
            done = payload;
          } else if (event === "error") {
            streamError = payload?.error || "파이몬 오류";
          }
        }
      }

      if (streamError) throw new Error(streamError);

      const finalPatch = sanitizePatch(done?.paramsPatch);
      // The streamed patch already landed; only re-apply if the completed JSON
      // carries something (a truncated stream can leave it empty).
      const patch =
        Object.keys(finalPatch).length > 0 ? finalPatch : earlyPatch ?? {};
      const applied = Object.keys(patch).length > 0;
      if (applied && patch !== earlyPatch) {
        useStore.getState().setParams(patch);
      }

      const finalContent =
        done?.reply ||
        streamedText ||
        done?.attachmentNotice ||
        (applied
          ? "요청을 반영해서 현재 생성 정보를 수정했어요."
          : "이번에는 반영할 내용을 만들지 못했어요. 조금 더 구체적으로 다시 요청해 주세요.");
      setAssistantContent(finalContent);
      return patch;
    } catch (err) {
      // Drop an empty placeholder so a failed turn doesn't leave a blank bubble.
      if (placeholderAdded) {
        set((state) => ({
          messages: state.messages.filter(
            (message) => !(message.id === assistantId && message.content === "")
          ),
        }));
      }
      set({ error: err instanceof Error ? err.message : "파이몬 오류" });
      return null;
    } finally {
      set({ loading: false, status: "" });
    }
  },

  sendMessage: (content, attachments) => {
    if (get().loading) return;
    void get().runTurn(content, attachments);
  },

  // Composes one character/situation into the prompt (via a Paimon turn) and,
  // when `generate` is set, enqueues it linked to that situation. Returns true
  // on a successful compose.
  composeSituation: async (
    character,
    situationId,
    generate,
    attachments,
    options
  ) => {
    const situation =
      character.situations.find((item) => item.id === situationId) ?? null;
    const scope = options?.scope ?? FULL_COMPOSE_SCOPE;
    // The baseline — the picked 기준 이미지, or the character's main image. Its
    // prompt, negative and model settings are loaded into the generator FIRST,
    // so the turn edits the reference's own prompt on the reference's own
    // checkpoint (and modelContext lists that checkpoint's LoRAs).
    const base = options?.baseImage ?? character.mainImage;
    // 캐릭터 LoRA rides on top of whatever the baseline (or the current params)
    // carry: the main image usually predates a character's trained LoRA, so the
    // baseline's own lora list alone would never apply it.
    const characterLoras = normalizeLoraList(character.loras);
    const triggerTokens = characterTriggerTokens(character.loras);
    if (base) {
      const basePatch = baseImageSettingsPatch(base);
      if (characterLoras.length > 0) {
        basePatch.loras = mergeCharacterLoras(basePatch.loras, characterLoras);
      }
      useStore.getState().setParams(basePatch);
    } else if (characterLoras.length > 0) {
      useStore.getState().setParams({
        loras: mergeCharacterLoras(
          useStore.getState().params.loras,
          characterLoras
        ),
      });
    }

    let queued = false;
    // Links the composed prompt to this character/situation and queues it. Runs
    // on the streamed patch (well before the reply finishes) and again on the
    // completed turn, so whichever arrives first starts the render exactly once.
    const linkAndQueue = async (patch: Partial<GenerationParams>) => {
      const merged = { ...useStore.getState().params, ...patch };
      // Re-assert the character LoRA over the turn's patch: even if the model
      // ignored the lock and rewrote `loras`, the queued job keeps it.
      if (characterLoras.length > 0) {
        merged.loras = mergeCharacterLoras(merged.loras, characterLoras);
        useStore.getState().setParams({ loras: merged.loras });
      }
      // Same guarantee for the LoRA's trigger words: the lock asks the model to
      // place them, and any it dropped are appended here so the queued prompt
      // always activates the LoRA.
      if (triggerTokens.length > 0 && merged.prompt.trim()) {
        const ensured = ensureTriggerWords(merged.prompt, triggerTokens);
        if (ensured !== merged.prompt) {
          merged.prompt = ensured;
          useStore.getState().setParams({ prompt: ensured });
        }
      }
      const queue = useGenerationQueueStore.getState();
      queue.setCharacterContext({
        characterId: character.id,
        situationId: situation?.id,
        prompt: merged.prompt,
      });
      if (queued || !generate || !merged.prompt.trim()) return;
      queued = true;
      await queue.enqueue(merged, {
        characterId: character.id,
        situationId: situation?.id,
      });
    };

    // Nothing checked: the baseline itself is the answer. Load it and queue it
    // verbatim — no turn to run, since there is no segment to rewrite.
    if (!scope.outfit && !scope.background && !scope.situation) {
      if (!base) {
        set({
          error:
            "기준 이미지가 없어서 불러올 게 없어요. 의상·배경·상황 중 하나를 체크하거나 기준 이미지를 골라 주세요.",
        });
        return false;
      }
      await linkAndQueue({});
      get().pushAssistantMessage(
        generate
          ? "기준 이미지의 프롬프트·네거티브·설정을 그대로 불러와서 생성 큐에 넣었어요. (교체 항목 없음)"
          : "기준 이미지의 프롬프트·네거티브·설정을 그대로 불러왔어요. (교체 항목 없음)"
      );
      return true;
    }

    const patch = await get().runTurn(
      buildInstruction(character, situation, options),
      attachments,
      {
        // Only this character (and only the situation being composed) is
        // relevant, so the whole library never has to be sent or fetched.
        characterLibrary: [
          {
            ...character,
            mainImage: base,
            situations: situation ? [situation] : [],
          },
        ],
        onPatch: (early) => {
          void linkAndQueue(early);
        },
      }
    );
    if (!patch) return false;

    await linkAndQueue(patch);
    return true;
  },

  // Compose + queue each picked situation in order. Each one is prompted,
  // queued, then the next — until all are queued or the user cancels. The loop
  // runs outside React, so leaving the generator page never interrupts it.
  runBatch: async (character, situationIds, attachments, options) => {
    const chosen = character.situations.filter((situation) =>
      situationIds.includes(situation.id)
    );
    if (chosen.length === 0 || get().batch) return;

    batchCancelled = false;

    for (let i = 0; i < chosen.length; i += 1) {
      if (batchCancelled) break;
      set({
        batch: {
          done: i,
          total: chosen.length,
          current: chosen[i].name || "이름 없음",
        },
      });
      // Intentional serial await: compose+queue one situation before the next.
      await get().composeSituation(
        character,
        chosen[i].id,
        true,
        attachments,
        options
      );
    }

    set({ batch: null });
  },

  cancelBatch: () => {
    batchCancelled = true;
  },
}));
