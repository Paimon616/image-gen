import { randomUUID } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import sharp from "sharp";

import { squareCropRect } from "@/lib/character-sheet";
import { findSheetRegions, type SheetRect } from "@/lib/sheet-auto-crop";
import { CONSISTENCY_SHEET_OUTPUT_DIR } from "@/lib/server-consistency-sheet";
import { imageUrl, isValidImageFilename, OUTPUT_DIR, SHEET_CROP_PREFIX } from "@/lib/server-images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 방향별 참조 세트. Cuts a character sheet (from the 일관성 시트 gallery or the
// image gallery) into the views the varied batch swaps in per image: front full
// body, side, back and a head-to-chest face. Views the sheet does not show come
// back null, and the batch falls back to the front for them.
// Body: { url } — /api/consistency-sheet/images/<file> or /api/images/<file>.

/** Small crops are upscaled to these heights (Lanczos), as in the evaluation. */
const BODY_MIN_HEIGHT = 1024;
const FACE_MIN_HEIGHT = 512;
/** Top part of the head-to-chest square kept as the face reference. */
const FACE_SHARE_OF_SQUARE = 0.6;

function resolveSheetPath(raw: string): string | null {
  let path = raw;
  try {
    path = new URL(raw, "http://local").pathname;
  } catch {
    return null;
  }
  const sheet = /^\/api\/consistency-sheet\/images\/([^/]+)$/.exec(path);
  if (sheet && isValidImageFilename(sheet[1])) return join(CONSISTENCY_SHEET_OUTPUT_DIR, sheet[1]);
  const image = /^\/api\/images\/([^/]+)$/.exec(path);
  if (image && isValidImageFilename(image[1])) return join(OUTPUT_DIR, image[1]);
  return null;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const sourcePath = typeof body?.url === "string" ? resolveSheetPath(body.url) : null;
  if (!sourcePath) {
    return Response.json({ error: "시트 이미지 주소가 올바르지 않습니다." }, { status: 400 });
  }

  let source: Buffer;
  try {
    source = await readFile(sourcePath);
  } catch {
    return Response.json({ error: "시트 이미지를 찾지 못했습니다." }, { status: 404 });
  }
  const meta = await sharp(source).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (W < 64 || H < 64) {
    return Response.json({ error: "시트 이미지를 읽을 수 없습니다." }, { status: 400 });
  }

  const { data, info } = await sharp(source)
    .removeAlpha()
    .resize({ width: 304 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const found = findSheetRegions(new Uint8Array(data), info.width, info.height);

  const save = async (
    rect: { left: number; top: number; width: number; height: number },
    minHeight: number
  ) => {
    let image = sharp(source).extract(rect);
    if (rect.height < minHeight) {
      image = sharp(await image.png().toBuffer()).resize({
        height: minHeight,
        kernel: "lanczos3",
      });
    }
    const filename = `${SHEET_CROP_PREFIX}set-${randomUUID()}.png`;
    await writeFile(join(OUTPUT_DIR, filename), await image.png().toBuffer());
    return imageUrl(filename);
  };
  const body_ = async (r: SheetRect | null) => {
    if (!r) return null;
    const left = Math.max(0, Math.min(W - 16, Math.round(r.x * W)));
    const top = Math.max(0, Math.min(H - 16, Math.round(r.y * H)));
    const width = Math.max(16, Math.min(W - left, Math.round(r.w * W)));
    const height = Math.max(16, Math.min(H - top, Math.round(r.h * H)));
    return save({ left, top, width, height }, BODY_MIN_HEIGHT);
  };

  const [front, side, back] = await Promise.all([
    body_(found.frontFull),
    body_(found.side),
    body_(found.back),
  ]);
  const face = found.frontUpper
    ? await (() => {
        // Head and neck only: the head-to-chest square also holds the front of
        // the outfit (a neckline ribbon), which a back view then copied onto
        // the back of the blouse.
        const rect = squareCropRect(W, H, found.frontUpper);
        const height = Math.max(16, Math.round(rect.height * FACE_SHARE_OF_SQUARE));
        return save(
          { left: rect.left, top: rect.top, width: rect.width, height },
          FACE_MIN_HEIGHT
        );
      })()
    : null;

  if (!front && !face) {
    return Response.json(
      { error: "시트에서 정면 인물을 찾지 못했습니다. 캐릭터 시트인지 확인하세요." },
      { status: 422 }
    );
  }
  return Response.json({ front, side, back, face });
}
