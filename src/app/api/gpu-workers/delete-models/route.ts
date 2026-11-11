import { deleteGpuWorkerModels, getGpuWorkers } from "@/lib/gpu-workers";

export const dynamic = "force-dynamic";

// POST { workerId, files: ["vae/animevae.pt"] } — removes model files on that
// GPU worker (through its helper, with the worker token) so a wrong download
// can be fetched again from the missing-files panel.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    workerId?: unknown;
    files?: unknown;
  } | null;
  const files = Array.isArray(body?.files)
    ? body.files.filter((f): f is string => typeof f === "string" && f.trim().length > 0).slice(0, 50)
    : [];
  if (files.length === 0) {
    return Response.json({ error: "files is required" }, { status: 400 });
  }
  const worker = (await getGpuWorkers()).find((w) => w.id === body?.workerId);
  if (!worker) return Response.json({ error: "GPU worker not found" }, { status: 404 });
  try {
    return Response.json({ results: await deleteGpuWorkerModels(worker, files) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
