import { downloadToFile, modelPath } from "../../_lib";

export const dynamic = "force-dynamic";

function sse(event: unknown) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      targetFile?: unknown;
      downloadUrl?: unknown;
      token?: unknown;
    };
    const targetFile = modelPath(String(body.targetFile || ""));
    const downloadUrl = String(body.downloadUrl || "").trim();
    if (!downloadUrl) throw new Error("Download URL is required.");

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (event: unknown) => controller.enqueue(encoder.encode(sse(event)));
        try {
          await downloadToFile({
            targetFile,
            downloadUrl,
            token: String(body.token || ""),
            onProgress: (downloaded, total) => {
              send({
                type: total > 0 && downloaded >= total ? "status" : "progress",
                path: targetFile,
                downloaded,
                total,
                percent: total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
              });
            },
          });
          send({ type: "complete", path: targetFile, percent: 100 });
        } catch (error) {
          send({
            type: "status",
            message: error instanceof Error ? error.message : "Download failed.",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to download file." },
      { status: 400 }
    );
  }
}
