// Consistency sheet (일관성 시트) shared types + helpers.
//
// The consistency sheet screen generates character / background reference
// sheets so later image/video generations can keep the same identity and the
// same location. It runs GPT-Image-2 through fal.ai server-side with FAL_KEY,
// on fal's queue API:
//   POST https://queue.fal.run/openai/gpt-image-2/edit   (with references)
//   POST https://queue.fal.run/openai/gpt-image-2        (prompt only)
// with `Authorization: Key <FAL_KEY>`, then poll the returned status_url and
// read the render from the returned response_url ({ images: [{ url, … }] }).
//
// Why fal and not OpenRouter: OpenRouter's dedicated /api/v1/images endpoint
// routes OpenAI models through the account's own OpenAI integration key, which
// this account's key is rejected on, and its chat-completions fallback ignores
// any size hint (every render comes back 1024x1024). fal exposes the real
// gpt-image-2 parameters, so the resolution tiers below actually take effect.
//
// fal's edit schema caps `image_urls` at 16 items, and gpt-image-2 accepts a
// concrete { width, height } as long as both sides are multiples of 16, the
// longest edge is ≤ 3840 and the total is 655,360‥8,294,400 pixels.

// The two sheet modes lay panels out on one square page; `scene` is not a sheet
// at all but a single vertical still, composed from a character sheet and a
// background sheet.
export type ConsistencySheetMode = "character" | "background" | "scene";

export type ConsistencySheetResolution = "1k" | "2k" | "4k";

export interface ConsistencySheetSize {
  width: number;
  height: number;
}

// Exact 1:1 sizes per tier. 2880x2880 (8,294,400 px) is the pixel ceiling —
// the largest square gpt-image-2 accepts — so it stands in for "4K" here.
const SHEET_SIZES: Record<ConsistencySheetResolution, ConsistencySheetSize> = {
  "1k": { width: 1024, height: 1024 },
  "2k": { width: 2048, height: 2048 },
  "4k": { width: 2880, height: 2880 },
};

// Exact 9:16 for scene stills. Every side is a multiple of 16 and 2160x3840
// lands exactly on both ceilings (3840 longest edge, 8,294,400 pixels), so it
// is the largest 9:16 frame gpt-image-2 will take.
const SCENE_SIZES: Record<ConsistencySheetResolution, ConsistencySheetSize> = {
  "1k": { width: 1008, height: 1792 },
  "2k": { width: 1440, height: 2560 },
  "4k": { width: 2160, height: 3840 },
};

export const CONSISTENCY_SHEET_RESOLUTIONS: ConsistencySheetResolution[] = [
  "1k",
  "2k",
  "4k",
];

export function consistencySheetSize(
  mode: ConsistencySheetMode,
  resolution: ConsistencySheetResolution
): ConsistencySheetSize {
  return mode === "scene" ? SCENE_SIZES[resolution] : SHEET_SIZES[resolution];
}

export function consistencySheetSizeLabel(
  mode: ConsistencySheetMode,
  resolution: ConsistencySheetResolution
): string {
  const { width, height } = consistencySheetSize(mode, resolution);
  return `${width}x${height}`;
}

// fal's `image_urls` limit for the gpt-image-2 edit endpoint.
export const CONSISTENCY_SHEET_MAX_REFERENCES = 16;

export interface ConsistencySheetParams {
  mode: ConsistencySheetMode;
  prompt: string;
  resolution: ConsistencySheetResolution;
  // Data URIs (data:image/...;base64,...) — reference images from the gallery,
  // a file drop, or the clipboard. Used by the two sheet modes.
  references: string[];
  // Scene mode's three slots. They go on the wire in the same `image_urls`
  // array as everything else — the model has no per-subject role — so the slots
  // exist to fix the send order and to let the prompt say which is which.
  characterReference: string | null;
  // Optional. When filled, the outfit comes from here instead of from whatever
  // the character reference happens to be wearing.
  outfitReference: string | null;
  backgroundReference: string | null;
  // Workspace the finished sheet is filed under. Empty means "no workspace",
  // which is how the sheet gallery treats an unassigned file.
  workspaceId: string;
}

export const DEFAULT_CONSISTENCY_SHEET_PARAMS: ConsistencySheetParams = {
  mode: "character",
  prompt: "",
  resolution: "1k",
  references: [],
  characterReference: null,
  outfitReference: null,
  backgroundReference: null,
  workspaceId: "",
};

/** The images actually sent, in the order the prompt numbers them. */
export function consistencySheetReferences(
  params: ConsistencySheetParams
): string[] {
  if (params.mode !== "scene") return params.references;
  return [
    params.characterReference,
    params.outfitReference,
    params.backgroundReference,
  ].filter((ref): ref is string => Boolean(ref));
}

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

