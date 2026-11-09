import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CHARACTER_SHEET_SITUATION_ID,
  DEFAULT_SHEET_STRENGTH,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  appendUniqueTags,
  applyReferenceSheet,
  buildCharacterSheetPrompt,
  buildSheetCandidateParams,
  clampSheetStrength,
  ipAdapterMissingMessage,
  isIpAdapterSetupError,
  normalizeReferenceSheet,
  pickIpAdapterFiles,
  sheetCandidateSeeds,
  shouldApplyReferenceSheet,
} from "./character-sheet.ts";
import type { CharacterReferenceSheet, GenerationParams } from "./types.ts";

const sheet: CharacterReferenceSheet = {
  url: "/api/images/abc.png",
  filename: "abc.png",
  confirmed: true,
  enabled: true,
  prompt: "p",
  seed: 1,
  strength: 0.6,
};

// Minimal params; only the fields the helpers touch matter.
const baseParams = {
  backend: "comfyui",
  model: "comfyui/local-sdxl",
  model_name: "hassakuXLIllustrious_v22.safetensors",
  prompt: "old",
  negative_prompt: "lowres, watermark",
  width: 832,
  height: 1216,
  num_images: 2,
  seed: 5,
  generation_mode: "image_to_image",
  loras: [{ path: "a.safetensors", scale: 0.5 }],
  controlnets: [{ model: "x", image: "y", strength: 1, start_percent: 0, end_percent: 1 }],
  source_image: "/api/images/src.png",
  pose_reference_image: "/api/images/pose.png",
  style_image: null,
  character_image: "/api/images/face.png",
  character_sheet_image: "/api/images/old-sheet.png",
  adetailer_enabled: true,
  sampler_name: "euler_ancestral",
} as unknown as GenerationParams;

test("sheet prompt keeps appearance tags, drops scene tags, adds trigger words first", () => {
  const { prompt, negative } = buildCharacterSheetPrompt({
    appearancePrompt: "1girl, solo, silver hair, red eyes, looking at viewer, outdoors, (twintails:1.2)",
    triggerWords: ["ayori"],
  });
  assert.ok(prompt.startsWith("ayori, masterpiece"));
  assert.match(prompt, /character turnaround/);
  assert.match(prompt, /silver hair/);
  assert.match(prompt, /\(twintails:1\.2\)/);
  assert.doesNotMatch(prompt, /\bsolo\b/);
  assert.doesNotMatch(prompt, /looking at viewer/);
  assert.doesNotMatch(prompt, /outdoors/);
  assert.match(negative, /multiple girls/);
});

test("appendUniqueTags only adds missing tags, case-insensitive", () => {
  assert.equal(appendUniqueTags("a, B", ["b", "c"]), "a, B, c");
  assert.equal(appendUniqueTags("", ["x"]), "x");
  assert.equal(appendUniqueTags("a,  ", ["a"]), "a,  ");
});

test("clampSheetStrength bounds and defaults", () => {
  assert.equal(clampSheetStrength(9), 1.5);
  assert.equal(clampSheetStrength(-1), 0);
  assert.equal(clampSheetStrength("x"), DEFAULT_SHEET_STRENGTH);
  assert.equal(clampSheetStrength(0.555), 0.56);
});

test("normalizeReferenceSheet accepts only app-served images", () => {
  assert.equal(normalizeReferenceSheet(null), null);
  assert.equal(normalizeReferenceSheet({ url: "https://evil/x.png", filename: "x.png" }), null);
  assert.equal(normalizeReferenceSheet({ url: "/api/images/../x.png", filename: "x.png" }), null);
  assert.equal(normalizeReferenceSheet({ url: "/api/images/x.png", filename: "x.exe" }), null);
  const ok = normalizeReferenceSheet({
    url: "/api/images/x.png",
    filename: "x.png",
    confirmed: true,
    strength: 3,
    seed: 12.7,
  });
  assert.deepEqual(ok, {
    url: "/api/images/x.png",
    filename: "x.png",
    thumbnailUrl: undefined,
    confirmed: true,
    enabled: true,
    prompt: "",
    seed: 12,
    strength: 1.5,
    confirmedAt: undefined,
  });
  // Unconfirmed by default, explicit off honoured.
  const off = normalizeReferenceSheet({ url: "/api/images/x.png", filename: "x.png", enabled: false });
  assert.equal(off?.confirmed, false);
  assert.equal(off?.enabled, false);
});

test("shouldApplyReferenceSheet gates on beta, confirm, switch, sheet candidates and backend", () => {
  const base = { betaEnabled: true, sheet, situationId: "s1", backend: "comfyui" as const };
  assert.equal(shouldApplyReferenceSheet(base), true);
  assert.equal(shouldApplyReferenceSheet({ ...base, betaEnabled: false }), false);
  assert.equal(shouldApplyReferenceSheet({ ...base, sheet: null }), false);
  assert.equal(shouldApplyReferenceSheet({ ...base, sheet: { ...sheet, confirmed: false } }), false);
  assert.equal(shouldApplyReferenceSheet({ ...base, sheet: { ...sheet, enabled: false } }), false);
  assert.equal(
    shouldApplyReferenceSheet({ ...base, situationId: CHARACTER_SHEET_SITUATION_ID }),
    false
  );
  assert.equal(shouldApplyReferenceSheet({ ...base, backend: "a1111" }), false);
  assert.equal(shouldApplyReferenceSheet({ ...base, situationId: undefined }), true);
});

