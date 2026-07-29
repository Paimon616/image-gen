import { type NextRequest, NextResponse } from "next/server";
import {
  deleteWorkspace,
  isValidWorkspaceId,
  normalizeWorkspaceName,
  renameWorkspace,
} from "@/lib/workspaces";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidWorkspaceId(id)) {
    return NextResponse.json({ error: "Invalid workspace id" }, { status: 400 });
  }

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

  const workspace = await renameWorkspace(id, name);

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({ workspace });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidWorkspaceId(id)) {
    return NextResponse.json({ error: "Invalid workspace id" }, { status: 400 });
  }

  const deleted = await deleteWorkspace(id);

  if (!deleted) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
