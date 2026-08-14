import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import type { SeedanceVideo } from "@/lib/seedance";

const SEEDANCE_OUTPUT_DIR = join(process.cwd(), "output", "seedance");

export async function GET() {
  try {
    const files = await readdir(SEEDANCE_OUTPUT_DIR).catch(() => [] as string[]);
    const videoFiles = files.filter((file) => /\.mp4$/i.test(file));

    const videos = await Promise.all(
      videoFiles.map(async (filename) => {
        const metaPath = join(
          SEEDANCE_OUTPUT_DIR,
          filename.replace(/\.\w+$/, ".json")
        );
        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8")) as SeedanceVideo;
          // Trust the on-disk url but re-derive if missing.
          return { ...meta, url: meta.url || `/api/seedance/videos/${filename}` };
        } catch {
          return {
            id: filename,
            url: `/api/seedance/videos/${filename}`,
            filename,
            timestamp: 0,
            contentType: "video/mp4",
            prompt: "",
            params: null,
          } as unknown as SeedanceVideo;
        }
      })
    );

    videos.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json({ videos: [] });
  }
}
