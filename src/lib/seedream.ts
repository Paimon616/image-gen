// Seedream (BytePlus ModelArk) — the image sibling of the SeeDance video model.
// It runs on the same ModelArk account, so the credentials are the SeeDance
// ones (`SEEDANCE_API_KEY` / `SEEDANCE_BASE_URL`); only the endpoint path and
// the model id differ:
//
//   POST {base}/images/generations
//   { model, prompt, image?: string[], size, response_format: "url", watermark }
//
// Everything provider-specific lives in this file and in `seedream-server.ts`,
// so a renamed model or a changed request shape is a one-file edit.
//
// The three models below are the ones this account actually has access to —
// probed on 2026-10-21 with deliberately incomplete requests (a missing
// parameter answers "which model exists?" without paying for a render). Their
// limits differ, and the differences are not cosmetic: pro takes fewer
// reference images than the other two and refuses the 3k/4k presets outright.

import type { GeneratedImage } from "./types";

export type SeedreamModelId = "5.0-lite" | "5.0-pro" | "4.0";

/** A square pixel budget, used to turn an aspect ratio into WIDTHxHEIGHT. */
export type SeedreamTier = "1k" | "2k" | "3k" | "4k";

export interface SeedreamModelInfo {
  id: SeedreamModelId;
  /** ModelArk model id, sent as the request's `model` field. */
  arkModel: string;
  label: string;
  /**
   * ModelArk's own ceiling: "number of reference images cannot exceed N".
   * Measured per model — pro stops at 10 where the other two take 14.
   */
  maxReferences: number;
  /**
   * The `size` presets this model accepts. pro rejects anything above 2k with
   * "must be 'WIDTHxHEIGHT' or a supported size preset", so the tier buttons
   * have to follow the selected model.
   */
  tiers: SeedreamTier[];
  /**
   * Accepted total pixel count for an explicit WIDTHxHEIGHT. pro's pair is
   * measured ("image area must be at least 921600 pixels" / "at most 4624220");
   * lite and 4.0 validate the reference images first, so theirs are the bounds
   * the earlier Seedream integration recorded from live rejections.
   */
  minPixels: number;
  maxPixels: number;
}

export const SEEDREAM_MODELS: readonly SeedreamModelInfo[] = [
  {
    id: "5.0-lite",
    arkModel: "seedream-5-0-lite-260128",
    label: "Seedream 5.0 Lite",
    maxReferences: 14,
    tiers: ["2k", "3k", "4k"],
    minPixels: 3_686_400,
    maxPixels: 16_777_216,
  },
  {
    id: "5.0-pro",
    // pro carries a vendor prefix and a different date — neither id can be
    // derived from the other, so both are spelled out.
    arkModel: "dola-seedream-5-0-pro-260628",
    label: "Seedream 5.0 Pro",
    maxReferences: 10,
    tiers: ["1k", "2k"],
    minPixels: 921_600,
    maxPixels: 4_624_220,
  },
  {
    id: "4.0",
    arkModel: "seedream-4-0-250828",
    label: "Seedream 4.0",
    maxReferences: 14,
    tiers: ["2k", "3k", "4k"],
    minPixels: 3_686_400,
    maxPixels: 16_777_216,
  },
];

export const DEFAULT_SEEDREAM_MODEL: SeedreamModelId = "5.0-pro";

/** Falls back to the first entry, so images saved before a model id changed still load. */
export function resolveSeedreamModel(id: unknown): SeedreamModelInfo {
  return (
    SEEDREAM_MODELS.find((model) => model.id === id) ??
    SEEDREAM_MODELS.find((model) => model.id === DEFAULT_SEEDREAM_MODEL) ??
    SEEDREAM_MODELS[0]
  );
}

/** The tier a model actually accepts, nearest to the one asked for. */
export function resolveSeedreamTier(
  model: SeedreamModelInfo,
  tier: unknown
): SeedreamTier {
  if (model.tiers.includes(tier as SeedreamTier)) return tier as SeedreamTier;
  // Step down rather than up: a model that refuses 4k should land on its own
  // largest tier, not on its smallest.
  return model.tiers[model.tiers.length - 1];
}

export const SEEDREAM_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
] as const;

export type SeedreamAspectRatio = (typeof SEEDREAM_ASPECT_RATIOS)[number];

// Portrait, matching what the rest of the app generates.
export const DEFAULT_SEEDREAM_ASPECT_RATIO: SeedreamAspectRatio = "3:4";

export function resolveSeedreamAspectRatio(value: unknown): SeedreamAspectRatio {
  return SEEDREAM_ASPECT_RATIOS.includes(value as SeedreamAspectRatio)
    ? (value as SeedreamAspectRatio)
    : DEFAULT_SEEDREAM_ASPECT_RATIO;
}

// The square side each tier stands for. The preset names are what ModelArk
// accepts verbatim; the numbers are the pixel budget an explicit WIDTHxHEIGHT
// is scaled to when a non-square ratio is asked for.
const TIER_SIDE: Record<SeedreamTier, number> = {
  "1k": 1024,
  "2k": 2048,
  "3k": 3072,
  "4k": 4096,
};

