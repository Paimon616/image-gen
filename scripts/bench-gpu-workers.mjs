#!/usr/bin/env node
// Generation latency / throughput bench through the running image-gen app.
//
// Goes through /api/generate/stream exactly like the UI, so the numbers include
// dispatch, upload of the workflow, sampling, and fetching the result back.
//
//   node scripts/bench-gpu-workers.mjs --target workers --jobs 8 --concurrency 4
//   node scripts/bench-gpu-workers.mjs --target workers --jobs 4 --concurrency 1 --warmup 1
//   node scripts/bench-gpu-workers.mjs --params my-params.json --lora myChar.safetensors:0.8
//
// Options:
//   --app URL            image-gen origin (default http://127.0.0.1:5353)
//   --target T           workers | local | runpod (default workers)
//   --runpod-pod ID      pod id for --target runpod
//   --jobs N             measured jobs (default 4)
//   --concurrency N      jobs in flight at once (default 1)
//   --warmup N           unmeasured jobs first, to load the model into VRAM (default 1)
//   --params FILE        JSON merged over the app's DEFAULT_PARAMS
//   --model NAME         checkpoint file (model_name)
//   --lora NAME:SCALE    repeatable
//   --size WxH           default 1024x1024
//   --steps N            default from DEFAULT_PARAMS
//   --workload full|light
//   --json FILE          also write raw results
//
// Writes no images anywhere special: results land in the normal gallery
// (output/). See docs/gpu-workers.md for the test plan.

import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PARAMS } from "../src/lib/types.ts";

function parseArgs(argv) {
  const opts = { loras: [] };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = () => argv[++i];
    switch (key) {
      case "--app": opts.app = next(); break;
      case "--target": opts.target = next(); break;
      case "--runpod-pod": opts.runpodPodId = next(); break;
      case "--jobs": opts.jobs = Number(next()); break;
      case "--concurrency": opts.concurrency = Number(next()); break;
      case "--warmup": opts.warmup = Number(next()); break;
      case "--params": opts.paramsFile = next(); break;
      case "--model": opts.model = next(); break;
      case "--lora": opts.loras.push(next()); break;
      case "--size": opts.size = next(); break;
      case "--steps": opts.steps = Number(next()); break;
      case "--workload": opts.workload = next(); break;
      case "--json": opts.json = next(); break;
      case "-h":
      case "--help":
        console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 30).join("\n"));
        process.exit(0);
      default:
        throw new Error(`Unknown option ${key}`);
    }
  }
  return {
    app: (opts.app ?? "http://127.0.0.1:5353").replace(/\/$/, ""),
    target: opts.target ?? "workers",
    runpodPodId: opts.runpodPodId,
    jobs: opts.jobs > 0 ? opts.jobs : 4,
    concurrency: opts.concurrency > 0 ? opts.concurrency : 1,
    warmup: Number.isFinite(opts.warmup) ? opts.warmup : 1,
    ...opts,
  };
}

function buildParams(opts) {
  const params = structuredClone(DEFAULT_PARAMS);
  params.prompt =
    "1girl, solo, upper body, looking at viewer, smile, school uniform, classroom, window light, masterpiece, best quality";
  if (opts.paramsFile) Object.assign(params, JSON.parse(readFileSync(opts.paramsFile, "utf8")));
  if (opts.model) params.model_name = opts.model;
  if (opts.size) {
    const [w, h] = opts.size.split("x").map(Number);
    params.width = w;
    params.height = h;
  }
  if (opts.steps) params.num_inference_steps = opts.steps;
  if (opts.loras.length > 0) {
    params.loras = opts.loras.map((entry) => {
      const [path, scale] = entry.split(":");
      return { path, scale: scale ? Number(scale) : 1 };
    });
  }
  params.backend = "comfyui";
  params.num_images = 1;
  return params;
}

