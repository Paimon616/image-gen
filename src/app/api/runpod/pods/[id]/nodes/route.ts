import { fetchRunpodInstalledNodeTypes } from "@/lib/runpod";
import { getRunpodPod } from "@/lib/settings";
import { collectVideoPipelineNodePacks } from "@/lib/video-pipeline-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Resolve which custom-node git repos the given pipeline needs on this pod. Reads
// the pod's live node list (/object_info) so only genuinely missing nodes are
// reported; the client streams the returned repos to the install endpoint.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pipeline = new URL(req.url).searchParams.get("pipeline") ?? undefined;

  try {
    const pod = await getRunpodPod(id);
    if (!pod) {
      return Response.json({ error: "RunPod target was not found." }, { status: 404 });
    }
    const installed = await fetchRunpodInstalledNodeTypes(pod);
    const result = await collectVideoPipelineNodePacks(pipeline, installed);
    return Response.json({ ...result, comfyReachable: Boolean(installed) });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resolve pipeline nodes.",
      },
      { status: 500 }
    );
  }
}
