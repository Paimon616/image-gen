import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPromptView,
  directionalFamily,
  directionalParams,
  SDXL_FACE_PULID_STRENGTH,
  SDXL_VIEW_IPADAPTER_STRENGTH,
} from "./directional-reference.ts";

const sheet = {
  front: "http://app/front.png",
  side: "http://app/side.png",
  back: "http://app/back.png",
  face: "http://app/face.png",
};
const screen = "http://app/screen.png";

test("family from the checkpoint name", () => {
  assert.equal(directionalFamily("krea2_turbo_fp8_scaled.safetensors"), "krea2");
  assert.equal(directionalFamily("hassakuXLIllustrious_v22.safetensors"), "sdxl");
  assert.equal(directionalFamily("z_image_turbo_bf16.safetensors"), "none");
  assert.equal(directionalFamily(""), "none");
});

test("prompt direction: tags, sentences and Korean", () => {
  assert.equal(classifyPromptView("1girl, from behind, standing, park"), "back");
  assert.equal(classifyPromptView("1girl, from behind, looking back, looking at viewer"), "back_face");
  assert.equal(
    classifyPromptView("She is seen from behind: her back faces the camera and she looks back over her right shoulder"),
    "back_face"
  );
  assert.equal(classifyPromptView("1girl, from side, profile, walking"), "side");
  assert.equal(classifyPromptView("1girl, profile, looking at viewer"), "side_face");
  assert.equal(classifyPromptView("뒷모습, 공원"), "back");
  assert.equal(classifyPromptView("옆모습으로 걷는 장면"), "side");
  assert.equal(classifyPromptView("1girl, looking at viewer, smile, cafe"), "front");
});

test("Krea 2 keeps the on-screen reference as the front and swaps views", () => {
  assert.equal(directionalParams("front", sheet, "krea2", screen)?.character_image, screen);
  const back = directionalParams("back", sheet, "krea2", screen);
  assert.equal(back?.character_image, sheet.back);
  assert.equal(back?.character_reference_view, "back");
  const turned = directionalParams("back_face", sheet, "krea2", screen);
  assert.equal(turned?.character_image, sheet.back);
  assert.equal(turned?.character_face_image, sheet.face);
  assert.equal(turned?.identity_reference_image, null);
});

test("SDXL: IP-Adapter view only where it helps, PuLID when a face shows", () => {
  const back = directionalParams("back", sheet, "sdxl", screen);
  assert.equal(back?.identity_reference_image, sheet.back);
  assert.equal(back?.identity_reference_strength, SDXL_VIEW_IPADAPTER_STRENGTH);
  assert.equal(back?.character_image, null);

  // Looking back: the back view would turn the figure fully away.
  const turned = directionalParams("back_face", sheet, "sdxl", screen);
  assert.equal(turned?.identity_reference_image, null);
  assert.equal(turned?.character_image, screen);
  assert.equal(turned?.character_reference_strength, SDXL_FACE_PULID_STRENGTH);

  const side = directionalParams("side", sheet, "sdxl", screen);
  assert.equal(side?.identity_reference_image, sheet.side);
  assert.equal(side?.identity_reference_strength, 0.45);
  assert.equal(side?.character_image, screen);

  // Front: the sheet's standing pose would freeze the scene; face only.
  const front = directionalParams("front", sheet, "sdxl", screen);
  assert.equal(front?.identity_reference_image, null);
  assert.equal(front?.character_image, screen);

  // No on-screen reference: the sheet's face crop is the face.
  const noScreen = directionalParams("front", sheet, "sdxl", null);
  assert.equal(noScreen?.character_image, sheet.face);
});

test("no reference path: nothing applied", () => {
  assert.equal(directionalParams("back", sheet, "none", screen), null);
});
