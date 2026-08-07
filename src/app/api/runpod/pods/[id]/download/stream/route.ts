import { streamRunpodResourceDownload } from "@/lib/runpod";
import type { ImportedCivitaiResource } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as {
    resource?: ImportedCivitaiResource;
    targetPath?: string;
  };

  if (!body.resource) {
    return Response.json({ error: "A Civitai resource is required." }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        send(controller, { type: "status", message: "starting" });
        const path = await streamRunpodResourceDownload(
          id,
          body.resource!,
          body.targetPath,
          (event) => send(controller, event)
        );
        send(controller, { type: "done", path });
      } catch (error) {
        send(controller, {
          type: "error",
          message: error instanceof Error ? error.message : "Failed to download to RunPod.",
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
