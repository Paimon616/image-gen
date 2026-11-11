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
  normalizeSheetCrop,
  squareCropRect,
  pickIpAdapterFiles,
  pickSheetRegion,
  normalizeSheetRegions,
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
    crop: null,
    regions: [],
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

test("pickIpAdapterFiles prefers the NoobAI/Illustrious adapter with bigG", () => {
  assert.deepEqual(
    pickIpAdapterFiles(
      ["ip-adapter-plus_sdxl_vit-h.safetensors", "NOOB-IPA-MARK1.safetensors"],
      ["CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors", "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors"]
    ),
    {
      ipadapter: "NOOB-IPA-MARK1.safetensors",
      clipVision: "CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors",
    }
  );
  // Without bigG it falls back to the SDXL plus adapter.
  assert.deepEqual(
    pickIpAdapterFiles(
      ["ip-adapter-plus_sdxl_vit-h.safetensors", "NOOB-IPA-MARK1.safetensors"],
      ["CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"]
    ),
    {
      ipadapter: "ip-adapter-plus_sdxl_vit-h.safetensors",
      clipVision: "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
    }
  );
  assert.deepEqual(pickIpAdapterFiles(["NOOB-IPA-MARK1.safetensors"], []), {
    missing: ["clip_vision"],
  });
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
  assert.match(files, /clip_vision\/CLIP-ViT-bigG-14-laion2B-39B-b160k\.safetensors/);
  assert.equal(isIpAdapterSetupError("Some other error"), false);
});

test("applyReferenceSheet prefers the 참조 영역 crop over the whole sheet", () => {
  const out = applyReferenceSheet(baseParams, {
    ...sheet,
    crop: { url: "/api/images/sheetref-1.png", filename: "sheetref-1.png", x: 0, y: 0, w: 0.2, h: 0.3 },
  });
  assert.equal(out.character_sheet_image, "/api/images/sheetref-1.png");
});

test("normalizeSheetCrop validates url and unit region", () => {
  assert.equal(normalizeSheetCrop({ url: "/api/images/a.png", filename: "a.png", x: 0, y: 0, w: 2, h: 1 }), null);
  assert.equal(normalizeSheetCrop({ url: "https://x/a.png", filename: "a.png", x: 0, y: 0, w: 0.2, h: 0.3 }), null);
  assert.deepEqual(
    normalizeSheetCrop({ url: "/api/images/a.png", filename: "a.png", x: 0.1, y: 0, w: 0.2, h: 0.3, extra: 1 }),
    { url: "/api/images/a.png", filename: "a.png", x: 0.1, y: 0, w: 0.2, h: 0.3 }
  );
  const kept = normalizeReferenceSheet({
    url: "/api/images/x.png",
    filename: "x.png",
    crop: { url: "/api/images/c.png", filename: "c.png", x: 0, y: 0, w: 0.2, h: 0.3 },
  });
  assert.equal(kept?.crop?.filename, "c.png");
});

test("squareCropRect makes an in-bounds pixel square", () => {
  const rect = squareCropRect(1216, 832, { x: 0.025, y: 0.012, size: 0.222 });
  assert.equal(rect.width, rect.height);
  assert.equal(rect.width, 270);
  assert.equal(rect.left, 30);
  assert.equal(rect.top, 10);
  // Pushed back inside when it would overflow.
  const edge = squareCropRect(1216, 832, { x: 0.95, y: 0.95, size: 0.3 });
  assert.equal(edge.left + edge.width, 1216);
  assert.equal(edge.top + edge.height, 832);
  // Never larger than the short side.
  assert.equal(squareCropRect(1216, 832, { x: 0, y: 0, size: 1 }).width, 832);
});

test("pickSheetRegion follows the scene's framing and view", () => {
  const region = (kind: string) => ({ kind, url: `/api/images/sheetref-${kind}.png`, filename: `sheetref-${kind}.png`, x: 0, y: 0, w: 0.3, h: 0.9 });
  const sheet = {
    url: "/api/images/sheet.png",
    crop: { url: "/api/images/sheetref-crop.png", filename: "sheetref-crop.png", x: 0, y: 0, w: 0.25, h: 0.36 },
    regions: normalizeSheetRegions([region("front_upper"), region("front_full"), region("side"), region("back")]),
  };
  assert.equal(pickSheetRegion("1girl, walking, full body, airport", sheet).kind, "front_full");
  assert.equal(pickSheetRegion("She sits by the window, seen from the side, upper body", sheet).kind, "side");
  assert.equal(pickSheetRegion("standing, from behind, looking back", sheet).kind, "back");
  // Explicit upper body beats "standing"; it is the user's 참조 영역.
  const upper = pickSheetRegion("standing, upper body, smile", sheet);
  assert.deepEqual(upper, { kind: "front_upper", url: "/api/images/sheetref-crop.png" });
  assert.equal(pickSheetRegion("sitting in a cafe", sheet).url, "/api/images/sheetref-crop.png");
  assert.equal(pickSheetRegion("전신, 걷는 모습", sheet).kind, "front_full");
  // A view the sheet lacks falls back to the 참조 영역.
  const noSide = { ...sheet, regions: sheet.regions.filter((r) => r.kind !== "side") };
  assert.equal(pickSheetRegion("profile, from side", noSide).kind, "front_upper");
  // No crop, no regions: the whole sheet (legacy).
  assert.deepEqual(pickSheetRegion("full body", { url: "/api/images/sheet.png" }), { kind: null, url: "/api/images/sheet.png" });
});

test("normalizeSheetRegions drops unknown kinds, duplicates and bad urls", () => {
  const ok = { kind: "side", url: "/api/images/a.png", filename: "a.png", x: 0.1, y: 0, w: 0.3, h: 1 };
  const regions = normalizeSheetRegions([
    ok,
    { ...ok, url: "/api/images/b.png", filename: "b.png" },
    { ...ok, kind: "face" },
    { ...ok, kind: "back", url: "https://evil.example/x.png" },
    null,
  ]);
  assert.deepEqual(regions.map((r) => [r.kind, r.filename]), [["side", "a.png"]]);
});
