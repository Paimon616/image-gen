import { getRunpodPod } from "@/lib/settings";
import { ensureRunpodStatus, fetchRunpodStatus } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await getRunpodPod(id);

  if (!pod) {
    return Response.json({ error: "RunPod target was not found." }, { status: 404 });
  }

  try {
    const url = new URL(_req.url);
    const auto = url.searchParams.get("auto") === "1";
    const ensure = !auto && url.searchParams.get("ensure") === "1";
    return Response.json(await (ensure ? ensureRunpodStatus(pod) : fetchRunpodStatus(pod)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to check RunPod." },
      { status: 500 }
    );
  }
}
