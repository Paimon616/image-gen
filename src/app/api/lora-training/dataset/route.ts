import { readdir, readFile, unlink, stat } from "fs/promises";
import { NextRequest } from "next/server";
import {
  trainingDatasetsDir,
  trainingDatasetPath,
  trainingDatasetFilePath,
  readTrainingDatasetMeta,
} from "@/lib/lora-training";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function extOf(file: string) {
  return (file.split(".").pop() ?? "").toLowerCase();
}

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

// GET                      -> list all datasets (name, image count, thumbnail)
// GET ?name=X              -> list the images in a dataset
// GET ?name=X&file=001.png -> serve one image
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  const file = req.nextUrl.searchParams.get("file")?.trim();

  if (!name) {
    try {
      const root = trainingDatasetsDir();
      const entries = await readdir(root, { withFileTypes: true });
      const datasets = await Promise.all(
        entries
          .filter((e) => e.isDirectory())
          .map(async (e) => {
            try {
              const files = (await readdir(trainingDatasetPath(e.name)))
                .filter((f) => IMAGE_RE.test(f))
                .sort();
              const dirStat = await stat(trainingDatasetPath(e.name));
              const meta = await readTrainingDatasetMeta(e.name);
              return {
                name: e.name,
                count: files.length,
                updatedAt: dirStat.mtimeMs,
                baseModel: meta?.baseModel ?? null,
                triggerWords: meta?.triggerWords ?? null,
                thumbnail: files[0]
                  ? `/api/lora-training/dataset?name=${encodeURIComponent(e.name)}&file=${encodeURIComponent(files[0])}`
                  : null,
              };
            } catch {
              return null;
            }
          })
      );
      const list = datasets
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return Response.json({ datasets: list });
    } catch {
      return Response.json({ datasets: [] });
    }
  }

  if (file) {
    try {
      const path = trainingDatasetFilePath(name, file);
      const buffer = await readFile(path);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": CONTENT_TYPE[extOf(file)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    } catch {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  try {
    const dir = trainingDatasetPath(name);
    const entries = await readdir(dir);
    const meta = await readTrainingDatasetMeta(name);
    const images = entries
      .filter((f) => IMAGE_RE.test(f))
      .sort()
      .map((f) => ({
        file: f,
        url: `/api/lora-training/dataset?name=${encodeURIComponent(name)}&file=${encodeURIComponent(f)}`,
      }));
    return Response.json({
      name,
      count: images.length,
      images,
      baseModel: meta?.baseModel ?? null,
      triggerWords: meta?.triggerWords ?? null,
    });
  } catch {
    return Response.json({ name, count: 0, images: [], baseModel: null, triggerWords: null });
  }
}

// DELETE ?name=X&file=001.png -> drop an image and its caption during curation.
export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  const file = req.nextUrl.searchParams.get("file")?.trim();
  if (!name || !file) return Response.json({ error: "name and file are required" }, { status: 400 });

  try {
    const imagePath = trainingDatasetFilePath(name, file);
    await unlink(imagePath).catch(() => {});
    const captionPath = trainingDatasetFilePath(name, file.replace(/\.[^.]+$/, ".txt"));
    // Only remove the caption if it exists; ignore otherwise.
    if (await stat(captionPath).then(() => true).catch(() => false)) {
      await unlink(captionPath).catch(() => {});
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid file" }, { status: 400 });
  }
}
