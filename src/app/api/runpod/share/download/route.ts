import { type NextRequest, NextResponse } from "next/server";
import { isShareKind, isValidShareId, pullShare } from "@/lib/runpod-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Pulling a large workspace transfers every image it holds.
export const maxDuration = 600;

// Downloads a shared workspace (or character) from the pod into this machine:
// the images land in the gallery, the workspace/character record is created (or
// refreshed) under the same id it has on the pod.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    kind?: unknown;
    id?: unknown;
    podId?: unknown;
  } | null;

  const kind = isShareKind(body?.kind) ? body.kind : null;
  if (!kind || !isValidShareId(kind, body?.id)) {
    return NextResponse.json({ error: "Invalid share target" }, { status: 400 });
  }

  try {
    const result = await pullShare(
      kind,
      body.id as string,
      typeof body.podId === "string" ? body.podId : null
    );
    return NextResponse.json({
      success: true,
      name: result.name,
      downloaded: result.downloaded,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message
            ? error.message
            : "다운로드에 실패했습니다.",
      },
      { status: 502 }
    );
  }
}
