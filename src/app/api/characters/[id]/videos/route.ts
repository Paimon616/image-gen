import { type NextRequest, NextResponse } from "next/server";
import { isValidCharacterId } from "@/lib/characters";
import {
  isVideoMedia,
  linkVideoToCharacter,
  listVideosForCharacter,
  unlinkVideoFromCharacter,
} from "@/lib/server-videos";

// Guard: linking a whole gallery at once is fine, but keep the batch bounded so
// one request can't rewrite hundreds of sidecars.
const MAX_LINK_BATCH = 100;

// Returns every generated clip tagged with this character (newest first), each
// carrying its media (videos/seedance) and situationId so the client can group
// clips under a situation — the video counterpart of the /images route.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const videos = await listVideosForCharacter(id);
  return NextResponse.json({ videos });
}

// Links existing clips to one situation of this character by tagging their
// metadata sidecars. Body: { situationId, videos: [{ media, filename }] }.
// The clips stay in their galleries; only the link is added, so a clip already
// linked elsewhere simply moves here.
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
    videos?: unknown;
  } | null;

  const situationId = body?.situationId;
  if (!isValidCharacterId(situationId)) {
    return NextResponse.json(
      { error: "Invalid situation id" },
      { status: 400 }
    );
  }

  const requested = Array.isArray(body?.videos) ? body.videos : [];
  const clips = requested.filter(
    (item): item is { media: "videos" | "seedance"; filename: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      isVideoMedia((item as { media?: unknown }).media) &&
      typeof (item as { filename?: unknown }).filename === "string" &&
      (item as { filename: string }).filename.length > 0
  );

  if (clips.length === 0) {
    return NextResponse.json({ error: "videos is required" }, { status: 400 });
  }
  if (clips.length > MAX_LINK_BATCH) {
    return NextResponse.json(
      { error: `Too many videos (max ${MAX_LINK_BATCH})` },
      { status: 400 }
    );
  }

  const linked = await Promise.all(
    clips.map(async (clip) =>
      (await linkVideoToCharacter(clip.media, id, situationId, clip.filename))
        ? clip
        : null
    )
  );
  const succeeded = linked.filter((clip): clip is (typeof clips)[number] =>
    Boolean(clip)
  );

  if (succeeded.length === 0) {
    return NextResponse.json(
      { error: "No video could be linked" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, linked: succeeded });
}

// Unlinks one clip from this character/situation (removes it from the situation
// strip) without deleting the clip file. Pass ?media=<videos|seedance>&filename=.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const media = url.searchParams.get("media");
  const filename = url.searchParams.get("filename");
  if (!isVideoMedia(media) || !filename) {
    return NextResponse.json(
      { error: "media and filename query params are required" },
      { status: 400 }
    );
  }

  const unlinked = await unlinkVideoFromCharacter(media, id, filename);
  if (!unlinked) {
    return NextResponse.json(
      { error: "Video not found for this character" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
