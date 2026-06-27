import { type NextRequest, NextResponse } from "next/server";
import {
  listGeneratedImages,
  parseImageListQuery,
} from "@/lib/server-images";

export async function GET(request: NextRequest) {
  try {
    const query = parseImageListQuery(request.nextUrl.searchParams);
    return NextResponse.json(await listGeneratedImages(query));
  } catch {
    return NextResponse.json({ images: [], nextCursor: null, total: 0 });
  }
}
