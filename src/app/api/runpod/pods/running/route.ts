import { readSettings } from "@/lib/settings";
import { fetchRunpodDesiredStatusMap } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Returns the running state of every configured pod in one RunPod REST call, so
// the client can auto-select a running pod when RunPod mode is toggled on and
// flag running pods in the target dropdown. Optionally filtered by ?kind=.
export async function GET(req: Request) {
  const settings = await readSettings();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");

  let statusMap: Record<string, string> = {};
  let error = "";
  try {
    statusMap = await fetchRunpodDesiredStatusMap();
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Failed to query RunPod.";
  }

  const pods = settings.runpodPods
    .filter((pod) => (kind ? pod.kind === kind : true))
    .map((pod) => {
      const desiredStatus = statusMap[pod.podId] ?? "";
      return {
        id: pod.id,
        podId: pod.podId,
        desiredStatus,
        running: desiredStatus.toUpperCase() === "RUNNING",
      };
    });

  return Response.json(
    { pods, error },
    { headers: { "Cache-Control": "no-store" } }
  );
}
