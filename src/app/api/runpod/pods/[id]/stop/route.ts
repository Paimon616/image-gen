import { getRunpodPod } from "@/lib/settings";
import { stopRunpodPod } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await getRunpodPod(id);

  if (!pod) {
    return Response.json({ error: "RunPod target was not found." }, { status: 404 });
  }
  if (!pod.podId) {
    return Response.json({ error: "RunPod Pod ID is not configured." }, { status: 400 });
  }

  try {
    const result = await stopRunpodPod(pod.podId);
    return Response.json({ ok: true, result });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to stop RunPod." },
      { status: 500 }
    );
  }
}
