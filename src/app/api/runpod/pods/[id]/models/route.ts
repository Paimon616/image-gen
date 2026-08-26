import { getRunpodPod } from "@/lib/settings";
import { execOnPodViaJupyter } from "@/lib/runpod";
import { hasModelExtension } from "@/lib/comfyui-model-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_MODEL_FOLDERS = new Set([
  "checkpoints",
  "diffusion_models",
  "text_encoders",
  "loras",
  "embeddings",
  "vae",
  "upscale_models",
  "controlnet",
]);

function isSafeRelativePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  return path
    .split("/")
    .every((segment) => segment && segment !== "." && segment !== "..");
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

// Deletes a model file on the pod via the Jupyter exec channel. The pod's real
// models dir is resolved by the helper at ComfyUI start (COMFYUI_MODELS_DIR),
// so probe that env var first and fall back to the conventional workspace path.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    folder?: string;
    path?: string;
  };
  const folder = String(body.folder ?? "").trim();
  const path = String(body.path ?? "").trim();

  if (!ALLOWED_MODEL_FOLDERS.has(folder)) {
    return Response.json({ error: "Invalid model folder" }, { status: 400 });
  }
  if (!isSafeRelativePath(path) || !hasModelExtension(path)) {
    return Response.json({ error: "Invalid model path" }, { status: 400 });
  }

  const pod = await getRunpodPod(id);
  if (!pod) {
    return Response.json({ error: "RunPod target was not found." }, { status: 404 });
  }

  const relative = shellQuote(`${folder}/${path}`);
  const command = [
    `deleted=""`,
    `for dir in "\${COMFYUI_MODELS_DIR:-}" /workspace/ComfyUI/models /workspace/comfyui/models /ComfyUI/models; do`,
    `  [ -n "$dir" ] || continue`,
    `  target="$dir/"${relative}`,
    `  if [ -f "$target" ]; then rm -f -- "$target" && deleted="$target"; fi`,
    `done`,
    `if [ -n "$deleted" ]; then echo "DELETED $deleted"; else echo "NOT_FOUND"; fi`,
  ].join("\n");

  try {
    const output = await execOnPodViaJupyter(pod, command, 60_000);
    const deleted = output.includes("DELETED ");

    if (!deleted) {
      return Response.json(
        { error: `${folder}/${path} was not found on the pod.` },
        { status: 404 }
      );
    }

    return Response.json({ ok: true, deleted: true, path: `${folder}/${path}` });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to delete model on pod.",
      },
      { status: 500 }
    );
  }
}
