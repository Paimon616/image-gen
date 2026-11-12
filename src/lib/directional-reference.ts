// 방향별 참조: per-image references picked from a linked character sheet, by
// the direction the shot faces. Shared by the varied batch (each shot knows
// its view) and a plain Generate (the view is read from the prompt).
//
// The two families take references through different nodes:
//  - Krea 2: Identity Edit on character_image (the whole look — face, hair,
//    outfit, style), plus character_face_image for a second, face-only image.
//  - SDXL / Illustrious: character_image is PuLID (face identity only, needs a
//    visible face), and identity_reference_image is IP-Adapter (the whole
//    image through CLIP vision — works for a back view, which has no face).
// Z-Image / Anima have no reference path in this app.
//
// Pure module (no React, no fetch): node --test covers it.

import type { GenerationParams } from "./types.ts";
import { directionalReference, type VariationView } from "./reference-variations.ts";

export type DirectionalFamily = "krea2" | "sdxl" | "none";

/** Views cut from a character sheet (/api/reference-set). Absolute URLs. */
export interface DirectionalSheetViews {
  front: string | null;
  side: string | null;
  back: string | null;
  face: string | null;
}

/** Client-side guess from the checkpoint name (the server resolves catalogs). */
export function directionalFamily(modelName: string): DirectionalFamily {
  const name = modelName.toLowerCase();
  if (/krea[-_ ]?2/.test(name)) return "krea2";
  if (/z[-_ ]?image|anima|flux|wan/.test(name)) return "none";
  return name.trim() ? "sdxl" : "none";
}

/**
 * Which way the shot faces, from the prompt (English tags or sentences, and
 * the Korean words people type). Default: front.
 */
export function classifyPromptView(prompt: string): VariationView {
  const text = prompt.toLowerCase();
  const behind =
    /\bfrom behind\b|\bback view\b|\bfacing away\b|\bseen from behind\b|\bher back faces\b|\bhis back faces\b|뒷모습|뒤에서/.test(
      text
    );
  const turned =
    /\blook(s|ing)? back\b|\bover (her|his|the) (right |left )?shoulder\b|\blooking at (the )?viewer\b|\btoward the (camera|viewer)\b|\bturns (her|his) (face|head)\b|돌아보/.test(
      text
    );
  if (behind) return turned ? "back_face" : "back";
  const side = /\bfrom side\b|\bside view\b|\bprofile\b|\bseen from the side\b|옆모습|측면/.test(text);
  if (side) return /\blooking at viewer\b|\bturns (her|his) (face|head)\b/.test(text) ? "side_face" : "side";
  return "front";
}

// SDXL per view, evaluated 2026-11-12 on Hassaku XL (sheet crops, seed 777,
// PuLID face 0.7, IP-Adapter view at 0.6 / 0.45):
//  - IP-Adapter pins the sheet's neutral standing pose and framing. On a front
//    shot it copied the sheet's plain backdrop and killed the scene pose, and
//    on a looking-back shot it turned the figure fully away (no face).
//  - On a back view with the face hidden it is the only thing that keeps the
//    back of the hair (teal inner layer), the pants and the shoes right.
//  - On a side view it also pins the sheet's plain backdrop: re-tested in the
//    web UI (autumn park, same seed) at 0.45 / 0.3 / 0.2 / 0.15, every one
//    dropped the park for a blank wall; PuLID alone kept the park and still got
//    the teal inner hair and the outfit right.
// So: IP-Adapter only for a back view with the face hidden (0.6, no PuLID);
// every view with a face → PuLID face only.
export const SDXL_FACE_PULID_STRENGTH = 0.7;
const SDXL_VIEW_RULES: Record<
  VariationView,
  { view: "front" | "side" | "back" | null; ipadapter: number; face: boolean }
> = {
  front: { view: null, ipadapter: 0, face: true },
  side: { view: null, ipadapter: 0, face: true },
  side_face: { view: null, ipadapter: 0, face: true },
  back: { view: "back", ipadapter: 0.6, face: false },
  back_face: { view: null, ipadapter: 0, face: true },
};
export const SDXL_VIEW_IPADAPTER_STRENGTH = SDXL_VIEW_RULES.back.ipadapter;

export type DirectionalParams = Pick<
  GenerationParams,
  "character_image"
> &
  Partial<
    Pick<
      GenerationParams,
      | "character_face_image"
      | "character_reference_view"
      | "identity_reference_image"
      | "identity_reference_strength"
      | "character_reference_strength"
    >
  >;

/**
 * The reference params for one image. `screenReference` is the character
 * reference already on screen: it stays the front reference for Krea (the
 * user picked it and it carries the style) and the face for SDXL when the
 * sheet has no face crop. Returns null when the family takes no references.
 */
export function directionalParams(
  view: VariationView,
  sheet: DirectionalSheetViews,
  family: DirectionalFamily,
  screenReference: string | null
): DirectionalParams | null {
  if (family === "krea2") {
    const front = screenReference || sheet.front;
    if (!front) return null;
    return {
      ...directionalReference(view, {
        front,
        side: sheet.side,
        back: sheet.back,
        face: sheet.face,
      }),
      identity_reference_image: null,
    };
  }
  if (family === "sdxl") {
    const rule = SDXL_VIEW_RULES[view];
    const bodyView = rule.view ? sheet[rule.view] : null;
    // The on-screen reference is the identity the user picked (often the
    // original art, while the sheet redraws it); the sheet face is the fallback.
    const face = screenReference || sheet.face;
    return {
      // PuLID only when the shot shows a face; on a back view it has nothing
      // to match and only fights the IP-Adapter view.
      character_image: rule.face ? face : null,
      character_reference_strength: SDXL_FACE_PULID_STRENGTH,
      identity_reference_image: bodyView,
      identity_reference_strength: bodyView ? rule.ipadapter : undefined,
      character_face_image: null,
      character_reference_view: null,
    };
  }
  return null;
}
