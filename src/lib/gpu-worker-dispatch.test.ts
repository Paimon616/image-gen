import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chooseGpuWorker,
  classifyWorkload,
  missingModelFiles,
  normalizeGpuWorkers,
  requiredModelFiles,
  type GpuWorkerCandidate,
  type GpuWorkerConfig,
} from "./gpu-worker-dispatch.ts";

const rtx4080: GpuWorkerConfig = {
  id: "4080",
  label: "4080",
  url: "http://10.0.0.80:8188",
  role: "primary",
  speed: 1,
  maxQueue: 4,
  enabled: true,
};
const rtx3060: GpuWorkerConfig = {
  id: "3060",
  label: "3060",
  url: "http://10.0.0.60:8188",
  role: "light",
  speed: 0.4,
  maxQueue: 2,
  enabled: true,
};

function candidate(
  worker: GpuWorkerConfig,
  overrides: Partial<GpuWorkerCandidate["status"]> & { reserved?: number } = {}
): GpuWorkerCandidate {
  const { reserved = 0, ...status } = overrides;
  return {
    worker,
    reserved,
    status: { online: true, queueDepth: 0, missingFiles: [], ...status },
  };
}

test("idle pool sends a full render to the 4080", () => {
  const { choice } = chooseGpuWorker([candidate(rtx3060), candidate(rtx4080)]);
  assert.equal(choice?.worker.id, "4080");
});

test("4080 keeps full renders while one job runs, 3060 takes overflow after", () => {
  const busyOne = chooseGpuWorker([candidate(rtx4080, { queueDepth: 1 }), candidate(rtx3060)]);
  assert.equal(busyOne.choice?.worker.id, "4080");

  const busyTwo = chooseGpuWorker([candidate(rtx4080, { queueDepth: 2 }), candidate(rtx3060)]);
  assert.equal(busyTwo.choice?.worker.id, "3060");
});

test("reservations count even before ComfyUI reports them in /queue", () => {
  const { choice } = chooseGpuWorker([
    candidate(rtx4080, { queueDepth: 0, reserved: 2 }),
    candidate(rtx3060),
  ]);
  assert.equal(choice?.worker.id, "3060");
});

test("light jobs go to an idle 3060 first", () => {
  const { choice } = chooseGpuWorker([candidate(rtx4080), candidate(rtx3060)], "light");
  assert.equal(choice?.worker.id, "3060");
});

test("light jobs fall back to the 4080 when the 3060 is busy", () => {
  const { choice } = chooseGpuWorker(
    [candidate(rtx4080), candidate(rtx3060, { queueDepth: 1 })],
    "light"
  );
  assert.equal(choice?.worker.id, "4080");
});

test("offline, disabled, full and model-less workers are skipped with reasons", () => {
  const { choice, rejected } = chooseGpuWorker([
    candidate(rtx4080, { online: false, error: "ECONNREFUSED" }),
    candidate({ ...rtx3060, id: "x", enabled: false }),
    candidate(rtx3060, { missingFiles: ["loras/a.safetensors"] }),
    candidate({ ...rtx4080, id: "full", label: "full", maxQueue: 1 }, { queueDepth: 1 }),
  ]);
  assert.equal(choice, null);
  assert.deepEqual(
    rejected.map((r) => r.reason),
    ["offline", "disabled", "missing-files", "full"]
  );
});

test("a powered-off 4080 lets the 3060 serve full renders", () => {
  const { choice } = chooseGpuWorker([
    candidate(rtx4080, { online: false }),
    candidate(rtx3060),
  ]);
  assert.equal(choice?.worker.id, "3060");
});

test("classifyWorkload", () => {
  assert.equal(classifyWorkload({ width: 1024, height: 1024, num_inference_steps: 28 }), "full");
  assert.equal(classifyWorkload({ width: 640, height: 640, num_inference_steps: 28 }), "light");
  assert.equal(classifyWorkload({ width: 1024, height: 1024, num_inference_steps: 6 }), "light");
  assert.equal(classifyWorkload({ width: 640, height: 640, hires_upscale: 1.5 }), "full");
  assert.equal(classifyWorkload({ workload: "full", width: 512, height: 512 }), "full");
});

test("requiredModelFiles and missingModelFiles", () => {
  const required = requiredModelFiles({
    model_name: "waiIllustrious_v150.safetensors",
    vae_name: "Automatic",
    loras: [{ path: "chars\\hero.safetensors" }, { path: "" }],
    upscale_model_name: "4x-UltraSharp.pth",
    hires_upscale: 1,
  });
  assert.deepEqual(required, [
    "checkpoints/waiIllustrious_v150.safetensors",
    "loras/chars\\hero.safetensors",
  ]);
  assert.deepEqual(
    missingModelFiles(required, {
      checkpoints: ["waiIllustrious_v150.safetensors"],
      loras: ["chars/hero.safetensors"],
    }),
    []
  );
  assert.deepEqual(
    missingModelFiles(required, { checkpoints: [], diffusion_models: [], unet: [], loras: undefined }),
    ["checkpoints/waiIllustrious_v150.safetensors"]
  );
});

test("a checkpoint requirement is met by a diffusion_models file (Krea 2)", () => {
  const required = requiredModelFiles({ model_name: "krea2_turbo_fp8_scaled.safetensors" });
  assert.deepEqual(
    missingModelFiles(required, {
      checkpoints: ["hassaku.safetensors"],
      diffusion_models: ["krea2_turbo_fp8_scaled.safetensors"],
      unet: [],
    }),
    []
  );
  // diffusion_models list unknown (probe failed): don't block on it.
  assert.deepEqual(missingModelFiles(required, { checkpoints: [], unet: [] }), []);
});

test("normalizeGpuWorkers drops bad entries and fills defaults", () => {
  const workers = normalizeGpuWorkers([
    { url: "http://10.0.0.80:8188/", label: "4080" },
    { url: "ftp://nope" },
    null,
    { url: "http://10.0.0.60:8188", role: "light", speed: 0.4, maxQueue: 2, enabled: false },
  ]);
  assert.equal(workers.length, 2);
  assert.equal(workers[0].url, "http://10.0.0.80:8188");
  assert.equal(workers[0].role, "primary");
  assert.equal(workers[0].speed, 1);
  assert.equal(workers[1].enabled, false);
});
