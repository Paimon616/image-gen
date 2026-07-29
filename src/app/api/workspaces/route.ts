import { type NextRequest, NextResponse } from "next/server";
import {
  createWorkspace,
  listWorkspaceSummaries,
  normalizeWorkspaceName,
} from "@/lib/workspaces";

export async function GET() {
  try {
    return NextResponse.json({ workspaces: await listWorkspaceSummaries() });
  } catch {
    return NextResponse.json({ workspaces: [] });
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
