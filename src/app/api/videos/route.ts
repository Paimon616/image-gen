import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import { getAssignments } from "@/lib/workspaces";
import { VIDEO_OUTPUT_DIR, videoContentType } from "@/lib/server-videos";

export async function GET() {
  try {
    const [files, assignments] = await Promise.all([
      readdir(VIDEO_OUTPUT_DIR).catch(() => [] as string[]),
      // Which workspaces each clip belongs to, so the gallery can filter by the
      // workspace chip without a second request per video.
      getAssignments("videos").catch(() => ({}) as Record<string, string[]>),
    ]);
    const videoFiles = files.filter((file) => /\.(mp4|webm|gif)$/i.test(file));

    const videos = await Promise.all(
      videoFiles.map(async (filename) => {
        const metaPath = join(VIDEO_OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));
        const workspaces = assignments[filename] ?? [];

        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));

          return {
            id: meta.id,
            url: `/api/videos/${filename}`,
            filename,
            params: meta.params,
            timestamp: meta.timestamp,
            contentType: meta.contentType ?? videoContentType(filename),
            audios: Array.isArray(meta.audios) ? meta.audios : [],
            workspaces,
          };
        } catch {
          return {
            id: filename,
            url: `/api/videos/${filename}`,
            filename,
            params: null,
            timestamp: 0,
            contentType: videoContentType(filename),
            audios: [],
            workspaces,
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
