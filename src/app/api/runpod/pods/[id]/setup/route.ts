import { getRunpodPod } from "@/lib/settings";
import {
  ensureRunpodHttpPort,
  ensureRunpodPort,
  fetchRunpodStatus,
  installRunpodHelper,
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
    // Requirement: the app must NEVER start or auto-run the pod. Helper init only
    // sets up the model-download helper on a pod the user has already started in
    // the RunPod console. If the pod is not RUNNING we stop here (no start call).
    if (pod.podId) {
      const status = await fetchRunpodStatus(pod);
      const running = String(status.podDesiredStatus || "").toUpperCase() === "RUNNING";
      if (!running) {
        return Response.json(
          {
            error:
              "Pod is not running. Start the pod in the RunPod console first, then initialize the helper.",
            podDesiredStatus: status.podDesiredStatus || "",
          },
          { status: 409 }
        );
      }
      // Config-only PATCH (no start): expose the helper (3000) and SSH (22) ports.
      // Both are no-ops when already exposed, so the pod is not disrupted.
      await ensureRunpodHttpPort(pod.podId, 3000);
      await ensureRunpodPort(pod.podId, 22, "tcp");
    }

    // installRunpodHelper prefers Jupyter (works on pods without an sshd) and
    // falls back to SSH. Retry a few times to ride out transient boot states.
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        await sleep(5_000);
      }
      try {
        const result = await installRunpodHelper(pod);
        return Response.json({
          ok: true,
          method: result.method,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        const retryable =
          message.includes("SSH public port is not exposed yet") ||
          message.includes("SSH endpoint is not accepting connections yet") ||
          message.includes("SSH endpoint timed out") ||
          message.includes("Jupyter execution timed out") ||
          message.includes("Jupyter kernel creation failed") ||
          message.includes("did not come up on port 3000");
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
