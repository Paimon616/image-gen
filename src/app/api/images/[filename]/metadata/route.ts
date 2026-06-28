import { NextRequest, NextResponse } from "next/server";
import { readImageMetadata, toResponseBody } from "@/lib/server-images";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  const metadata = await readImageMetadata(filename);

  if (!metadata) {
    return NextResponse.json({ error: "Metadata not found" }, { status: 404 });
  }

  return new NextResponse(toResponseBody(metadata), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
