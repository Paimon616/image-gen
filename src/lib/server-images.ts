import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import type { GeneratedImage } from "@/lib/types";

export const OUTPUT_DIR = join(process.cwd(), "output");
export const THUMBNAIL_DIR = join(OUTPUT_DIR, ".thumbnails");

const IMAGE_FILENAME_PATTERN = /^[^\\/]+\.(?:png|jpe?g|webp)$/i;
const DEFAULT_IMAGE_LIMIT = 18;
const MAX_IMAGE_LIMIT = 72;

interface ImageFileInfo {
  filename: string;
  timestamp: number;
}

export function isValidImageFilename(filename: string) {
  return IMAGE_FILENAME_PATTERN.test(filename) && !filename.includes("..");
}

export function imageContentType(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  return "image/jpeg";
}

function thumbnailFilename(filename: string) {
  return `${filename.replace(/\.\w+$/, "")}.ratio-v2.webp`;
}

export function imageUrl(filename: string) {
  return `/api/images/${filename}`;
}

export function thumbnailUrl(filename: string) {
  return `/api/images/thumb/${filename}?v=2`;
}

function parsePositiveInt(value: string | null, fallback: number) {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseImageListQuery(searchParams: URLSearchParams) {
  const limit = Math.min(
    MAX_IMAGE_LIMIT,
    parsePositiveInt(searchParams.get("limit"), DEFAULT_IMAGE_LIMIT)
  );
  const cursor = Math.max(0, parsePositiveInt(searchParams.get("cursor"), 0));

  return { cursor, limit };
}

async function readImageFileInfo(filename: string): Promise<ImageFileInfo | null> {
  const filepath = join(OUTPUT_DIR, filename);
  const info = await stat(filepath).catch(() => null);

  if (!info?.isFile()) {
    return null;
  }

  return {
    filename,
    timestamp: info.mtimeMs,
  };
}

async function readImageMeta({
  filename,
  timestamp,
}: ImageFileInfo): Promise<GeneratedImage> {
  const metaPath = join(OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));

  try {
    const meta = JSON.parse(await readFile(metaPath, "utf-8"));
    return {
      id: meta.id,
      url: imageUrl(filename),
      thumbnailUrl: thumbnailUrl(filename),
      filename,
      params: meta.params,
      sizeSemantics: meta.size_semantics === "final" ? "final" : "base",
      timestamp: meta.timestamp ?? timestamp,
      civitaiOrigin: meta.civitai_origin ?? undefined,
    };
  } catch {
    return {
      id: filename,
      url: imageUrl(filename),
      thumbnailUrl: thumbnailUrl(filename),
      filename,
      params: null,
      timestamp,
    };
  }
}

export function toResponseBody(buffer: Buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

export async function listGeneratedImages({
  cursor,
  limit,
}: {
  cursor: number;
  limit: number;
}) {
  const files = await readdir(OUTPUT_DIR).catch(() => [] as string[]);
  const imageFiles = files.filter(isValidImageFilename);
  const fileInfos = (await Promise.all(imageFiles.map(readImageFileInfo)))
    .filter((info): info is ImageFileInfo => Boolean(info))
    .sort((a, b) => b.timestamp - a.timestamp);

  const start = Math.min(cursor, fileInfos.length);
  const end = Math.min(start + limit, fileInfos.length);
  const images = await Promise.all(fileInfos.slice(start, end).map(readImageMeta));

  return {
    images,
    nextCursor: end < fileInfos.length ? end : null,
    total: fileInfos.length,
  };
}

export async function readOriginalImage(filename: string) {
  if (!isValidImageFilename(filename)) {
    return null;
  }

  const filepath = join(OUTPUT_DIR, filename);
  const buffer = await readFile(filepath).catch(() => null);

  if (!buffer) {
    return null;
  }

  return {
    buffer,
    contentType: imageContentType(filename),
  };
}

export async function readImageMetadata(filename: string) {
  if (!isValidImageFilename(filename)) {
    return null;
  }

  const metadataPath = join(OUTPUT_DIR, filename.replace(/\.\w+$/, ".json"));
  const buffer = await readFile(metadataPath).catch(() => null);

  if (!buffer) {
    return null;
  }

  return buffer;
}

export async function readOrCreateThumbnail(filename: string) {
  if (!isValidImageFilename(filename)) {
    return null;
  }

  const sourcePath = join(OUTPUT_DIR, filename);
  const thumbPath = join(THUMBNAIL_DIR, thumbnailFilename(filename));

  try {
    const [sourceInfo, thumbInfo] = await Promise.all([
      stat(sourcePath),
      stat(thumbPath).catch(() => null),
    ]);

    if (thumbInfo && thumbInfo.size > 0 && thumbInfo.mtimeMs >= sourceInfo.mtimeMs) {
      return {
        buffer: await readFile(thumbPath),
        contentType: "image/webp",
      };
    }

    await mkdir(THUMBNAIL_DIR, { recursive: true });
    const { default: sharp } = await import("sharp");
    const buffer = await sharp(sourcePath)
      .rotate()
      .resize({
        width: 512,
        height: 512,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 76, effort: 1 })
      .toBuffer();

    await writeFile(thumbPath, buffer);

    return {
      buffer,
      contentType: "image/webp",
    };
  } catch {
    return readOriginalImage(filename);
  }
}

export async function deleteGeneratedImage(filename: string) {
  if (!isValidImageFilename(filename)) {
    return false;
  }

  const filepath = join(OUTPUT_DIR, filename);
  await unlink(filepath);
  await unlink(filepath.replace(/\.\w+$/, ".json")).catch(() => {});
  await unlink(join(THUMBNAIL_DIR, thumbnailFilename(filename))).catch(() => {});

  return true;
}