// The background mode kept drifting into "four similar places" — each panel
// redesigned the openings, the scenery and the object layout. So the template
// states the one-location rule first and spells out what must be
// pixel-identical, before it describes the four viewpoints.
// It must stay indoor/outdoor agnostic: the description alone decides whether
// the location is an interior or an exterior. An earlier version said "room",
// "inside it", "window and door" and "furniture", which pushed every sheet
// indoors even when the description asked for a street or a beach.
const BACKGROUND_SHEET_TEMPLATE = [
  "Background consistency reference sheet for ONE single location.",
  "The description alone decides what kind of place it is — an interior, an",
  "exterior, or anything in between. Do not turn an outdoor location into an",
  "indoor one or add walls, a ceiling or a roof that the description does not",
  "ask for, and do not move an indoor location outside.",
  "This is one real place photographed four times: only the camera moves,",
  "nothing else changes. All four panels must be unmistakably the same place,",
  "not four similar places and not four design variations.",
  "Keep identical across all four panels: the layout and scale of the place,",
  "the number, shape and position of every structure, opening and landmark,",
  "every object, plant and detail in the same place, the same materials,",
  "colours, textures and wear, and the same time of day, weather, light",
  "direction and colour temperature.",
  "Do not add, remove, move, resize or redesign anything between panels.",
  "Layout: a clean 2x2 grid on one sheet, four different camera positions of",
  "that one place — top-left a wide establishing shot of the whole place,",
  "top-right the reverse angle from the opposite side of that same place,",
  "bottom-left a side angle, bottom-right a closer detail view of something",
  "already visible in the wide shot.",
  "Empty location only: no people, no characters, no animals, no text, no",
  "labels, no panel borders, no watermark.",
].join(" ");

// Scene mode renders the user's prompt as one photograph instead of a sheet.
// The sheets it is given are reference material, so the template has to say so
// explicitly — otherwise the model copies the turnaround grid straight through.
// It names no art style: the look comes from the references.
// What each subject must carry over lives in the per-slot labels below, not
// here, because an outfit reference moves the clothes out of the character's
// column — so this only states the format and the placement.
const SCENE_TEMPLATE = [
  "A single vertical 9:16 image of one moment — one photograph, not a",
  "reference sheet: no grid, no panels, no multiple views, no split frames.",
  "The reference images are consistency material, not a layout to copy.",
  "Keep every referenced subject exactly as its reference shows it, and place",
  "the character inside the location as the description says, framed for a",
  "vertical 9:16 composition.",
  "No text, no captions, no labels, no watermark.",
].join(" ");

// Every reference goes up in one flat array, so naming them in the prompt is
// the only way to tell the model which sheet is which. The numbering has to
// follow the order in consistencySheetReferences.
const SCENE_REFERENCE_LABELS = {
  character:
    "the character to depict — keep the same face, hair, body proportions and outfit",
  // Used instead of the line above once an outfit reference is present: the
  // clothes in the character sheet must be ignored, or the model blends the two.
  characterWithoutOutfit:
    "the character to depict — keep the same face, hair and body proportions, but ignore the clothes it is wearing",
  outfit:
    "the outfit the character wears — copy the garment shapes, cut, colours, fabric, patterns and accessories exactly, and ignore the person wearing them in this reference",
  background:
    "the location to place them in — keep the same architecture, furniture, props and lighting",
} as const;

/** "Reference image 1 is …; reference image 2 is …" for the filled slots. */
function buildSceneReferenceClause(params: ConsistencySheetParams): string {
  const labels: string[] = [];
  if (params.characterReference) {
    labels.push(
      params.outfitReference
        ? SCENE_REFERENCE_LABELS.characterWithoutOutfit
        : SCENE_REFERENCE_LABELS.character
    );
  }
  if (params.outfitReference) labels.push(SCENE_REFERENCE_LABELS.outfit);
  if (params.backgroundReference) labels.push(SCENE_REFERENCE_LABELS.background);
  return labels
    .map((label, i) => `Reference image ${i + 1} is ${label}.`)
    .join(" ");
}

/** User description first, then the mode's layout instructions. */
export function buildConsistencySheetPrompt(params: ConsistencySheetParams): string {
  const template =
    params.mode === "character"
      ? CHARACTER_SHEET_TEMPLATE
      : params.mode === "background"
        ? BACKGROUND_SHEET_TEMPLATE
        : [buildSceneReferenceClause(params), SCENE_TEMPLATE]
            .filter(Boolean)
            .join(" ");
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
    // Sheets saved before the resolution tiers existed have no size fields.
    resolution?: ConsistencySheetResolution;
    size?: string;
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
