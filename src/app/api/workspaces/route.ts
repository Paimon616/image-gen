import { type NextRequest, NextResponse } from "next/server";
import {
  createWorkspace,
  getAssignments,
  isValidWorkspaceId,
  listWorkspaceSummaries,
  normalizeWorkspaceName,
  reorderWorkspaces,
} from "@/lib/workspaces";
import { listImageFilenames } from "@/lib/server-images";
import { isVideoMedia, listVideoFilenames } from "@/lib/server-videos";
import { isWorkspaceMedia, type WorkspaceMedia } from "@/lib/types";

// Workspaces themselves are shared by every screen; `media` only selects which
// files the counts are taken over (gallery images, ComfyUI videos, SeeDance
// clips). An unknown or absent value keeps the original image behaviour.
function parseMedia(request: NextRequest): WorkspaceMedia {
  const media = new URL(request.url).searchParams.get("media");
  return isWorkspaceMedia(media) ? media : "images";
}

function listFilenames(media: WorkspaceMedia) {
  return isVideoMedia(media) ? listVideoFilenames(media) : listImageFilenames();
}

export async function GET(request: NextRequest) {
  const media = parseMedia(request);

  try {
    const [workspaces, filenames, assignments] = await Promise.all([
      listWorkspaceSummaries(media),
      listFilenames(media),
      getAssignments(media),
    ]);
    // A file is "ungrouped" when it exists on disk but has no assignment.
    const ungroupedCount = filenames.filter(
      (filename) => !(assignments[filename]?.length)
    ).length;

    return NextResponse.json({ media, workspaces, ungroupedCount });
  } catch {
    return NextResponse.json({ media, workspaces: [], ungroupedCount: 0 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name = normalizeWorkspaceName(body?.name);

  if (!name) {
    return NextResponse.json(
      { error: "Workspace name is required" },
      { status: 400 }
    );
  }

  try {
    const workspace = await createWorkspace(name);
    return NextResponse.json({ workspace: { ...workspace, count: 0 } });
  } catch {
    return NextResponse.json(
      { error: "Failed to create workspace" },
      { status: 500 }
    );
  }
}

// Reorders the workspace list from a drag-and-drop in the workspace bar.
export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    orderedIds?: unknown;
  } | null;
  const orderedIds = Array.isArray(body?.orderedIds)
    ? body.orderedIds.filter(isValidWorkspaceId)
    : [];

  if (orderedIds.length === 0) {
    return NextResponse.json(
      { error: "orderedIds is required" },
      { status: 400 }
    );
  }

  try {
    await reorderWorkspaces(orderedIds);
    return NextResponse.json({
      workspaces: await listWorkspaceSummaries(parseMedia(request)),
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to reorder workspaces" },
      { status: 500 }
    );
  }
}
