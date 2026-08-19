import { NextRequest, NextResponse } from "next/server";
import {
  deleteGeneratedImage,
  readOriginalImage,
  toResponseBody,
} from "@/lib/server-images";
import { notifyImageDeleted } from "@/lib/runpod-share";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const image = await readOriginalImage(filename);

  if (!image) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  return new NextResponse(toResponseBody(image.buffer), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;
    const deleted = await deleteGeneratedImage(filename);

    if (!deleted) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    // The image may have belonged to a shared workspace or a shared character's
    // situation strip; re-push both so the pod copy drops it too.
    notifyImageDeleted();

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ methods: ["GET", "DELETE"] });
}
