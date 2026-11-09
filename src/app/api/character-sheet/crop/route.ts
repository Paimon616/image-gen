import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

import { squareCropRect } from "@/lib/character-sheet";
import {
  imageUrl,
  isValidImageFilename,
  OUTPUT_DIR,
  SHEET_CROP_PREFIX,
  thumbnailUrl,
} from "@/lib/server-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// BETA 기준 시트 — 참조 영역. Cuts a square face/upper-body crop out of a
// confirmed sheet and saves it next to the gallery images. IP-Adapter then sees
// one figure instead of the multi-view sheet (which duplicated characters in
// scenes during evaluation; docs/character-reference-sheet.md).
// Body: { filename, x, y, size } — x/y normalized to the sheet, size × width.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    filename?: unknown;
    x?: unknown;
    y?: unknown;
    size?: unknown;
  } | null;
  const filename = typeof body?.filename === "string" ? body.filename : "";
  const nums = [body?.x, body?.y, body?.size].map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : NaN
  );
  if (!isValidImageFilename(filename) || nums.some((value) => Number.isNaN(value) || value < 0 || value > 1)) {
    return Response.json({ error: "Invalid crop request." }, { status: 400 });
  }
  const [x, y, size] = nums;

  let source: Buffer;
  try {
    source = await readFile(join(OUTPUT_DIR, filename));
  } catch {
    return Response.json({ error: "Sheet image not found." }, { status: 404 });
  }
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) {
    return Response.json({ error: "Unreadable sheet image." }, { status: 400 });
  }
  const rect = squareCropRect(meta.width, meta.height, { x, y, size });
  const out = `${SHEET_CROP_PREFIX}${randomUUID()}.png`;
  await writeFile(
    join(OUTPUT_DIR, out),
    await sharp(source)
      .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      .png()
      .toBuffer()
  );
  return Response.json({
    crop: { url: imageUrl(out), filename: out, ...rect.normalized },
    thumbnailUrl: thumbnailUrl(out),
  });
}
