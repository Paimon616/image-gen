import { cancelLoraJob } from "@/lib/lora-job-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const status = await cancelLoraJob(runId);

  if (!status) {
    return Response.json({ error: "LoRA training job was not found." }, { status: 404 });
  }

  return Response.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
