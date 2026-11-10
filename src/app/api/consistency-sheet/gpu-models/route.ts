import type { NextRequest } from "next/server";

import { GPU_FAMILY_REFERENCES, GPU_SHEET_MODEL, gpuSheetFamily } from "@/lib/consistency-sheet-gpu";
import { listGpuWorkerModelFiles } from "@/lib/gpu-workers";

export const dynamic = "force-dynamic";

const LOCAL_COMFYUI = process.env.COMFYUI_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:8188";
const FOLDERS = ["checkpoints", "diffusion_models", "unet", "unet_gguf"] as const;
const FAMILY_ORDER = { krea2: 0, sdxl: 1, zimage: 2, anima: 3 } as const;

async function listLocal(folder: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${LOCAL_COMFYUI}/models/${folder}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (res.status === 404) return [];
    if (!res.ok) return null;
    const list = (await res.json()) as unknown;
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return null;
  }
}

// GET ?target=workers|local → image models the 일관성 시트 GPU engine can use on
// that target, with the family and which references it supports.
export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("target") === "local" ? "local" : "workers";
  const lists = await Promise.all(
    FOLDERS.map((folder) => (target === "local" ? listLocal(folder) : listGpuWorkerModelFiles(folder)))
  );
  if (target === "local" && lists.every((list) => list === null)) {
    return Response.json(
      { error: "이 PC의 ComfyUI가 응답하지 않음 (실행 중인지 확인)", models: [] },
      { status: 502 }
    );
  }
  const models: { name: string; family: keyof typeof FAMILY_ORDER; person: boolean; place: boolean }[] = [];
  const seen = new Set<string>();
  for (const [i, folder] of FOLDERS.entries()) {
    for (const name of lists[i] ?? []) {
      if (seen.has(name) || !/\.(safetensors|gguf|ckpt)$/i.test(name)) continue;
      const family = await gpuSheetFamily(name);
      // Diffusion-only folders also hold video and text models: keep the image
      // families the generator can build; checkpoints default to SDXL.
      if (folder !== "checkpoints" && family === "sdxl") continue;
      seen.add(name);
      models.push({ name, family, ...GPU_FAMILY_REFERENCES[family] });
    }
  }
  models.sort((a, b) => FAMILY_ORDER[a.family] - FAMILY_ORDER[b.family] || a.name.localeCompare(b.name));
  return Response.json(
    { target, defaultModel: GPU_SHEET_MODEL, models },
    { headers: { "Cache-Control": "no-store" } }
  );
}
