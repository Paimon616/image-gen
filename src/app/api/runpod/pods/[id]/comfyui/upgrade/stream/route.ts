import { streamRunpodComfyUpgrade } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Streams ComfyUI in-place upgrade progress (git checkout / pip / restart) from
// the pod helper back to the client as Server-Sent Events. The target ref is
// pinned server-side in comfyui-config/comfyui-version.txt.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamRunpodComfyUpgrade(id, (event) => send(controller, event));
      } catch (error) {
        send(controller, {
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to upgrade ComfyUI.",
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
