import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { removeFileAssignments } from "@/lib/workspaces";
import { notifyWorkspaceFilesChanged } from "@/lib/runpod-share";
import { VIDEO_OUTPUT_DIR, videoContentType } from "@/lib/server-videos";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const buffer = await readFile(join(VIDEO_OUTPUT_DIR, filename));

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": videoContentType(filename),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const filepath = join(VIDEO_OUTPUT_DIR, filename);
    await unlink(filepath);
    await unlink(filepath.replace(/\.\w+$/, ".json")).catch(() => {});
    // The clip may have belonged to a shared workspace, so drop its membership
    // and let the share re-sync without it.
    await removeFileAssignments("videos", filename).catch(() => {});
    notifyWorkspaceFilesChanged();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
