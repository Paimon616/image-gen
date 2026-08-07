import { fileExists, modelPath } from "../_lib";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { files?: unknown };
    const files = Array.isArray(body.files) ? body.files.map(String) : [];
    const result = await Promise.all(
      files.map(async (path) => ({
        path,
        exists: await fileExists(modelPath(path)),
      }))
    );
    return Response.json({ files: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to check files." },
      { status: 400 }
    );
  }
}
