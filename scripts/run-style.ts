// Runs an exported style spec against a ComfyUI server with no image-gen code
// besides src/lib/style-spec.ts — the same steps a product backend would take.
//
//   npm run style:run -- styles/soft-anime.v1.style.json --prompt "a girl reading in a cafe"
//     [--comfy http://127.0.0.1:8188] [--seed 42] [--width 832 --height 1216] [--out output/style-runs]
//
// RunPod: pass the pod's ComfyUI proxy URL (https://<pod>-8188.proxy.runpod.net) as --comfy.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { applyStyle, type StyleSpec } from "../src/lib/style-spec.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    prompt: { type: "string" },
    comfy: { type: "string", default: process.env.COMFYUI_BASE_URL ?? "http://127.0.0.1:8188" },
    seed: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    out: { type: "string", default: "output/style-runs" },
  },
});

const specPath = positionals[0];
if (!specPath || !values.prompt) {
  console.error('Usage: npm run style:run -- <style.json> --prompt "..." [--comfy URL] [--seed N] [--width W --height H]');
  process.exit(1);
}

const spec = JSON.parse(await readFile(specPath, "utf8")) as StyleSpec;
const num = (value?: string) => (value === undefined ? undefined : Number(value));
const seed = num(values.seed) ?? Math.floor(Math.random() * 2 ** 48);
const workflow = applyStyle(spec, {
  prompt: values.prompt,
  seed,
  width: num(values.width),
  height: num(values.height),
});
const base = values.comfy!.replace(/\/$/, "");

console.log(`style ${spec.id} v${spec.version} · seed ${seed} · ${base}`);
const queued = await fetch(`${base}/prompt`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: workflow, client_id: crypto.randomUUID() }),
});
if (!queued.ok) {
  console.error(`ComfyUI rejected the workflow (${queued.status}):\n${await queued.text()}`);
  process.exit(1);
}
const { prompt_id: promptId } = (await queued.json()) as { prompt_id: string };
console.log(`queued ${promptId}`);

type HistoryItem = {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
};

const deadline = Date.now() + 15 * 60_000;
let item: HistoryItem | undefined;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const res = await fetch(`${base}/history/${promptId}`);
  item = ((await res.json()) as Record<string, HistoryItem>)[promptId];
  if (item?.status?.completed || item?.status?.status_str === "error") break;
}
if (!item?.status?.completed) {
  console.error(`Generation did not finish: ${JSON.stringify(item?.status ?? "timeout")}`);
  process.exit(1);
}

const images = Object.values(item.outputs ?? {}).flatMap((output) => output.images ?? []);
const outDir = values.out!;
await mkdir(outDir, { recursive: true });
let index = 0;
for (const image of images.filter((img) => img.type === "output")) {
  const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder, type: image.type });
  const res = await fetch(`${base}/view?${query}`);
  const extension = image.filename.split(".").pop() ?? "png";
  const file = join(outDir, `${spec.id}.v${spec.version}-${seed}-${index++}.${extension}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`saved ${file}`);
}
if (index === 0) {
  console.error("Finished, but the workflow produced no output images.");
  process.exit(1);
}
