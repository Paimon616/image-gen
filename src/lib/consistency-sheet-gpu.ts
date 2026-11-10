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
import { resolveCheckpointFamily } from "@/lib/comfyui-model-files";
import { DEFAULT_PARAMS, type GenerationParams } from "@/lib/types";

// 일관성 시트 on our own GPUs (local ComfyUI or the LAN GPU workers) instead
// of GPT-Image-2 on fal.ai. Runs the chosen model through the app's normal
// generation route, so worker leasing, model checks and uploads are the same
// as the generator page. References depend on the model family:
//  - Krea 2: Identity Edit. Sheet modes use the first reference as the person;
//    scene mode puts the character sheet's person into the background sheet's
//    place (two-reference edit).
//  - SDXL / Illustrious: IP-Adapter identity reference (first reference, or the
//    character sheet's front view in scene mode). No place reference.
//  - Z-Image / Anima: prompt only (no reference path for them in this app).
// Sizes are fixed around 1 MP instead of the 1k/2k/4k tiers.

export const GPU_SHEET_MODEL =
  process.env.CONSISTENCY_SHEET_GPU_MODEL?.trim() || "krea2_turbo_fp8_scaled.safetensors";

export type GpuSheetFamily = "krea2" | "sdxl" | "zimage" | "anima";

export async function gpuSheetFamily(model: string): Promise<GpuSheetFamily> {
  const family = await resolveCheckpointFamily(model);
  return family === "krea2" || family === "zimage" || family === "anima" ? family : "sdxl";
}

/** How many reference images each family can use (person, place). */
export const GPU_FAMILY_REFERENCES: Record<GpuSheetFamily, { person: boolean; place: boolean }> = {
  krea2: { person: true, place: true },
  sdxl: { person: true, place: false },
  zimage: { person: false, place: false },
  anima: { person: false, place: false },
};

export function gpuSheetSize(mode: ConsistencySheetParams["mode"]) {
  // 768x1344 is both an SDXL bucket and ~1 MP for the DiT families.
  return mode === "scene" ? { width: 768, height: 1344 } : { width: 1024, height: 1024 };
}

const SDXL_QUALITY = "masterpiece, best quality, amazing quality";
const SDXL_NEGATIVE =
  "worst quality, low quality, lowres, bad anatomy, bad hands, text, watermark, signature, blurry";

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
  const model = params.gpuModel || GPU_SHEET_MODEL;
  const family = await gpuSheetFamily(model);
  const support = GPU_FAMILY_REFERENCES[family];
  const { width, height } = gpuSheetSize(params.mode);
  const personRaw =
    params.mode === "scene" ? params.characterReference : (params.references[0] ?? null);
  const placeRaw = params.mode === "scene" ? params.backgroundReference : null;
  const person = support.person ? personRaw : null;
  const place = support.place ? placeRaw : null;

  const notes: string[] = [];
  if (params.mode !== "scene" && params.references.length > (support.person ? 1 : 0)) {
    notes.push(
      support.person
        ? `레퍼런스는 첫 장만 사용 (${params.references.length - 1}장 제외)`
        : "이 모델은 레퍼런스를 쓰지 않음 (프롬프트만)"
    );
  }
  if (params.mode === "scene") {
    if (personRaw && !support.person) notes.push("이 모델은 캐릭터 시트를 쓰지 않음");
    if (placeRaw && !support.place) notes.push("이 모델은 배경 시트를 쓰지 않음 (Krea 2만 지원)");
    if (params.outfitReference) notes.push("GPU 엔진은 복장 참조를 쓰지 않음");
  }

  // Sheet modes: the reference is a character photo/illustration, used as is.
  // Scene mode: the slots hold whole sheets, cut to one view each.
  const personUrl = person
    ? await saveReference(person, origin, params.mode === "scene" ? "person" : "as-is")
    : null;
  const placeUrl = place ? await saveReference(place, origin, "place") : null;
  const prompt = buildConsistencySheetPrompt(params);

  const generation: GenerationParams = {
    ...DEFAULT_PARAMS,
    backend: "comfyui",
    model_name: model,
    prompt: family === "sdxl" ? `${SDXL_QUALITY}, ${prompt}` : prompt,
    negative_prompt: family === "sdxl" ? SDXL_NEGATIVE : "",
    width,
    height,
    num_images: 1,
    hires_upscale: 1,
    adetailer_enabled: false,
    loras: [],
    controlnets: [],
    seed: null,
    generation_mode: "text_to_image",
    character_sheet_disabled: true,
    ...(family === "krea2"
      ? {
          krea2_workflow: "generic" as const,
          num_inference_steps: 8,
          guidance_scale: 1,
          character_image: personUrl,
          scene_reference_image: placeUrl,
        }
      : family === "sdxl"
        ? { identity_reference_image: personUrl, identity_reference_strength: 0.6 }
        : {}),
  };
  return { generation, family, notes };
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
  const { generation, notes } = await buildGpuSheetParams(input.params, input.origin);
  for (const note of notes) input.onProgress(note, null);
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
  return { buffer: await readFile(join(OUTPUT_DIR, filename)), model: generation.model_name };
}
