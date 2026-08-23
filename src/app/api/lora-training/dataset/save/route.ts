import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { NextRequest } from "next/server";
import {
  trainingDatasetPath,
  safeImageExtension,
  writeTrainingDatasetMeta,
} from "@/lib/lora-training";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Persist uploaded training images (+ trigger-word captions) into
// training/datasets/<name>/ so the RunPod trainer can pick them up by name.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const triggerWords = String(form.get("triggerWords") ?? "").trim();
  const baseModel = String(form.get("baseModel") ?? "").trim();
  if (!name) return Response.json({ error: "name is required" }, { status: 400 });

  const images = form
    .getAll("images")
    .filter((v): v is File => v instanceof File && v.type.startsWith("image/"));
  if (images.length === 0) return Response.json({ error: "No images provided" }, { status: 400 });

  let dir: string;
  try {
    dir = trainingDatasetPath(name);
  } catch {
    return Response.json({ error: "Invalid dataset name" }, { status: 400 });
  }

  await mkdir(dir, { recursive: true });
  const caption = triggerWords || name;
  await writeTrainingDatasetMeta(name, {
    ...(baseModel ? { baseModel } : {}),
    triggerWords: caption,
  }).catch(() => {});
  await Promise.all(
    images.map(async (file, index) => {
      const stem = String(index + 1).padStart(3, "0");
      const ext = safeImageExtension(file);
      await writeFile(join(dir, `${stem}${ext}`), Buffer.from(await file.arrayBuffer()));
      await writeFile(join(dir, `${stem}.txt`), `${caption}\n`);
    })
  );

  return Response.json({ ok: true, name, count: images.length, dir });
}
