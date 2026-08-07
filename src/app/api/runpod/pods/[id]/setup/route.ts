import { getRunpodPod } from "@/lib/settings";
import {
  ensureRunpodHttpPort,
  ensureRunpodPort,
  setupRunpodPod,
  startRunpodPod,
} from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pod = await getRunpodPod(id);

  if (!pod) {
    return Response.json({ error: "RunPod target was not found." }, { status: 404 });
  }

  try {
    if (pod.podId) {
      await ensureRunpodHttpPort(pod.podId, 3000);
      await ensureRunpodPort(pod.podId, 22, "tcp");
      await startRunpodPod(pod.podId).catch(() => {});
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0 || pod.podId) {
        await sleep(5_000);
      }
      try {
        const result = await setupRunpodPod(pod);
        return Response.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        const retryable =
          message.includes("SSH public port is not exposed yet") ||
          message.includes("SSH endpoint is not accepting connections yet") ||
          message.includes("SSH endpoint timed out");
        if (!retryable) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Failed to setup RunPod.");
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to setup RunPod." },
      { status: 500 }
    );
  }
}
