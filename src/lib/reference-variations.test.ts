import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVariationShots,
  directionalReference,
  type VariationPlan,
} from "./reference-variations.ts";

const plan: VariationPlan = {
  gender: "female",
  base: "A blonde girl, painterly anime style",
  removed: [],
  setting: "",
  backgrounds: ["a beach", "a cafe", "a library", "a park"],
  poses: [],
  expressions: [],
};

const set = {
  front: "/api/images/front.png",
  side: "/api/images/side.png",
  back: "/api/images/back.png",
  face: "/api/images/face.png",
};

test("every shot carries the view its direction sentence describes", () => {
  const shots = buildVariationShots(plan, 60);
  for (const shot of shots) {
    const behind = /seen from behind/.test(shot.prompt);
    const hidden = /face is not visible/.test(shot.prompt);
    if (behind) assert.equal(shot.view, hidden ? "back" : "back_face", shot.prompt);
    else if (/seen from the side/.test(shot.prompt)) {
      assert.ok(shot.view === "side" || shot.view === "side_face", shot.prompt);
    } else assert.equal(shot.view, "front", shot.prompt);
  }
  // 60 draws cycle the 13-view deck several times: every kind shows up.
  const kinds = new Set(shots.map((s) => s.view));
  for (const kind of ["front", "side", "side_face", "back", "back_face"]) {
    assert.ok(kinds.has(kind as never), kind);
  }
});

test("back views use the back reference, with the face only when it shows", () => {
  assert.deepEqual(directionalReference("back", set), {
    character_image: set.back,
    character_face_image: null,
    character_reference_view: "back",
  });
  assert.deepEqual(directionalReference("back_face", set), {
    character_image: set.back,
    character_face_image: set.face,
    character_reference_view: null,
  });
  assert.deepEqual(directionalReference("side", set), {
    character_image: set.side,
    character_face_image: null,
    character_reference_view: null,
  });
  assert.deepEqual(directionalReference("side_face", set), {
    character_image: set.side,
    character_face_image: set.face,
    character_reference_view: null,
  });
  assert.deepEqual(directionalReference("front", set), {
    character_image: set.front,
    character_face_image: null,
    character_reference_view: null,
  });
});

test("missing sheet views fall back to the front reference alone", () => {
  const front = { front: set.front };
  for (const view of ["side", "side_face", "back", "back_face"] as const) {
    assert.deepEqual(directionalReference(view, front), {
      character_image: set.front,
      character_face_image: null,
      character_reference_view: null,
    });
  }
  // A back view without a face crop still beats the front reference.
  assert.deepEqual(directionalReference("back_face", { front: set.front, back: set.back }), {
    character_image: set.back,
    character_face_image: null,
    character_reference_view: null,
  });
});
