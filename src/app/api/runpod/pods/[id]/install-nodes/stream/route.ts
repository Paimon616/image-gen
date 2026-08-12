import { streamRunpodNodeInstall, type RunpodNodeRepo } from "@/lib/runpod";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function send(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
}

// Streams custom-node install progress (git clone / pip / restart) from the pod
// helper back to the client as Server-Sent Events.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as { repos?: RunpodNodeRepo[]; restart?: boolean };
  const repos = Array.isArray(body.repos) ? body.repos : [];

  if (repos.length === 0) {
    return Response.json({ error: "No custom-node repos to install." }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await streamRunpodNodeInstall(
          id,
          repos,
          (event) => send(controller, event),
          body.restart !== false
        );
      } catch (error) {
        send(controller, {
          type: "error",
          message:
            error instanceof Error ? error.message : "Failed to install custom nodes.",
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
