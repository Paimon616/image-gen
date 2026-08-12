import { collectVideoPipelineModels } from "@/lib/video-pipeline-models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Lists the model files the given video pipeline's workflow needs, each resolved
// (via data/model-catalog.json) to a download resource + pod-relative targetPath.
// The client feeds the resolvable ones straight into the RunPod download store;
// the pod helper skips files already present, so downloading the full set is
// idempotent and no separate presence check is required here.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    const { pipelineId, label, models } = await collectVideoPipelineModels(id);
    const downloadable = models.filter((model) => model.hasUrl).length;
    return Response.json({
      pipelineId,
      label,
      total: models.length,
      downloadable,
      missingSource: models.filter((model) => !model.hasUrl).map((model) => model.path),
      models,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to resolve pipeline models.",
      },
      { status: 500 }
    );
  }
}
