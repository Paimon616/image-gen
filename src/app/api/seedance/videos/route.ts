import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import type { SeedanceVideo } from "@/lib/seedance";
import { getAssignments } from "@/lib/workspaces";
import { SEEDANCE_OUTPUT_DIR } from "@/lib/server-videos";

export async function GET() {
  try {
    const [files, assignments] = await Promise.all([
      readdir(SEEDANCE_OUTPUT_DIR).catch(() => [] as string[]),
      // Workspace membership rides along so the results grid can filter by the
      // workspace chip the same way the image gallery does.
      getAssignments("seedance").catch(() => ({}) as Record<string, string[]>),
    ]);
    const videoFiles = files.filter((file) => /\.mp4$/i.test(file));

    const videos = await Promise.all(
      videoFiles.map(async (filename) => {
        const metaPath = join(
          SEEDANCE_OUTPUT_DIR,
          filename.replace(/\.\w+$/, ".json")
        );
        const workspaces = assignments[filename] ?? [];
        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8")) as SeedanceVideo;
          // Trust the on-disk url but re-derive if missing.
          return {
            ...meta,
            url: meta.url || `/api/seedance/videos/${filename}`,
            workspaces,
          };
        } catch {
          return {
            id: filename,
            url: `/api/seedance/videos/${filename}`,
            filename,
            timestamp: 0,
            contentType: "video/mp4",
            prompt: "",
            params: null,
            workspaces,
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
