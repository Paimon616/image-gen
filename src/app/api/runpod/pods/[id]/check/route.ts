import { getRunpodPod } from "@/lib/settings";
import { checkRunpodGenerationFiles } from "@/lib/runpod";
import type { GenerationParams, ImportedCivitaiResource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await getRunpodPod(id);

  if (!pod) {
    return Response.json({ error: "RunPod target was not found." }, { status: 404 });
  }

  try {
    const body = (await req.json()) as {
      params?: GenerationParams;
      resources?: ImportedCivitaiResource[];
    };
    if (!body.params) {
      return Response.json({ error: "Generation params are required." }, { status: 400 });
    }
    const missing = await checkRunpodGenerationFiles(
      pod,
      body.params,
      Array.isArray(body.resources) ? body.resources : []
    );
    return Response.json({ missing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to check RunPod files." },
      { status: 500 }
    );
  }
}
