import { type NextRequest, NextResponse } from "next/server";
import { isValidImageFilename } from "@/lib/server-images";
import { setImageWorkspaces, toggleImageWorkspace } from "@/lib/workspaces";
import { notifyWorkspaceImagesChanged } from "@/lib/runpod-share";

// POST toggles a single membership: { workspaceId, assigned }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  if (!isValidImageFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    workspaceId?: unknown;
    assigned?: unknown;
  } | null;

  if (typeof body?.workspaceId !== "string" || !body.workspaceId) {
    return NextResponse.json(
      { error: "workspaceId is required" },
      { status: 400 }
    );
  }

  const workspaces = await toggleImageWorkspace(
    filename,
    body.workspaceId,
    body.assigned !== false
  );
  // Adding/removing an image from a shared workspace re-pushes it to the pod.
  notifyWorkspaceImagesChanged();

  return NextResponse.json({ workspaces });
}

// PUT replaces the full membership set: { workspaceIds: string[] }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  if (!isValidImageFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    workspaceIds?: unknown;
  } | null;

  if (!Array.isArray(body?.workspaceIds)) {
    return NextResponse.json(
      { error: "workspaceIds array is required" },
      { status: 400 }
    );
  }

  const ids = body.workspaceIds.filter(
    (id): id is string => typeof id === "string"
  );
  const workspaces = await setImageWorkspaces(filename, ids);
  notifyWorkspaceImagesChanged();

  return NextResponse.json({ workspaces });
}
