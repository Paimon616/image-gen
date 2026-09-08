// Consistency sheet (일관성 시트) shared types + helpers.
//
// The consistency sheet screen generates character / background reference
// sheets with GPT-Image-2 so later image/video generations can keep the same
// identity and the same location. It goes through OpenRouter's dedicated image
// endpoint server-side with the OpenRouter key from Settings (or
// OPENROUTER_API_KEY):
//   POST https://openrouter.ai/api/v1/images  { model, prompt, n,
//        aspect_ratio, quality, input_references[] }
// One JSON call covers both cases — references ride along as data URLs in
// input_references (up to 16), so there is no separate edits/multipart path.
//
// Note: OpenRouter's image API exposes no `size`, only `aspect_ratio` +
// `quality`. That is why the sheet has quality tiers instead of the 1K/2K/4K
// pixel tiers the OpenAI-direct endpoint allowed.

export type ConsistencySheetMode = "character" | "background";

export type ConsistencySheetQuality = "low" | "medium" | "high";

export const CONSISTENCY_SHEET_QUALITIES: ConsistencySheetQuality[] = [
  "low",
  "medium",
  "high",
];

// The sheet is always square: a turnaround row plus a face row (character) or a
// 2x2 angle grid (background) both read best in 1:1.
export const CONSISTENCY_SHEET_ASPECT_RATIO = "1:1";

// GPT-Image-2's input_references limit.
export const CONSISTENCY_SHEET_MAX_REFERENCES = 16;

export interface ConsistencySheetParams {
  mode: ConsistencySheetMode;
  prompt: string;
  quality: ConsistencySheetQuality;
  // Data URIs (data:image/...;base64,...) — reference images from the gallery,
  // a file drop, or the clipboard.
  references: string[];
  // Workspace the finished sheet is filed under. Empty means "no workspace",
  // which is how the sheet gallery treats an unassigned file.
  workspaceId: string;
}

export const DEFAULT_CONSISTENCY_SHEET_PARAMS: ConsistencySheetParams = {
  mode: "character",
  prompt: "",
  quality: "high",
  references: [],
  workspaceId: "",
};

// The sheet layout each mode asks for. The user's own description leads the
// final prompt (never truncate the user's words in favor of the template).
const CHARACTER_SHEET_TEMPLATE = [
  "Character consistency reference sheet, one single character, identity kept",
  "exactly consistent with the reference images in every view.",
  "Layout on one sheet: a full-body turnaround — front view, side view, back",
  "view — standing in the same neutral pose, plus a row of four face studies:",
  "neutral expression, soft smile, wide laughing smile, frowning face.",
  "Same outfit, same hairstyle and same proportions in every view.",
  "Plain solid white background only — no scenery, no props, no other people,",
  "no text, no labels, no watermark. Even neutral studio lighting.",
].join(" ");

const BACKGROUND_SHEET_TEMPLATE = [
  "Background consistency reference sheet: the exact same single location",
  "shown from four different camera angles, arranged as a clean 2x2 grid on",
  "one sheet — a wide establishing shot, the reverse opposite angle, and two",
  "contrasting side or high/low angles.",
  "Identical layout, lighting, time of day, weather and props in all four",
  "panels so they clearly read as one place.",
  "No people, no characters, no text, no labels, no watermark.",
].join(" ");

/** User description first, then the mode's sheet-layout instructions. */
export function buildConsistencySheetPrompt(params: ConsistencySheetParams): string {
  const template =
    params.mode === "character"
      ? CHARACTER_SHEET_TEMPLATE
      : BACKGROUND_SHEET_TEMPLATE;
  const base = params.prompt.trim();
  return base ? `${base}\n\n${template}` : template;
}

export interface ConsistencySheetImage {
  id: string;
  url: string;
  filename: string;
  timestamp: number;
  contentType: string;
  prompt: string;
  params: {
    mode: ConsistencySheetMode;
    prompt: string;
    quality: ConsistencySheetQuality;
    aspectRatio: string;
    referenceCount: number;
  } | null;
  // Workspace ids the file belongs to. Membership lives in workspaces.json —
  // never in the sidecar — so this rides along with the list response.
  workspaces?: string[];
  // Client-only, present while queued / generating / errored.
  status?: ConsistencySheetStatus;
}

export interface ConsistencySheetStatus {
  state: "queued" | "generating" | "completed" | "canceled" | "error";
  progress: number; // 0..1
  message: string;
}
