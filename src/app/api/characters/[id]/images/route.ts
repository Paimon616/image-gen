import { type NextRequest, NextResponse } from "next/server";
import { isValidCharacterId } from "@/lib/characters";
import {
  linkImageToCharacter,
  listImagesForCharacter,
  unlinkImageFromCharacter,
} from "@/lib/server-images";
import { notifyCharacterChanged } from "@/lib/runpod-share";

// Guard: linking a whole gallery page at once is fine, but keep the batch bounded
// so one request can't rewrite thousands of sidecars.
const MAX_LINK_BATCH = 100;

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

// Links existing gallery images to one situation of this character by tagging
// their metadata sidecars. Body: { situationId, filenames: string[] } (a single
// `filename` is accepted too). The images stay in the gallery; only the link is
// added, so an image already linked elsewhere simply moves here.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    situationId?: unknown;
    filename?: unknown;
    filenames?: unknown;
  } | null;

  const situationId = body?.situationId;
  if (!isValidCharacterId(situationId)) {
    return NextResponse.json(
      { error: "Invalid situation id" },
      { status: 400 }
    );
  }

  const requested = Array.isArray(body?.filenames)
    ? body.filenames
    : [body?.filename];
  const filenames = requested.filter(
    (name): name is string => typeof name === "string" && name.length > 0
  );

  if (filenames.length === 0) {
    return NextResponse.json(
      { error: "filenames is required" },
      { status: 400 }
    );
  }
  if (filenames.length > MAX_LINK_BATCH) {
    return NextResponse.json(
      { error: `Too many images (max ${MAX_LINK_BATCH})` },
      { status: 400 }
    );
  }

  const linked = await Promise.all(
    filenames.map(async (filename) =>
      (await linkImageToCharacter(id, situationId, filename)) ? filename : null
    )
  );
  const succeeded = linked.filter((name): name is string => Boolean(name));

  if (succeeded.length === 0) {
    return NextResponse.json(
      { error: "No image could be linked" },
      { status: 404 }
    );
  }

  // Newly attached images belong to the share too.
  void notifyCharacterChanged(id).catch(() => {});

  return NextResponse.json({ success: true, linked: succeeded });
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

  void notifyCharacterChanged(id).catch(() => {});

  return NextResponse.json({ success: true });
}
