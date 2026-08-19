import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { removeFileAssignments } from "@/lib/workspaces";
import { notifyWorkspaceFilesChanged } from "@/lib/runpod-share";
import { SEEDANCE_OUTPUT_DIR } from "@/lib/server-videos";

function isSafe(filename: string) {
  return !(
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\")
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    if (!isSafe(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    const buffer = await readFile(join(SEEDANCE_OUTPUT_DIR, filename));
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "video/mp4",
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
    if (!isSafe(filename)) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }
    const filepath = join(SEEDANCE_OUTPUT_DIR, filename);
    await unlink(filepath);
    await unlink(filepath.replace(/\.\w+$/, ".json")).catch(() => {});
    await removeFileAssignments("seedance", filename).catch(() => {});
    notifyWorkspaceFilesChanged();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
