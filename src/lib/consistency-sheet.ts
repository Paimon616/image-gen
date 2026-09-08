// Consistency sheet (일관성 시트) shared types + helpers.
//
// The consistency sheet screen generates character / background reference
// sheets with OpenAI GPT-Image-2 so later image/video generations can keep the
// same identity and the same location. It talks to the OpenAI Images API
// server-side with the OpenAI key from Settings (or OPENAI_API_KEY):
//   - with reference images →  POST /v1/images/edits   (multipart, image[] × up to 16)
//   - without references    →  POST /v1/images/generations (JSON)
// GPT-Image-2 accepts arbitrary sizes (both sides divisible by 16, aspect
// between 1:3 and 3:1, total pixels 655,360‥8,294,400), so the fixed 1:1
// sheet comes out square in every tier below.

export type ConsistencySheetMode = "character" | "background";

export type ConsistencySheetResolution = "1k" | "2k" | "4k";

// Exact 1:1 sizes per tier. 2880x2880 (8,294,400 px) is the API's pixel
// ceiling — the largest square it accepts — and OpenAI marks anything past
// 2560x1440 as experimental, so the UI says so next to the 4K option.
export const CONSISTENCY_SHEET_SIZES: Record<ConsistencySheetResolution, string> = {
  "1k": "1024x1024",
  "2k": "2048x2048",
  "4k": "2880x2880",
};

export const CONSISTENCY_SHEET_RESOLUTIONS: ConsistencySheetResolution[] = [
  "1k",
  "2k",
  "4k",
];

// GPT-Image-2's images/edits limit.
export const CONSISTENCY_SHEET_MAX_REFERENCES = 16;

export interface ConsistencySheetParams {
  mode: ConsistencySheetMode;
  prompt: string;
  resolution: ConsistencySheetResolution;
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
  resolution: "1k",
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
    resolution: ConsistencySheetResolution;
    size: string;
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
