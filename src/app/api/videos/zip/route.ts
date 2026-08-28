import { readFile } from "fs/promises";
import { join } from "path";
import { type NextRequest, NextResponse } from "next/server";
import { toResponseBody } from "@/lib/server-images";
import {
  isValidVideoFilename,
  isVideoMedia,
  videoOutputDir,
  type VideoMedia,
} from "@/lib/server-videos";
import { buildZipArchive } from "@/lib/zip";

const MAX_BATCH_SIZE = 200;

// Bundles clips from either video surface (ComfyUI videos or SeeDance) into
// one zip — the video counterpart of /api/images/zip.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    media?: unknown;
    filenames?: unknown;
  } | null;

  const media: VideoMedia = isVideoMedia(body?.media) ? body.media : "videos";

  if (!Array.isArray(body?.filenames) || body.filenames.length === 0) {
    return NextResponse.json(
      { error: "filenames array is required" },
      { status: 400 }
    );
  }

  const filenames = Array.from(
    new Set(body.filenames.filter((name): name is string => typeof name === "string"))
  );

  if (filenames.some((name) => !isValidVideoFilename(name))) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  if (filenames.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Cannot zip more than ${MAX_BATCH_SIZE} videos at once` },
      { status: 400 }
    );
  }

  const dir = videoOutputDir(media);
  const entries = (
    await Promise.all(
      filenames.map(async (filename) => {
        const data = await readFile(join(dir, filename)).catch(() => null);
        return data ? { name: filename, data } : null;
      })
    )
  ).filter(Boolean) as { name: string; data: Buffer }[];

  if (entries.length === 0) {
    return NextResponse.json({ error: "No videos found" }, { status: 404 });
  }

  const archive = buildZipArchive(entries);

  return new NextResponse(toResponseBody(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${media}-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
