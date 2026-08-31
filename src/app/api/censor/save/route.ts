import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import { OUTPUT_DIR, imageUrl, thumbnailUrl } from "@/lib/server-images";
import { VIDEO_OUTPUT_DIR, videoContentType } from "@/lib/server-videos";

// Where a censored export lands so it shows up in the existing galleries:
// images go to the image output folder, videos to the ComfyUI video gallery
// folder, each with the same uuid-stem + JSON sidecar convention the
// generators use.

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

const VIDEO_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function pickExtension(kind: "image" | "video", mimeType: string) {
  // MediaRecorder mime types carry codec suffixes ("video/webm;codecs=vp9").
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (kind === "image") return IMAGE_EXTENSIONS[base] ?? "png";
  return VIDEO_EXTENSIONS[base] ?? "webm";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const kind = formData.get("kind");
    const source = formData.get("source");

    if (!(file instanceof File) || (kind !== "image" && kind !== "video")) {
      return NextResponse.json(
        { error: "file and kind (image|video) are required" },
        { status: 400 }
      );
    }

    const id = randomUUID();
    const extension = pickExtension(kind, file.type);
    const filename = `${id}.${extension}`;
    const timestamp = Date.now();
    const buffer = Buffer.from(await file.arrayBuffer());

    const sidecar = {
      id,
      filename,
      timestamp,
      params: null,
      source: "censor",
      // Which library item (or upload) the censored copy was made from.
      censored_from: typeof source === "string" && source ? source : null,
      ...(kind === "video"
        ? { contentType: videoContentType(filename), audios: [] }
        : {}),
    };

    const dir = kind === "image" ? OUTPUT_DIR : VIDEO_OUTPUT_DIR;
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);
    await writeFile(join(dir, `${id}.json`), JSON.stringify(sidecar, null, 2));

    return NextResponse.json({
      id,
      filename,
      url:
        kind === "image" ? imageUrl(filename) : `/api/videos/${filename}`,
      ...(kind === "image" ? { thumbnailUrl: thumbnailUrl(filename) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
