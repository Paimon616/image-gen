import { readFile, unlink } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import { removeFileAssignments } from "@/lib/workspaces";
import { CONSISTENCY_SHEET_OUTPUT_DIR as OUTPUT_DIR } from "@/lib/server-consistency-sheet";

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
    const buffer = await readFile(join(OUTPUT_DIR, filename));
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
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
    const filepath = join(OUTPUT_DIR, filename);
    await unlink(filepath);
    await unlink(filepath.replace(/\.\w+$/, ".json")).catch(() => {});
    await removeFileAssignments("consistencySheet", filename).catch(() => {});
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}
