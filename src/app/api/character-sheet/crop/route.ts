import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

import { DEFAULT_SHEET_CROP, squareCropRect } from "@/lib/character-sheet";
import { findSheetFocus } from "@/lib/sheet-auto-crop";
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
// Or { filename, auto: true } — find the front-facing figure's head-to-chest
// square (lib/sheet-auto-crop); falls back to DEFAULT_SHEET_CROP.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    filename?: unknown;
    auto?: unknown;
    x?: unknown;
    y?: unknown;
    size?: unknown;
  } | null;
  const filename = typeof body?.filename === "string" ? body.filename : "";
  const auto = body?.auto === true;
  const nums = [body?.x, body?.y, body?.size].map((value) =>
    typeof value === "number" && Number.isFinite(value) ? value : NaN
  );
  if (
    !isValidImageFilename(filename) ||
    (!auto && nums.some((value) => Number.isNaN(value) || value < 0 || value > 1))
  ) {
    return Response.json({ error: "Invalid crop request." }, { status: 400 });
  }

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
  let region: { x: number; y: number; size: number } = { x: nums[0], y: nums[1], size: nums[2] };
  let detected = false;
  if (auto) {
    const { data, info } = await sharp(source)
      .removeAlpha()
      .resize({ width: 304 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const found = findSheetFocus(new Uint8Array(data), info.width, info.height);
    detected = Boolean(found);
    region = found ?? { ...DEFAULT_SHEET_CROP };
  }
  const rect = squareCropRect(meta.width, meta.height, region);
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
    ...(auto ? { detected } : {}),
  });
}