async function runJob(opts, params, index) {
  const started = performance.now();
  const timing = { index, worker: "", queuedMs: 0, firstStepMs: 0, totalMs: 0, error: "" };
  try {
    const res = await fetch(`${opts.app}/api/generate/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...params,
        seed: Math.floor(Math.random() * 2 ** 31),
        generationTarget: opts.target,
        runpodPodId: opts.runpodPodId,
        workload: opts.workload,
      }),
    });
    if (!res.ok || !res.body) throw new Error((await res.text()).slice(0, 300));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const event = raw.match(/^event: (.*)$/m)?.[1];
        const dataLine = raw.match(/^data: (.*)$/m)?.[1];
        const data = dataLine ? JSON.parse(dataLine) : null;
        const now = performance.now() - started;
        if (event === "worker") timing.worker = data.label;
        if (event === "queued") timing.queuedMs = now;
        if (event === "progress" && data?.step != null && !timing.firstStepMs) timing.firstStepMs = now;
        if (event === "error") throw new Error(data?.error ?? "error");
        if (event === "complete") timing.totalMs = now;
      }
    }
    if (!timing.totalMs) throw new Error("stream ended without complete");
  } catch (error) {
    timing.error = error instanceof Error ? error.message : String(error);
    timing.totalMs = performance.now() - started;
  }
  return timing;
}

async function runPool(opts, params, count, label) {
  const results = [];
  let next = 0;
  const wallStart = performance.now();
  async function lane() {
    while (next < count) {
      const index = next++;
      const result = await runJob(opts, params, index);
      results.push(result);
      const s = (ms) => (ms / 1000).toFixed(1).padStart(6);
      console.log(
        `${label} #${String(index + 1).padStart(2)}  ${(result.worker || opts.target).padEnd(16)}` +
          ` queued${s(result.queuedMs)}s  1st-step${s(result.firstStepMs)}s  total${s(result.totalMs)}s` +
          (result.error ? `  ERROR ${result.error}` : "")
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.concurrency, count) }, lane));
  return { results, wallMs: performance.now() - wallStart };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const opts = parseArgs(process.argv.slice(2));
const params = buildParams(opts);
console.log(
  `target=${opts.target} model=${params.model_name} ${params.width}x${params.height} steps=${params.num_inference_steps}` +
    ` sampler=${params.sampler_name}/${params.scheduler} loras=${params.loras.map((l) => l.path).join(",") || "-"}` +
    ` jobs=${opts.jobs} concurrency=${opts.concurrency}`
);

if (opts.target === "workers") {
  const status = await fetch(`${opts.app}/api/gpu-workers`).then((r) => r.json());
  for (const w of status.workers ?? []) {
    console.log(
      `  worker ${w.label}: ${w.probe?.online ? `online ${w.probe.device ?? ""}` : `offline ${w.probe?.error ?? ""}`}`
    );
  }
}

if (opts.warmup > 0) {
  await runPool({ ...opts, concurrency: opts.warmup }, params, opts.warmup, "warmup");
}
const { results, wallMs } = await runPool(opts, params, opts.jobs, "job   ");
const ok = results.filter((r) => !r.error);
const totals = ok.map((r) => r.totalMs);
const byWorker = {};
for (const r of ok) (byWorker[r.worker || opts.target] ??= []).push(r.totalMs);

console.log("\nsummary");
console.log(`  ok ${ok.length}/${results.length}, wall ${(wallMs / 1000).toFixed(1)}s, throughput ${(ok.length / (wallMs / 60000)).toFixed(2)} img/min`);
console.log(
  `  latency p50 ${(percentile(totals, 50) / 1000).toFixed(1)}s  p95 ${(percentile(totals, 95) / 1000).toFixed(1)}s  max ${(Math.max(0, ...totals) / 1000).toFixed(1)}s`
);
for (const [worker, values] of Object.entries(byWorker)) {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  console.log(`  ${worker.padEnd(16)} ${values.length} jobs, avg ${(avg / 1000).toFixed(1)}s`);
}
if (opts.json) {
  writeFileSync(opts.json, JSON.stringify({ opts, params, wallMs, results }, null, 2));
  console.log(`  raw → ${opts.json}`);
}
