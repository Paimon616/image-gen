import { checkRunpodCensorAssets } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reports whether the pod already has the video-censor prerequisites (NudeNet node
// + detector model), so the video page can show an install prompt only when needed.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const status = await checkRunpodCensorAssets(id);
    return Response.json(status);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to check censor assets.",
      },
      { status: 400 }
    );
  }
}
