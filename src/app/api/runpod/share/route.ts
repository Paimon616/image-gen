import { type NextRequest, NextResponse } from "next/server";
import {
  isShareKind,
  isValidShareId,
  listRemoteShares,
  listSharePods,
  pushShare,
  resolveSharePod,
  readShareState,
  unshare,
} from "@/lib/runpod-share";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseKind(request: NextRequest) {
  const kind = new URL(request.url).searchParams.get("kind");
  return isShareKind(kind) ? kind : null;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

// Lists what is currently shared on the pod, for the download picker. `pods` is
// returned alongside so the picker can offer a target when several are set up.
export async function GET(request: NextRequest) {
  const kind = parseKind(request);
  if (!kind) {
    return NextResponse.json({ error: "Invalid share kind" }, { status: 400 });
  }

  const requestedPodId = new URL(request.url).searchParams.get("podId");
  const pods = await listSharePods().catch(() => []);
  // Resolved up front so a failed listing still tells the client which pod it
  // was talking to — otherwise the dialog's pod selector would show one pod
  // while its state held none.
  const resolvedPodId = await resolveSharePod(requestedPodId)
    .then((pod) => pod.id)
    .catch(() => requestedPodId ?? pods[0]?.id ?? "");

  try {
    const { items } = await listRemoteShares(kind, resolvedPodId);
    return NextResponse.json({ pods, podId: resolvedPodId, items });
  } catch (error) {
    // A stopped or unreachable pod is an expected state, not a server fault:
    // report it so the dialog can show the reason next to an empty list.
    return NextResponse.json({
      pods,
      podId: resolvedPodId,
      items: [],
      error: errorMessage(error, "RunPod 공유 목록을 불러오지 못했습니다."),
    });
  }
}

// Uploads a workspace/character and its images to the pod.
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
    const result = await pushShare(
      kind,
      body.id as string,
      typeof body.podId === "string" ? body.podId : null
    );
    const state = await readShareState();
    return NextResponse.json({
      share: state[kind][body.id as string] ?? null,
      uploaded: result.uploaded,
      imageCount: result.imageCount,
      videoCount: result.videoCount,
      podLabel: result.pod.label || result.pod.podId,
    });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "RunPod 공유에 실패했습니다.") },
      { status: 502 }
    );
  }
}

// Removes the share from the pod and forgets it locally (the local workspace /
// character itself is untouched).
export async function DELETE(request: NextRequest) {
  const kind = parseKind(request);
  const id = new URL(request.url).searchParams.get("id");

  if (!kind || !isValidShareId(kind, id)) {
    return NextResponse.json({ error: "Invalid share target" }, { status: 400 });
  }

  try {
    await unshare(kind, id as string);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: errorMessage(error, "공유 해제에 실패했습니다.") },
      { status: 500 }
    );
  }
}
