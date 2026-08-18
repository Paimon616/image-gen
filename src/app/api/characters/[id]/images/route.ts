import { type NextRequest, NextResponse } from "next/server";
import { isValidCharacterId } from "@/lib/characters";
import {
  listImagesForCharacter,
  unlinkImageFromCharacter,
} from "@/lib/server-images";

// Returns every generated image tagged with this character (newest first), each
// carrying its situationId so the client can group thumbnails under a situation.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const images = await listImagesForCharacter(id);
  return NextResponse.json({ images });
}

// Unlinks one image from this character/situation (removes its thumbnail from the
// situation list) without deleting the image file. Pass ?filename=<image file>.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const filename = new URL(request.url).searchParams.get("filename");
  if (!filename) {
    return NextResponse.json(
      { error: "filename query param is required" },
      { status: 400 }
    );
  }

  const unlinked = await unlinkImageFromCharacter(id, filename);
  if (!unlinked) {
    return NextResponse.json(
      { error: "Image not found for this character" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
