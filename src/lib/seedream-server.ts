// Server-side half of the Seedream integration: credentials, the ModelArk call,
// and filing the result into the gallery. Kept out of `seedream.ts` because that
// module is imported by the client, where `process.env` lookups would be inlined
// at build time.

import { writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { join } from "path";
import {
  buildSeedreamBody,
  extractSeedreamImageUrl,
  seedreamErrorMessage,
  type SeedreamModelInfo,
} from "@/lib/seedream";
import { imageUrl, OUTPUT_DIR, thumbnailUrl } from "@/lib/server-images";
import { toggleImageWorkspace } from "@/lib/workspaces";
import { notifyWorkspaceChanged } from "@/lib/runpod-share";
import type { GeneratedImage, GenerationParams } from "@/lib/types";

const DEFAULT_BASE_URL = "https://ark.ap-southeast.bytepluses.com/api/v3";

// ModelArk rejects oversized inputs, and a gallery PNG is far larger than an
// i2i reference needs to be. Applied per reference image.
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const DOWNSCALE_MAX_DIM = 2048;
// ModelArk's floor for a reference image, learned on the video side: "expected
// the width to be at least 300px". Anything smaller is dropped before the call
// rather than failing the whole request.
const MIN_REFERENCE_DIM = 300;

/** Thrown for anything the caller should surface as an upstream failure. */
export class SeedreamError extends Error {}

export function seedreamApiKey(): string | null {
  // Seedream runs on the same ModelArk account as SeeDance, so it reads the
  // same key rather than a second one that would have to be kept in sync.
  return process.env.SEEDANCE_API_KEY?.trim() || null;
}

export function seedreamBaseUrl(): string {
  return (process.env.SEEDANCE_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
    /\/+$/,
    ""
  );
}

/**
 * Per-model id override, so a rotated ModelArk id can be fixed from
 * `.env.local` without a code change.
 */
export function resolveSeedreamArkModel(model: SeedreamModelInfo): string {
  const key = `SEEDREAM_MODEL_${model.id.replace(/[.-]/g, "_").toUpperCase()}`;
  return process.env[key]?.trim() || model.arkModel;
}

const DATA_URI_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i;

/**
 * Shrink a reference to something ModelArk will take: under the input ceiling
 * and at least 300px on every side. Returns null for a reference that can't be
 * used at all, so the rest of the batch still goes up.
 */
export async function prepareSeedreamReference(
  dataUri: string
): Promise<string | null> {
  const match = DATA_URI_PATTERN.exec(dataUri.trim());
  if (!match) return null;

  // Widened to the generic Buffer type: sharp hands back a Buffer over an
  // ArrayBufferLike, which does not assign to the ArrayBuffer-backed one
  // Buffer.from infers here.
  let buffer: Buffer<ArrayBufferLike> = Buffer.from(match[2], "base64");
  let contentType = match[1];
  if (buffer.byteLength === 0) return null;

  try {
    const { default: sharp } = await import("sharp");
    const meta = await sharp(buffer).metadata();
    // EXIF orientations 5-8 mean the stored dimensions are transposed.
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;
    if (
      width &&
      height &&
      (width < MIN_REFERENCE_DIM || height < MIN_REFERENCE_DIM)
    ) {
      return null;
    }
  } catch {
    // Unreadable metadata: send it and let ModelArk decide.
  }

  if (buffer.byteLength > MAX_SOURCE_BYTES) {
    try {
      const { default: sharp } = await import("sharp");
      buffer = await sharp(buffer)
        .rotate()
        .resize({
          width: DOWNSCALE_MAX_DIM,
          height: DOWNSCALE_MAX_DIM,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 92 })
        .toBuffer();
      contentType = "image/jpeg";
    } catch {
      // Send the original and let ModelArk decide; better than failing here.
    }
  }

  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export interface SeedreamGenerateInput {
  apiKey: string;
  baseUrl: string;
  arkModel: string;
  prompt: string;
  /** Empty for text-to-image. */
  references: string[];
  size: string;
  watermark: boolean;
  signal?: AbortSignal;
}

export interface SeedreamGenerateResult {
  buffer: Buffer;
  contentType: string | null;
  /** The (expiring) ModelArk URL the image came from, recorded in the sidecar. */
  sourceUrl: string;
}

/** Call ModelArk and download the result before its URL expires. */
export async function generateSeedreamImage({
  apiKey,
  baseUrl,
  arkModel,
  prompt,
  references,
  size,
  watermark,
  signal,
}: SeedreamGenerateInput): Promise<SeedreamGenerateResult> {
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildSeedreamBody({
        model: arkModel,
        prompt,
        image: references,
        size,
        watermark,
      })
    ),
    signal,
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new SeedreamError(
      seedreamErrorMessage(json, `생성 실패 (HTTP ${res.status})`)
    );
  }

  const sourceUrl = extractSeedreamImageUrl(json);
  if (!sourceUrl) {
    throw new SeedreamError(
      seedreamErrorMessage(json, "응답에 이미지 URL이 없습니다.")
    );
  }

  const download = await fetch(sourceUrl, { signal });
  if (!download.ok) {
    throw new SeedreamError(`이미지 다운로드 실패 (HTTP ${download.status})`);
  }
  const buffer = Buffer.from(await download.arrayBuffer());
  if (buffer.byteLength < 1000) {
    throw new SeedreamError("다운로드된 이미지가 손상되었습니다.");
  }

  return { buffer, contentType: download.headers.get("content-type"), sourceUrl };
}

function extensionForContentType(contentType: string | null) {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  return "jpeg";
}

export interface PersistSeedreamInput {
  result: SeedreamGenerateResult;
  params: GenerationParams;
  workspaceId: string;
  /** Extra sidecar fields — which model ran, which size was asked for. */
  sidecar?: Record<string, unknown>;
}

/** Write the image + its sidecar into the gallery and file it under a workspace. */
export async function persistSeedreamImage({
  result,
  params,
  workspaceId,
  sidecar,
}: PersistSeedreamInput): Promise<GeneratedImage> {
  const id = randomUUID();
  const filename = `${id}.${extensionForContentType(result.contentType)}`;
  const timestamp = Date.now();

  await writeFile(join(OUTPUT_DIR, filename), result.buffer);
  await writeFile(
    join(OUTPUT_DIR, `${id}.json`),
    JSON.stringify(
      {
        id,
        filename,
        params,
        // The render comes back at the size that was asked for, so there is no
        // separate "base" resolution the gallery would need to upscale from.
        size_semantics: "final",
        endpoint: "seedream",
        timestamp,
        original_url: result.sourceUrl,
        ...sidecar,
      },
      null,
      2
    ),
    "utf-8"
  );

  // File it under the chosen workspace — the same auto-registration the image
  // generator does, so a run lands in one place.
  const workspaces = workspaceId
    ? await toggleImageWorkspace(filename, workspaceId, true).catch(
        () => [] as string[]
      )
    : [];
  if (workspaceId) {
    // A new image in a shared workspace is pushed to the pod on its own.
    void notifyWorkspaceChanged(workspaceId).catch(() => {});
  }

  return {
    id,
    url: imageUrl(filename),
    thumbnailUrl: thumbnailUrl(filename),
    filename,
    params,
    sizeSemantics: "final",
    timestamp,
    workspaces,
  };
}
