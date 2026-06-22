import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";

const VIDEO_OUTPUT_DIR = join(process.cwd(), "output", "videos");

function contentTypeFor(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".gif")) return "image/gif";
  return "video/mp4";
}

export async function GET() {
  try {
    const files = await readdir(VIDEO_OUTPUT_DIR).catch(() => [] as string[]);
    const videoFiles = files.filter((file) => /\.(mp4|webm|gif)$/i.test(file));

    const videos = await Promise.all(
      videoFiles.map(async (filename) => {
        const metaPath = join(VIDEO_OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));

        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));

          return {
            id: meta.id,
            url: `/api/videos/${filename}`,
            filename,
            params: meta.params,
            timestamp: meta.timestamp,
            contentType: meta.contentType ?? contentTypeFor(filename),
            audios: Array.isArray(meta.audios) ? meta.audios : [],
          };
        } catch {
          return {
            id: filename,
            url: `/api/videos/${filename}`,
            filename,
            params: null,
            timestamp: 0,
            contentType: contentTypeFor(filename),
            audios: [],
          };
        }
      })
    );

    videos.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ videos });
  } catch {
    return NextResponse.json({ videos: [] });
  }
}
