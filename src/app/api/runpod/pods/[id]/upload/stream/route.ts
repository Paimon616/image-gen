import { streamRunpodModelUpload } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Pushes a local ComfyUI model file (e.g. a self-trained LoRA with no download
// source) to the pod's models tree, streaming upload progress as SSE.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { path?: string };
  const path = body.path?.trim();

  if (!path) {
    return Response.json(
      { error: "A folder-relative model path is required (e.g. loras/x.safetensors)." },
      { status: 400 }
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        send(controller, { type: "status", message: "starting" });
        const target = await streamRunpodModelUpload(id, path, (event) =>
          send(controller, event)
        );
        send(controller, { type: "done", path: target });
      } catch (error) {
        send(controller, {
          type: "error",
          message: error instanceof Error ? error.message : "Failed to upload to RunPod.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
