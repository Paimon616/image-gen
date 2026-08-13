import { streamRunpodPulidInstall } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Installs the PuLID custom node + SDXL weight onto the pod, streaming progress
// back as SSE (same event shape as the generic node-install stream).
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamRunpodPulidInstall(id, (event) => send(controller, event));
      } catch (error) {
        send(controller, {
          type: "error",
          message: error instanceof Error ? error.message : "Failed to install PuLID on the pod.",
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
