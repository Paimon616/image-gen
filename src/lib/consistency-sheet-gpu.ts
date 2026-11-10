import "server-only";

import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

import {
  buildConsistencySheetPrompt,
  type ConsistencySheetParams,
} from "@/lib/consistency-sheet";
import { OUTPUT_DIR, SHEET_CROP_PREFIX } from "@/lib/server-images";
import { findSheetRegions } from "@/lib/sheet-auto-crop";
import { DEFAULT_PARAMS, type GenerationParams } from "@/lib/types";

// 일관성 시트 on our own GPUs (local ComfyUI or the LAN GPU workers) instead
// of GPT-Image-2 on fal.ai. Runs Krea 2 through the app's normal generation
// route, so worker leasing, model checks and uploads are the same as the
// generator page:
//  - character / background sheet: text-to-image; the first reference image
//    (if any) becomes the Krea 2 character reference (Identity Edit)
//  - scene: the character sheet is the person reference, the background sheet
//    the place (two-reference edit: person placed into the scene)
// Krea 2 is trained around 1 MP, so sizes are fixed instead of the 1k/2k/4k tiers.

export const GPU_SHEET_MODEL =
  process.env.CONSISTENCY_SHEET_GPU_MODEL?.trim() || "krea2_turbo_fp8_scaled.safetensors";

export function gpuSheetSize(mode: ConsistencySheetParams["mode"]) {
  return mode === "scene" ? { width: 768, height: 1344 } : { width: 1024, height: 1024 };
}

export type GpuSheetTarget = "workers" | "local";

/**
 * Data URL → one usable reference → file in output/ (hidden from the gallery)
 * → absolute app URL. A whole multi-view sheet makes Krea 2 draw several
 * figures, so a character sheet is cut to its front full-body view (or the
 * head-to-chest square) and a 4-view background sheet to its first panel.
 */
async function saveReference(dataUrl: string, origin: string, role: "person" | "place" | "as-is") {
  const match = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("레퍼런스 이미지 형식을 읽을 수 없습니다.");
  let bytes: Buffer = Buffer.from(match[2], "base64");
  if (role !== "as-is") {
    const meta = await sharp(bytes).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    let rect: { left: number; top: number; width: number; height: number } | null = null;
    if (W > 64 && H > 64 && role === "place") {
      rect = { left: 0, top: 0, width: Math.floor(W / 2), height: Math.floor(H / 2) };
    } else if (W > 64 && H > 64) {
      const { data, info } = await sharp(bytes)
        .removeAlpha()
        .resize({ width: 304 })
        .raw()
        .toBuffer({ resolveWithObject: true });
      const regions = findSheetRegions(new Uint8Array(data), info.width, info.height);
      if (regions.frontFull) {
        const r = regions.frontFull;
        rect = { left: r.x * W, top: r.y * H, width: r.w * W, height: r.h * H };
      } else if (regions.frontUpper) {
        const r = regions.frontUpper;
        rect = { left: r.x * W, top: r.y * H, width: r.size * W, height: r.size * W };
      }
    }
    if (rect) {
      const left = Math.max(0, Math.min(W - 16, Math.round(rect.left)));
      const top = Math.max(0, Math.min(H - 16, Math.round(rect.top)));
      const width = Math.max(16, Math.min(W - left, Math.round(rect.width)));
      const height = Math.max(16, Math.min(H - top, Math.round(rect.height)));
      bytes = await sharp(bytes).extract({ left, top, width, height }).png().toBuffer();
    }
  }
  const filename = `${SHEET_CROP_PREFIX}cs-${randomUUID()}.png`;
  await writeFile(join(OUTPUT_DIR, filename), await sharp(bytes).png().toBuffer());
  return new URL(`/api/images/${filename}`, origin).toString();
}

export async function buildGpuSheetParams(params: ConsistencySheetParams, origin: string) {
  const { width, height } = gpuSheetSize(params.mode);
  const person =
    params.mode === "scene" ? params.characterReference : (params.references[0] ?? null);
  const place = params.mode === "scene" ? params.backgroundReference : null;
  const ignored =
    params.mode === "scene"
      ? params.outfitReference
        ? 1
        : 0
      : Math.max(0, params.references.length - 1);
  const generation: GenerationParams = {
    ...DEFAULT_PARAMS,
    backend: "comfyui",
    model_name: GPU_SHEET_MODEL,
    krea2_workflow: "generic",
    prompt: buildConsistencySheetPrompt(params),
    negative_prompt: "",
    width,
    height,
    num_images: 1,
    num_inference_steps: 8,
    guidance_scale: 1,
    hires_upscale: 1,
    adetailer_enabled: false,
    loras: [],
    controlnets: [],
    seed: null,
    generation_mode: "text_to_image",
    // Sheet modes: the reference is a character photo/illustration, used as is.
    // Scene mode: the slots hold whole sheets, cut to one view each.
    character_image: person
      ? await saveReference(person, origin, params.mode === "scene" ? "person" : "as-is")
      : null,
    scene_reference_image: place ? await saveReference(place, origin, "place") : null,
    character_sheet_disabled: true,
  };
  return { generation, ignoredReferences: ignored };
}

/**
 * Runs one sheet through /api/generate/stream and returns the PNG bytes.
 * onProgress receives the route's progress messages.
 */
export async function generateSheetOnGpu(input: {
  params: ConsistencySheetParams;
  origin: string;
  target: GpuSheetTarget;
  signal: AbortSignal;
  onProgress: (message: string, progress: number | null) => void;
}) {
  const { generation, ignoredReferences } = await buildGpuSheetParams(input.params, input.origin);
  if (ignoredReferences > 0) {
    input.onProgress(
      input.params.mode === "scene"
        ? "GPU 엔진은 복장 참조를 쓰지 않음 (캐릭터, 배경만 사용)"
        : `GPU 엔진은 첫 레퍼런스 1장만 사용 (${ignoredReferences}장 제외)`,
      null
    );
  }
  const res = await fetch(new URL("/api/generate/stream", input.origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...generation, generationTarget: input.target }),
    signal: input.signal,
  });
  if (!res.ok || !res.body) throw new Error(`GPU 생성 요청 실패 (HTTP ${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let filename: string | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let cut: number;
    while ((cut = buffered.indexOf("\n\n")) >= 0) {
      const chunk = buffered.slice(0, cut);
      buffered = buffered.slice(cut + 2);
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const dataText = /^data: (.*)$/m.exec(chunk)?.[1];
      if (!event || !dataText) continue;
      const data = JSON.parse(dataText) as {
        message?: string;
        progress?: number;
        error?: string;
        images?: { filename?: string }[];
      };
      if (event === "progress") input.onProgress(data.message ?? "", data.progress ?? null);
      if (event === "error") throw new Error(data.error || data.message || "GPU 생성 실패");
      if (event === "complete") filename = data.images?.[0]?.filename ?? null;
    }
  }
  if (!filename) throw new Error("GPU 생성 결과를 받지 못했습니다.");
  return { buffer: await readFile(join(OUTPUT_DIR, filename)), model: GPU_SHEET_MODEL };
}
