import { type NextRequest, NextResponse } from "next/server";
import { setFileWorkspaces, toggleFileWorkspace } from "@/lib/workspaces";
import { notifyWorkspaceFilesChanged } from "@/lib/runpod-share";
import { isValidVideoFilename, isVideoMedia } from "@/lib/server-videos";
import type { WorkspaceMedia } from "@/lib/types";

// Workspace membership for the video and consistency-sheet screens. Images have
// their own route under /api/images/[filename]/workspaces (it predates this one
// and the gallery still calls it); everything else goes through here with an
// explicit media.
interface AssignBody {
  media?: unknown;
  filename?: unknown;
  workspaceId?: unknown;
  assigned?: unknown;
  workspaceIds?: unknown;
}

// Consistency sheets are stills, so they never match the video filename rules.
const SHEET_FILENAME_PATTERN = /^[\w.-]+\.(png|jpe?g|webp)$/i;

function parseTarget(body: AssignBody | null) {
  const filename = typeof body?.filename === "string" ? body.filename : null;
  if (!filename || filename.includes("..")) return null;

  if (body?.media === "consistencySheet") {
    return SHEET_FILENAME_PATTERN.test(filename)
      ? { media: "consistencySheet" as WorkspaceMedia, filename }
      : null;
  }
  if (isVideoMedia(body?.media) && isValidVideoFilename(filename)) {
    return { media: body.media as WorkspaceMedia, filename };
  }
  return null;
}

// POST toggles a single membership: { media, filename, workspaceId, assigned }
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AssignBody | null;
  const target = parseTarget(body);

  if (!target) {
    return NextResponse.json(
      { error: "A valid media and filename are required" },
      { status: 400 }
    );
  }
  if (typeof body?.workspaceId !== "string" || !body.workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const workspaces = await toggleFileWorkspace(
    target.media,
    target.filename,
    body.workspaceId,
    body.assigned !== false
  );
  // Adding/removing a video from a shared workspace re-pushes it to the pod.
  notifyWorkspaceFilesChanged();

  return NextResponse.json({ workspaces });
}

// PUT replaces the full membership set: { media, filename, workspaceIds }
export async function PUT(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AssignBody | null;
  const target = parseTarget(body);

  if (!target) {
    return NextResponse.json(
      { error: "A valid media and filename are required" },
      { status: 400 }
    );
  }
  if (!Array.isArray(body?.workspaceIds)) {
    return NextResponse.json(
      { error: "workspaceIds array is required" },
      { status: 400 }
    );
  }

  const ids = body.workspaceIds.filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
  const workspaces = await setFileWorkspaces(target.media, target.filename, ids);
  notifyWorkspaceFilesChanged();

  return NextResponse.json({ workspaces });
}
