import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

import { DEFAULT_SHEET_CROP, squareCropRect } from "@/lib/character-sheet";
import { findSheetRegions, type SheetRect, type SheetRegions } from "@/lib/sheet-auto-crop";
import type { CharacterReferenceSheetRegion } from "@/lib/types";
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
// square (lib/sheet-auto-crop; DEFAULT_SHEET_CROP when nothing is found) and
// also cut the other views found (front full body, side, back) as `regions`.
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
  const cut = async (left: number, top: number, w: number, h: number) => {
    const out = `${SHEET_CROP_PREFIX}${randomUUID()}.png`;
    await writeFile(
      join(OUTPUT_DIR, out),
      await sharp(source).extract({ left, top, width: w, height: h }).png().toBuffer()
    );
    return out;
  };
  const W = meta.width;
  const H = meta.height;

  let region: { x: number; y: number; size: number } = { x: nums[0], y: nums[1], size: nums[2] };
  let detected = false;
  const regions: CharacterReferenceSheetRegion[] = [];
  let found: SheetRegions | null = null;
  if (auto) {
    const { data, info } = await sharp(source)
      .removeAlpha()
      .resize({ width: 304 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    found = findSheetRegions(new Uint8Array(data), info.width, info.height);
    detected = Boolean(found.frontUpper);
    region = found.frontUpper ?? { ...DEFAULT_SHEET_CROP };
  }
  const rect = squareCropRect(W, H, region);
  const out = await cut(rect.left, rect.top, rect.width, rect.height);
  const crop = { url: imageUrl(out), filename: out, ...rect.normalized };

  // Auto mode also cuts every other view found, so scenes can use the one
  // they need (pickSheetRegion). The head-to-chest square doubles as front_upper.
  if (found) {
    regions.push({ kind: "front_upper", ...crop });
    const rects: [CharacterReferenceSheetRegion["kind"], SheetRect | null][] = [
      ["front_full", found.frontFull],
      ["side", found.side],
      ["back", found.back],
    ];
    for (const [kind, r] of rects) {
      if (!r) continue;
      const left = Math.max(0, Math.min(W - 16, Math.round(r.x * W)));
      const top = Math.max(0, Math.min(H - 16, Math.round(r.y * H)));
      const w = Math.max(16, Math.min(W - left, Math.round(r.w * W)));
      const h = Math.max(16, Math.min(H - top, Math.round(r.h * H)));
      const file = await cut(left, top, w, h);
      regions.push({ kind, url: imageUrl(file), filename: file, x: left / W, y: top / H, w: w / W, h: h / H });
    }
  }

  return Response.json({
    crop,
    thumbnailUrl: thumbnailUrl(out),
    ...(auto ? { detected, regions } : {}),
  });
}
