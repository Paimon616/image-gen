export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    ok: true,
    message: "RunPod Image Gen helper ready",
    comfyModelsDir: process.env.COMFYUI_MODELS_DIR || "/workspace/ComfyUI/models",
  });
}
