import { mergePodCatalog, readPodCatalog, type PodCatalogEntry } from "../_lib";

export const dynamic = "force-dynamic";

// Runs ON the pod. Serves and updates the pod's shared model metadata catalog
// (see _lib.ts). GET returns everything downloaded to this pod; POST upserts the
// entries a client recorded after a successful download.
export async function GET() {
  try {
    const catalog = await readPodCatalog();
    return Response.json({ catalog }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to read catalog." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { entries?: unknown };
    const entries =
      body.entries && typeof body.entries === "object" && !Array.isArray(body.entries)
        ? (body.entries as Record<string, PodCatalogEntry>)
        : {};
    const catalog = await mergePodCatalog(entries);
    return Response.json({ ok: true, catalog }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update catalog." },
      { status: 400 }
    );
  }
}