test("applyReferenceSheet sets image and clamped strength without touching the rest", () => {
  const out = applyReferenceSheet(baseParams, { ...sheet, strength: 4 });
  assert.equal(out.character_sheet_image, "/api/images/abc.png");
  assert.equal(out.character_sheet_strength, 1.5);
  assert.equal(out.prompt, "old");
  assert.equal(out.character_image, "/api/images/face.png");
});

test("applyReferenceSheet honours per-render overrides", () => {
  const off = applyReferenceSheet({ ...baseParams, character_sheet_disabled: true }, sheet);
  assert.equal(off.character_sheet_image, null);
  const stronger = applyReferenceSheet(
    { ...baseParams, character_sheet_strength_override: 0.9 },
    sheet
  );
  assert.equal(stronger.character_sheet_strength, 0.9);
  const inherit = applyReferenceSheet(
    { ...baseParams, character_sheet_strength_override: null },
    sheet
  );
  assert.equal(inherit.character_sheet_strength, 0.6);
});

test("sheetCandidateSeeds are distinct", () => {
  let n = 0;
  const values = [0.1, 0.1, 0.2, 0.3, 0.3, 0.4];
  const seeds = sheetCandidateSeeds(4, () => values[n++]);
  assert.equal(new Set(seeds).size, 4);
});

test("buildSheetCandidateParams resets layout-affecting inputs and forces ComfyUI", () => {
  const list = buildSheetCandidateParams({
    base: { ...baseParams, backend: "forge" },
    appearancePrompt: "1girl, silver hair",
    loras: [{ path: "char.safetensors", scale: 0.8 }],
    triggerWords: ["ayori"],
    seeds: [11, 22],
  });
  assert.equal(list.length, 2);
  for (const params of list) {
    assert.equal(params.backend, "comfyui");
    assert.equal(params.width, SHEET_WIDTH);
    assert.equal(params.height, SHEET_HEIGHT);
    assert.equal(params.num_images, 1);
    assert.equal(params.generation_mode, "text_to_image");
    assert.deepEqual(params.controlnets, []);
    assert.equal(params.source_image, null);
    assert.equal(params.pose_reference_image, null);
    assert.equal(params.character_image, null);
    assert.equal(params.character_sheet_image, null);
    assert.equal(params.adetailer_enabled, false);
    assert.deepEqual(params.loras, [{ path: "char.safetensors", scale: 0.8 }]);
    assert.match(params.prompt, /^ayori, /);
    assert.match(params.negative_prompt, /^lowres, watermark, /);
    assert.equal(params.sampler_name, "euler_ancestral");
    assert.equal(params.model_name, "hassakuXLIllustrious_v22.safetensors");
  }
  assert.deepEqual(list.map((p) => p.seed), [11, 22]);
});

test("pickIpAdapterFiles prefers SDXL plus ViT-H with the ViT-H encoder", () => {
  assert.deepEqual(
    pickIpAdapterFiles(
      [
        "ip-adapter_sd15.safetensors",
        "ip-adapter-faceid-plusv2_sdxl.bin",
        "ip-adapter_sdxl.safetensors",
        "ip-adapter-plus_sdxl_vit-h.safetensors",
      ],
      ["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors", "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"]
    ),
    {
      ipadapter: "ip-adapter-plus_sdxl_vit-h.safetensors",
      clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
    }
  );
  // Plain SDXL adapter needs bigG.
  assert.deepEqual(
    pickIpAdapterFiles(["ip-adapter_sdxl.safetensors"], ["CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"]),
    {
      ipadapter: "ip-adapter_sdxl.safetensors",
      clipVision: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
    }
  );
});

test("pickIpAdapterFiles reports what is missing", () => {
  assert.deepEqual(pickIpAdapterFiles([], []), { missing: ["ipadapter", "clip_vision"] });
  assert.deepEqual(pickIpAdapterFiles(["ip-adapter_sd15.safetensors"], ["CLIP-ViT-H-14.safetensors"]), {
    missing: ["ipadapter"],
  });
  assert.deepEqual(
    pickIpAdapterFiles(["ip-adapter-plus_sdxl_vit-h.safetensors"], ["CLIP-ViT-bigG.safetensors"]),
    { missing: ["clip_vision"] }
  );
});

test("missing messages are recognisable setup errors", () => {
  const node = ipAdapterMissingMessage("node", "로컬 ComfyUI");
  assert.ok(isIpAdapterSetupError(node));
  assert.match(node, /ComfyUI_IPAdapter_plus/);
  assert.match(node, /기준 시트/);
  const style = ipAdapterMissingMessage("node", "로컬 ComfyUI", "style");
  assert.ok(isIpAdapterSetupError(style));
  assert.match(style, /스타일 이미지를 비우고/);
  const files = ipAdapterMissingMessage(["clip_vision"], "GPU 워커");
  assert.match(files, /clip_vision\/CLIP-ViT-H-14-laion2B-s32B-b79K\.safetensors/);
  assert.equal(isIpAdapterSetupError("Some other error"), false);
});
