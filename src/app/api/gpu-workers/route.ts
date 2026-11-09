import { getGpuWorkerStatuses, invalidateGpuWorkerModels } from "@/lib/gpu-workers";

export const dynamic = "force-dynamic";

// Live status of every registered GPU worker (online, GPU, VRAM, queue depth,
// in-flight reservations). Used by the generator page and the bench script.
export async function GET() {
  const workers = await getGpuWorkerStatuses();
  return Response.json(
    { workers },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// POST { action: "refresh-models", workerId? } drops cached /models listings
// after a worker synced new files.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    workerId?: string;
  };
  if (body.action !== "refresh-models") {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }
  invalidateGpuWorkerModels(body.workerId);
  return Response.json({ ok: true });
}
