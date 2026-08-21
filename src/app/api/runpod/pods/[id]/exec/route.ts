import { getRunpodPod } from "@/lib/settings";
import { execOnPodViaJupyter } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Runs a shell command on the pod via the Jupyter channel (proxy-stable). Used to
// provision/inspect the pod for RunPod-side LoRA training. Local single-user tool.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { command?: string; timeoutMs?: number };
  const command = String(body.command ?? "").trim();
  if (!command) return Response.json({ error: "command is required" }, { status: 400 });

  const pod = await getRunpodPod(id);
  if (!pod) return Response.json({ error: "RunPod target was not found." }, { status: 404 });

  try {
    const output = await execOnPodViaJupyter(pod, command, body.timeoutMs ?? 120_000);
    return Response.json({ ok: true, output });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Command failed." },
      { status: 500 }
    );
  }
}
