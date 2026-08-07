import { downloadToFile, modelPath } from "../_lib";

export const dynamic = "force-dynamic";

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
    const path = await downloadToFile({
      targetFile,
      downloadUrl,
      token: String(body.token || ""),
    });
    return Response.json({ path });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to download file." },
      { status: 400 }
    );
  }
}
