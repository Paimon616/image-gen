import { NextRequest, NextResponse } from "next/server";
import { readFile, readdir, unlink } from "fs/promises";
import { join } from "path";

const OUTPUT_DIR = join(process.cwd(), "output");

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    if (filename.includes("..") || filename.includes("/")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const filepath = join(OUTPUT_DIR, filename);
    const buffer = await readFile(filepath);

    const ext = filename.split(".").pop()?.toLowerCase();
    const contentType =
      ext === "png" ? "image/png" : "image/jpeg";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await params;

    if (filename.includes("..") || filename.includes("/")) {
      return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
    }

    const filepath = join(OUTPUT_DIR, filename);
    await unlink(filepath);

    const metaPath = filepath.replace(/\.\w+$/, ".json");
    await unlink(metaPath).catch(() => {});

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json({ methods: ["GET", "DELETE"] });
}

export async function PUT() {
  try {
    const files = await readdir(OUTPUT_DIR).catch(() => [] as string[]);
    const imageFiles = files.filter((f) =>
      /\.(png|jpe?g|webp)$/i.test(f)
    );

    const images = await Promise.all(
      imageFiles.map(async (filename) => {
        const metaPath = join(
          OUTPUT_DIR,
          filename.replace(/\.\w+$/, ".json")
        );
        try {
          const meta = JSON.parse(await readFile(metaPath, "utf-8"));
          return {
            id: meta.id,
            url: `/api/images/${filename}`,
            filename,
            params: meta.params,
            timestamp: meta.timestamp,
          };
        } catch {
          return {
            id: filename,
            url: `/api/images/${filename}`,
            filename,
            params: null,
            timestamp: 0,
          };
        }
      })
    );

    images.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ images: [] });
  }
}
