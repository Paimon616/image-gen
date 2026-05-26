import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

const OUTPUT_DIR = join(process.cwd(), "output");

export async function GET() {
  try {
    const files = await readdir(OUTPUT_DIR).catch(() => [] as string[]);
    const imageFiles = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f));

    const images = await Promise.all(
      imageFiles.map(async (filename) => {
        const metaPath = join(
          OUTPUT_DIR,
          filename.replace(/\.\w+$/, ".json")
        );
        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));
          return {
            id: meta.id,
            url: `/api/images/${filename}`,
            filename,
            params: meta.params,
            timestamp: meta.timestamp,
          };
        } catch {
          return {
            id: filename,
            url: `/api/images/${filename}`,
            filename,
            params: null,
            timestamp: 0,
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