// Sides stay inside the largest square the API takes and on a multiple of 16 —
// the usual latent-friendly step for diffusion models.
const MAX_SIDE = 4096;
const STEP = 16;

/**
 * `WIDTHxHEIGHT` for an aspect ratio at the tier's pixel budget, kept inside
 * the model's accepted pixel range. Falls back to the bare preset when no
 * in-range box matches the ratio — a square render beats a rejected request.
 */
export function seedreamSize(
  model: SeedreamModelInfo,
  tier: SeedreamTier,
  ratio: SeedreamAspectRatio
): string {
  const [rw, rh] = ratio.split(":").map(Number);
  if (!rw || !rh) return tier;

  const budget = TIER_SIDE[tier] * TIER_SIDE[tier];
  const scale = Math.min(
    Math.sqrt(budget / (rw * rh)),
    MAX_SIDE / rw,
    MAX_SIDE / rh
  );
  const width = Math.round((rw * scale) / STEP) * STEP;
  const height = Math.round((rh * scale) / STEP) * STEP;

  const pixels = width * height;
  if (pixels < model.minPixels || pixels > model.maxPixels) return tier;
  return `${width}x${height}`;
}

/** "2048x2048" style label for the tier buttons. */
export function seedreamSizeLabel(
  model: SeedreamModelInfo,
  tier: SeedreamTier,
  ratio: SeedreamAspectRatio
): string {
  const size = seedreamSize(model, tier, ratio);
  return size === tier ? `${TIER_SIDE[tier]}x${TIER_SIDE[tier]}` : size;
}

// No length rejection was observed up to 12,000 characters, so this is a sanity
// bound rather than ModelArk's limit. (The previous integration truncated at
// 1,500 and quietly cut long booru-style prompts in half.)
export const SEEDREAM_MAX_PROMPT_CHARS = 12_000;

export interface SeedreamParams {
  model: SeedreamModelId;
  prompt: string;
  tier: SeedreamTier;
  ratio: SeedreamAspectRatio;
  /**
   * Data URIs (data:image/...;base64,...). All of them go up in one flat
   * `image` array — ModelArk has no per-subject role here — so the order is
   * only what the prompt can refer to.
   */
  references: string[];
  /** ModelArk burns its own mark into the render unless this is off. */
  watermark: boolean;
  /**
   * Workspace the finished image is filed under. Empty means "no workspace",
   * which the gallery treats as unassigned.
   */
  workspaceId: string;
}

export const DEFAULT_SEEDREAM_PARAMS: SeedreamParams = {
  model: DEFAULT_SEEDREAM_MODEL,
  prompt: "",
  tier: "2k",
  ratio: DEFAULT_SEEDREAM_ASPECT_RATIO,
  references: [],
  watermark: false,
  workspaceId: "",
};

export interface SeedreamRequest {
  model: string;
  prompt: string;
  /**
   * Reference images. Omitted entirely for text-to-image — ModelArk rejects an
   * empty `image` rather than ignoring it, so the field has to be absent.
   */
  image?: string[];
  /** A preset (`2k`) or an explicit `WIDTHxHEIGHT`. */
  size: string;
  watermark: boolean;
}

export function buildSeedreamBody(request: SeedreamRequest) {
  return {
    model: request.model,
    prompt: request.prompt,
    ...(request.image && request.image.length > 0
      ? { image: request.image }
      : {}),
    size: request.size,
    response_format: "url",
    watermark: request.watermark,
  };
}

// ModelArk answers with `{ data: [{ url }] }`, but has also been seen returning
// a bare `url` / `image_url`. Accept any of them rather than failing on a shape
// difference after the image was already billed.
export function extractSeedreamImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const first = Array.isArray(record.data) ? record.data[0] : null;
  if (first && typeof first === "object") {
    const entry = first as Record<string, unknown>;
    if (typeof entry.url === "string") return entry.url;
    if (typeof entry.image_url === "string") return entry.image_url;
  }
  if (typeof record.url === "string") return record.url;

  return null;
}

// Same shape ModelArk uses on the video side: `{ error: { code, message } }`,
// occasionally a top-level `message`. The trailing "Request id: …" is kept —
// it is what a support ticket needs, and it decodes to the call's timestamp.
export function seedreamErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
    const message = (payload as { message?: string }).message;
    if (message) return message;
  }
  return fallback;
}

export interface SeedreamStatus {
  state: "queued" | "generating" | "saving" | "completed" | "canceled" | "error";
  progress: number; // 0..1
  message: string;
}

/**
 * A Seedream render. The finished file is an ordinary gallery image — it lands
 * in `output/` with the same sidecar every other generation writes — so the
 * screen's result list is `GeneratedImage` plus the in-flight status.
 */
export interface SeedreamImage extends GeneratedImage {
  status?: SeedreamStatus;
  /** Shown on the pending card before there is a file to show. */
  pendingPrompt?: string;
}
