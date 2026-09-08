// Consistency sheet (일관성 시트) shared types + helpers.
//
// The consistency sheet screen generates character / background reference
// sheets so later image/video generations can keep the same identity and the
// same location. It goes through OpenRouter server-side with the OpenRouter key
// from Settings (or OPENROUTER_API_KEY), on the chat-completions path:
//   POST https://openrouter.ai/api/v1/chat/completions
//        { model, messages, modalities: ["image", "text"] }
// The reference images ride along as image_url content parts in the single user
// message, and the render comes back as message.images[].image_url.url.
//
// Why not OpenRouter's dedicated /api/v1/images endpoint (which is where
// `openai/gpt-image-2` lives): for OpenAI models it routes through the account's
// own OpenAI integration key, and this account's stored key is rejected. The
// chat-completions path uses OpenRouter's own OpenAI credentials and works.
//
// Neither path exposes a size: the render always comes back 1024x1024, which is
// the square the sheet layouts want anyway. `image_config` is accepted but
// ignored here (a 16:9 request still returns 1024x1024), so there is no
// resolution, aspect-ratio or quality knob to offer.

export type ConsistencySheetMode = "character" | "background";

// The model's input-image limit.
export const CONSISTENCY_SHEET_MAX_REFERENCES = 16;

export interface ConsistencySheetParams {
  mode: ConsistencySheetMode;
  prompt: string;
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

// The background mode kept drifting into "four similar rooms" — each panel
// redesigned the windows, the wall art and the furniture layout. So the
// template now states the one-location rule first and spells out what must be
// pixel-identical, before it describes the four viewpoints.
const BACKGROUND_SHEET_TEMPLATE = [
  "Background consistency reference sheet for ONE single location.",
  "This is one real place photographed four times: the camera moves around",
  "inside it, nothing else changes. All four panels must be unmistakably the",
  "same room, not four similar rooms and not four design variations.",
  "Keep identical across all four panels: the architecture and floor plan, the",
  "number, shape and position of every window and door, every piece of",
  "furniture in the same place, every prop, picture, plant and decoration in",
  "the same place, the same materials, colours, textures and wear, and the same",
  "time of day, weather, light direction and colour temperature.",
  "Do not add, remove, move, resize or redesign anything between panels.",
  "Layout: a clean 2x2 grid on one sheet, four different camera positions of",
  "that one place — top-left a wide establishing shot of the whole space,",
  "top-right the reverse angle from the opposite side of the same room,",
  "bottom-left a side angle, bottom-right a closer detail view of a corner",
  "already visible in the wide shot.",
  "Empty location only: no people, no characters, no animals, no text, no",
  "labels, no panel borders, no watermark.",
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
    model: string;
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
