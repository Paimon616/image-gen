import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import type { ConsistencySheetImage } from "@/lib/consistency-sheet";

const OUTPUT_DIR = join(process.cwd(), "output", "consistency-sheet");

export async function GET() {
  try {
    const files = await readdir(OUTPUT_DIR).catch(() => [] as string[]);
    const imageFiles = files.filter((file) => /\.png$/i.test(file));

    const images = await Promise.all(
      imageFiles.map(async (filename): Promise<ConsistencySheetImage> => {
        const metaPath = join(OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));
        try {
          const meta = JSON.parse(
            await readFile(metaPath, "utf-8")
          ) as ConsistencySheetImage;
          // Trust the on-disk url but re-derive if missing.
          return {
            ...meta,
            url: meta.url || `/api/consistency-sheet/images/${filename}`,
          };
        } catch {
          // Sidecar missing/corrupt — still show the file.
          return {
            id: filename,
            url: `/api/consistency-sheet/images/${filename}`,
            filename,
            timestamp: 0,
            contentType: "image/png",
            prompt: "",
            params: null,
          };
        }
      })
    );

    images.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ images: [] });
  }
}
