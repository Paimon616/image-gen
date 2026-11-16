import test from "node:test";
import assert from "node:assert/strict";

import {
  applyStyle,
  ensurePromptToken,
  extractStyleSpec,
  PROMPT_SENTINEL,
  SEED_SENTINEL,
  sentinelPrompt,
  type ComfyApiWorkflow,
} from "./style-spec.ts";

const source = {
  model_name: "hassaku.safetensors",
  loras: [],
  steps: 30,
  cfg: 7.5,
  sampler: "euler",
  scheduler: "normal",
};

function builtWorkflow(): ComfyApiWorkflow {
  return {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "hassaku.safetensors" } },
    "2": { class_type: "LoraLoader", inputs: { lora_name: "loras\\detail.safetensors", model: ["1", 0] } },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: { text: `masterpiece, ${PROMPT_SENTINEL}, soft light`, clip: ["1", 1] },
    },
    "4": { class_type: "CLIPTextEncode", inputs: { text: "lowres", clip: ["1", 1] } },
    "5": { class_type: "EmptyLatentImage", inputs: { width: 832, height: 1216, batch_size: 1 } },
    "6": { class_type: "KSampler", inputs: { seed: SEED_SENTINEL, steps: 30, cfg: 7.5 } },
  };
}

function extract(workflow = builtWorkflow()) {
  return extractStyleSpec({
    workflow,
    meta: { id: "soft-anime", version: 1, name: { ko: "부드러운 애니", en: "Soft anime" } },
    promptTemplate: "masterpiece, {prompt}, soft light",
    negativePrompt: "lowres",
    width: 832,
    height: 1216,
    source,
    now: new Date("2026-11-16T00:00:00Z"),
  });
}

test("ensurePromptToken appends {prompt} when the template has none", () => {
  assert.equal(ensurePromptToken("anime style"), "anime style, {prompt}");
  assert.equal(ensurePromptToken("a {prompt} b"), "a {prompt} b");
  assert.equal(ensurePromptToken("  "), "{prompt}");
  assert.equal(sentinelPrompt("x, {prompt}"), `x, ${PROMPT_SENTINEL}`);
});

test("extractStyleSpec binds prompt, seed and size and lists model files", () => {
  const spec = extract();
  assert.deepEqual(spec.inputs.prompt, [
    { node: "3", input: "text", template: "masterpiece, {prompt}, soft light" },
  ]);
  assert.deepEqual(spec.inputs.seed, [{ node: "6", input: "seed" }]);
  assert.deepEqual(spec.inputs.width, [{ node: "5", input: "width" }]);
  assert.deepEqual(spec.inputs.height, [{ node: "5", input: "height" }]);
  assert.equal(spec.sizeAdjustable, true);
  assert.deepEqual(spec.requiredFiles, ["hassaku.safetensors", "loras/detail.safetensors"]);
  assert.ok(!JSON.stringify(spec.workflow).includes(PROMPT_SENTINEL));
  assert.ok(!JSON.stringify(spec.workflow).includes(String(SEED_SENTINEL)));
});

test("applyStyle fills the user's values without touching the spec", () => {
  const spec = extract();
  const workflow = applyStyle(spec, { prompt: "a girl reading", seed: 42, width: 1024, height: 1024 });
  assert.equal(workflow["3"].inputs.text, "masterpiece, a girl reading, soft light");
  assert.equal(workflow["6"].inputs.seed, 42);
  assert.equal(workflow["5"].inputs.width, 1024);
  assert.equal(workflow["4"].inputs.text, "lowres");
  assert.equal(spec.workflow["3"].inputs.text, "masterpiece, {prompt}, soft light");
});

test("size stays fixed when the graph does not expose it", () => {
  const workflow = builtWorkflow();
  workflow["5"].inputs.width = 416; // e.g. Hires fix base size
  const spec = extract(workflow);
  assert.equal(spec.sizeAdjustable, false);
  const applied = applyStyle(spec, { prompt: "x", width: 2048 });
  assert.equal(applied["5"].inputs.width, 416);
});

test("rejects bad ids, missing prompt bindings and empty prompts", () => {
  assert.throws(() =>
    extractStyleSpec({
      workflow: builtWorkflow(),
      meta: { id: "Bad Id", version: 1, name: { ko: "", en: "" } },
      promptTemplate: "{prompt}",
      negativePrompt: "",
      width: 832,
      height: 1216,
      source,
    })
  );
  const noPrompt = builtWorkflow();
  noPrompt["3"].inputs.text = "fixed";
  assert.throws(() => extract(noPrompt), /prompt/);
  assert.throws(() => applyStyle(extract(), { prompt: "  " }), /prompt is required/);
});
