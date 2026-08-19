import { type NextRequest, NextResponse } from "next/server";
import { isShareKind, readShareState } from "@/lib/runpod-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Which workspaces / characters this machine has shared, read from local state
// only — no pod round-trip, so the workspace bar and character list can badge
// shared items on every load without waiting on RunPod.
export async function GET(request: NextRequest) {
  const kind = new URL(request.url).searchParams.get("kind");
  const state = await readShareState();

  if (isShareKind(kind)) {
    return NextResponse.json({ shares: state[kind] });
  }
  return NextResponse.json(state);
}
