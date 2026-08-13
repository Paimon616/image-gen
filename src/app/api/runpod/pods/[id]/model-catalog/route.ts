import { fetchRunpodModelCatalog } from "@/lib/runpod";
import { getRunpodPod } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Returns every checkpoint / LoRA / embedding physically present on the pod as
// picker-ready descriptors (metadata auto-resolved from the merged catalog), so
// the image model picker can list them all and filter down to "on RunPod".
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const pod = await getRunpodPod(id);
    if (!pod) {
      return Response.json({ error: "RunPod target was not found." }, { status: 404 });
    }
    const catalog = await fetchRunpodModelCatalog(pod);
    return Response.json(catalog, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to read RunPod models.",
      },
      { status: 500 }
    );
  }
}
