import { type NextRequest, NextResponse } from "next/server";
import {
  createWorkspace,
  getAssignments,
  listWorkspaceSummaries,
  normalizeWorkspaceName,
} from "@/lib/workspaces";
import { listImageFilenames } from "@/lib/server-images";

export async function GET() {
  try {
    const [workspaces, filenames, assignments] = await Promise.all([
      listWorkspaceSummaries(),
      listImageFilenames(),
      getAssignments(),
    ]);
    // An image is "ungrouped" when it exists on disk but has no assignment.
    const ungroupedCount = filenames.filter(
      (filename) => !(assignments[filename]?.length)
    ).length;

    return NextResponse.json({ workspaces, ungroupedCount });
  } catch {
    return NextResponse.json({ workspaces: [], ungroupedCount: 0 });
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
