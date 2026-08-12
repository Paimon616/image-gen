import { collectImageWorkflowNodePacks } from "@/lib/runpod";
import { getRunpodPod } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Report which custom-node repos the given image workflow (e.g. the PornMaster
// RES4LYF recipe) still needs on this pod. Reads the pod's live /object_info so
// only genuinely missing packs are returned; the client streams them to the
// install-nodes endpoint.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const workflow = new URL(req.url).searchParams.get("workflow") ?? "generic";

  try {
    const pod = await getRunpodPod(id);
    if (!pod) {
      return Response.json({ error: "RunPod target was not found." }, { status: 404 });
    }
    const result = await collectImageWorkflowNodePacks(pod, workflow);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resolve workflow nodes.",
      },
      { status: 500 }
    );
  }
}
