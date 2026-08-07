import { downloadRunpodResource } from "@/lib/runpod";
import type { ImportedCivitaiResource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    resource?: ImportedCivitaiResource;
    targetPath?: string;
  };

  if (!body.resource) {
    return Response.json({ error: "A Civitai resource is required." }, { status: 400 });
  }

  try {
    const path = await downloadRunpodResource(id, body.resource, body.targetPath);
    return Response.json({ ok: true, path });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to download to RunPod." },
      { status: 500 }
    );
  }
}
