import { NextRequest, NextResponse } from "next/server";
import { readOrCreateThumbnail, toResponseBody } from "@/lib/server-images";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const image = await readOrCreateThumbnail(filename);

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
