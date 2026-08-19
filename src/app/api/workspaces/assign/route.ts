import { type NextRequest, NextResponse } from "next/server";
import { setFileWorkspaces, toggleFileWorkspace } from "@/lib/workspaces";
import { notifyWorkspaceFilesChanged } from "@/lib/runpod-share";
import { isValidVideoFilename, isVideoMedia } from "@/lib/server-videos";
import type { WorkspaceMedia } from "@/lib/types";

// Workspace membership for the video screens. Images have their own route under
// /api/images/[filename]/workspaces (it predates this one and the gallery still
// calls it); everything else goes through here with an explicit media.
interface AssignBody {
  media?: unknown;
  filename?: unknown;
  workspaceId?: unknown;
  assigned?: unknown;
  workspaceIds?: unknown;
}

function parseTarget(body: AssignBody | null) {
  const media = isVideoMedia(body?.media)
    ? (body.media as WorkspaceMedia)
    : null;
  const filename =
    typeof body?.filename === "string" && isValidVideoFilename(body.filename)
      ? body.filename
      : null;
  return media && filename ? { media, filename } : null;
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
