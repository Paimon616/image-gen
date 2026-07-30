import { readFile } from "fs/promises";
import { join } from "path";
import { type NextRequest, NextResponse } from "next/server";
import { isValidImageFilename, OUTPUT_DIR, toResponseBody } from "@/lib/server-images";
import { buildZipArchive } from "@/lib/zip";

const MAX_BATCH_SIZE = 200;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    filenames?: unknown;
  } | null;

  if (!Array.isArray(body?.filenames) || body.filenames.length === 0) {
    return NextResponse.json(
      { error: "filenames array is required" },
      { status: 400 }
    );
  }

  const filenames = Array.from(
    new Set(body.filenames.filter((name): name is string => typeof name === "string"))
  );

  if (filenames.some((name) => !isValidImageFilename(name))) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  if (filenames.length > MAX_BATCH_SIZE) {
    return NextResponse.json(
      { error: `Cannot zip more than ${MAX_BATCH_SIZE} images at once` },
      { status: 400 }
    );
  }

  const entries = (
    await Promise.all(
      filenames.map(async (filename) => {
        const data = await readFile(join(OUTPUT_DIR, filename)).catch(() => null);
        return data ? { name: filename, data } : null;
      })
    )
  ).filter(Boolean) as { name: string; data: Buffer }[];

  if (entries.length === 0) {
    return NextResponse.json({ error: "No images found" }, { status: 404 });
  }

  const archive = buildZipArchive(entries);

  return new NextResponse(toResponseBody(archive), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="images-${Date.now()}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
