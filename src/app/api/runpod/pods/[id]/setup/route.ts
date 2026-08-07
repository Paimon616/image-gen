import { getRunpodPod } from "@/lib/settings";
import { setupRunpodPod } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await getRunpodPod(id);

  if (!pod) {
    return Response.json({ error: "RunPod target was not found." }, { status: 404 });
  }

  try {
    const result = await setupRunpodPod(pod);
    return Response.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to setup RunPod." },
      { status: 500 }
    );
  }
}
