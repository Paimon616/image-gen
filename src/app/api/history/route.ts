import { randomUUID } from "crypto";
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { NextRequest, NextResponse } from "next/server";
import type {
  CivitaiImportResult,
  GeneratedImage,
  GenerationParams,
  HistoryEntry,
  HistoryMissingResource,
} from "@/lib/types";

const HISTORY_DIR = join(process.cwd(), "data", "history");
const HISTORY_IMAGE_DIR = join(HISTORY_DIR, "images");

interface CreateHistoryBody {
  requestedUrl?: string;
  importResult?: CivitaiImportResult;
  generatedImage?: GeneratedImage;
  params?: GenerationParams;
  missingResources?: HistoryMissingResource[];
}

interface DeleteHistoryBody {
  id?: string;
}

interface UpdateHistoryBody {
  id?: string;
  action?: "refresh-import";
  userTags?: unknown;
}

interface HistoryEntryFile {
  entry: HistoryEntry;
  filename: string;
}

async function ensureHistoryDirs() {
  await mkdir(HISTORY_IMAGE_DIR, { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCivitaiImportResult(value: unknown): value is CivitaiImportResult {
  if (!isRecord(value)) return false;

  return (
    typeof value.imageId === "number" &&
    typeof value.imageUrl === "string" &&
    typeof value.pageUrl === "string" &&
    isRecord(value.params) &&
    Array.isArray(value.resources) &&
    Array.isArray(value.importedTags)
  );
}

function isSafeHistoryId(value: string) {
  return /^[a-f0-9-]{36}$/i.test(value);
}

function isSafeFilename(value: string) {
  return Boolean(value) && !value.includes("..") && !value.includes("/") && !value.includes("\\");
}

function normalizeHistoryUrl(value: string) {
  if (!value.trim()) return "";

  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";

    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}

function normalizeUserTags(value: unknown) {
  if (!Array.isArray(value)) return [];

  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 32);

  return Array.from(new Set(tags));
}

function normalizeImportedTags(value: unknown) {
  if (!Array.isArray(value)) return [];

  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 64);

  return Array.from(new Set(tags));
}

function withHistoryDefaults(entry: HistoryEntry): HistoryEntry {
  return {
    ...entry,
    importedParams: entry.importedParams ?? {},
    resources: Array.isArray(entry.resources) ? entry.resources : [],
    missingResources: Array.isArray(entry.missingResources)
      ? entry.missingResources
      : [],
    importedTags: normalizeImportedTags(
      entry.importedTags ?? entry.rawImport?.importedTags
    ),
    userTags: normalizeUserTags(entry.userTags),
  };
}

function civitaiImageIdFromUrl(value: string) {
  const match = value.match(/(?:civitai\.(?:com|red)\/images\/)(\d+)/i);

  return match?.[1] ?? "";
}

async function readHistoryEntryFiles() {
  const files = await readdir(HISTORY_DIR).catch(() => [] as string[]);
  const entries = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (filename) => {
        try {
          const content = await readFile(join(HISTORY_DIR, filename), "utf-8");
          return {
            entry: withHistoryDefaults(JSON.parse(content) as HistoryEntry),
            filename,
          };
        } catch {
          return null;
        }
      })
  );

  return entries.filter((item): item is HistoryEntryFile => item !== null);
}

function findDuplicateHistoryEntry(
  entries: HistoryEntryFile[],
  requestedUrl: string,
  importResult: CivitaiImportResult
) {
  const normalizedRequestedUrl = normalizeHistoryUrl(requestedUrl);
  const normalizedPageUrl = normalizeHistoryUrl(importResult.pageUrl);
  const requestedImageId =
    importResult.imageId ||
    Number(civitaiImageIdFromUrl(requestedUrl)) ||
    Number(civitaiImageIdFromUrl(importResult.pageUrl));

  return entries.find(({ entry }) => {
    const entryRequestedUrl = normalizeHistoryUrl(entry.requestedUrl);
    const entryPageUrl = normalizeHistoryUrl(entry.pageUrl ?? "");
    const entryImageId =
      entry.imageId ||
      Number(civitaiImageIdFromUrl(entry.requestedUrl)) ||
      Number(civitaiImageIdFromUrl(entry.pageUrl ?? ""));

    return (
      Boolean(
        normalizedRequestedUrl &&
          (normalizedRequestedUrl === entryRequestedUrl ||
            normalizedRequestedUrl === entryPageUrl)
      ) ||
      Boolean(normalizedPageUrl && normalizedPageUrl === entryPageUrl) ||
      Boolean(requestedImageId && entryImageId && requestedImageId === entryImageId)
    );
  });
}

function findDuplicateGeneratedEntry(
  entries: HistoryEntryFile[],
  generatedImage: GeneratedImage
) {
  const normalizedUrl = normalizeHistoryUrl(generatedImage.url);

  return entries.find(({ entry }) => {
    if (entry.source !== "generated") return false;

    return (
      entry.id === generatedImage.id ||
      normalizeHistoryUrl(entry.requestedUrl) === normalizedUrl ||
      normalizeHistoryUrl(entry.imageUrl) === normalizedUrl
    );
  });
}

function imageExtension(contentType: string, imageUrl: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpeg";

  const pathname = new URL(imageUrl).pathname;
  const ext = pathname.split(".").pop()?.toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") {
    return ext === "jpg" ? "jpeg" : ext;
  }

  return "jpeg";
}

function outputImageExtension(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") {
    return ext === "jpg" ? "jpeg" : ext;
  }

  return "png";
}

async function saveRemoteImage(id: string, imageUrl: string) {
  if (!imageUrl) return { localImageFilename: null, localImageUrl: null };

  try {
    const response = await fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
        "User-Agent": "image-gen-history/1.0",
      },
      next: { revalidate: 0 },
    });

    if (!response.ok) return { localImageFilename: null, localImageUrl: null };

    const contentType = response.headers.get("content-type") ?? "";
    const ext = imageExtension(contentType, imageUrl);
    const filename = `${id}.${ext}`;
    const buffer = Buffer.from(await response.arrayBuffer());

    await writeFile(join(HISTORY_IMAGE_DIR, filename), buffer);

    return {
      localImageFilename: filename,
      localImageUrl: `/api/scrap/images/${filename}`,
    };
  } catch {
    return { localImageFilename: null, localImageUrl: null };
  }
}

async function saveGeneratedImage(id: string, filename: string) {
  if (!isSafeFilename(filename)) {
    return { localImageFilename: null, localImageUrl: null };
  }

  const ext = outputImageExtension(filename);
  const localImageFilename = `${id}.${ext}`;

  await copyFile(
    join(process.cwd(), "output", filename),
    join(HISTORY_IMAGE_DIR, localImageFilename)
  );

  return {
    localImageFilename,
    localImageUrl: `/api/scrap/images/${localImageFilename}`,
  };
}

async function updateExistingHistoryEntry({
  duplicate,
  requestedUrl,
  importResult,
  params,
  missingResources,
}: {
  duplicate: HistoryEntryFile;
  requestedUrl: string;
  importResult: CivitaiImportResult;
  params: GenerationParams;
  missingResources: HistoryMissingResource[];
}) {
  let localImageFilename = duplicate.entry.localImageFilename;
  let localImageUrl = duplicate.entry.localImageUrl;

  if (!localImageFilename && importResult.imageUrl) {
    const savedImage = await saveRemoteImage(duplicate.entry.id, importResult.imageUrl);
    localImageFilename = savedImage.localImageFilename;
    localImageUrl = savedImage.localImageUrl;
  }

  const entry: HistoryEntry = {
    ...duplicate.entry,
    createdAt: Date.now(),
    requestedUrl: requestedUrl || duplicate.entry.requestedUrl,
    imageId: importResult.imageId,
    imageUrl: importResult.imageUrl,
    localImageUrl,
    localImageFilename,
    pageUrl: importResult.pageUrl,
    username: importResult.username,
    params,
    importedParams: importResult.params,
    resources: importResult.resources,
    missingResources,
    importedTags: normalizeImportedTags(importResult.importedTags),
    userTags: normalizeUserTags(duplicate.entry.userTags),
    rawImport: importResult,
  };

  await writeFile(
    join(HISTORY_DIR, duplicate.filename),
    JSON.stringify(entry, null, 2)
  );

  return entry;
}

async function updateExistingGeneratedEntry({
  duplicate,
  generatedImage,
  params,
}: {
  duplicate: HistoryEntryFile;
  generatedImage: GeneratedImage;
  params: GenerationParams;
}) {
  let localImageFilename = duplicate.entry.localImageFilename;
  let localImageUrl = duplicate.entry.localImageUrl;

  if (!localImageFilename) {
    const savedImage = await saveGeneratedImage(duplicate.entry.id, generatedImage.filename);
    localImageFilename = savedImage.localImageFilename;
    localImageUrl = savedImage.localImageUrl;
  }

  const entry: HistoryEntry = {
    ...duplicate.entry,
    source: "generated",
    createdAt: Date.now(),
    requestedUrl: generatedImage.url,
    imageUrl: generatedImage.url,
    localImageUrl,
    localImageFilename,
    params,
    importedParams: params,
    resources: [],
    missingResources: [],
    importedTags: [],
    userTags: normalizeUserTags(duplicate.entry.userTags),
  };

  await writeFile(
    join(HISTORY_DIR, duplicate.filename),
    JSON.stringify(entry, null, 2)
  );

  return entry;
}

export async function GET() {
  try {
    await ensureHistoryDirs();
    const entries = (await readHistoryEntryFiles()).map(({ entry }) => entry);

    entries.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ entries: [] });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as CreateHistoryBody | null;

  if (isRecord(body?.generatedImage) && isRecord(body?.params)) {
    await ensureHistoryDirs();

    const generatedImage = body.generatedImage as GeneratedImage;
    if (
      typeof generatedImage.id !== "string" ||
      typeof generatedImage.url !== "string" ||
      !isSafeFilename(generatedImage.filename)
    ) {
      return NextResponse.json(
        { error: "Valid generated image is required" },
        { status: 400 }
      );
    }

    const duplicate = findDuplicateGeneratedEntry(
      await readHistoryEntryFiles(),
      generatedImage
    );

    if (duplicate) {
      const entry = await updateExistingGeneratedEntry({
        duplicate,
        generatedImage,
        params: body.params as GenerationParams,
      });

      return NextResponse.json({ entry, updatedExisting: true });
    }

    try {
      const id = randomUUID();
      const { localImageFilename, localImageUrl } = await saveGeneratedImage(
        id,
        generatedImage.filename
      );
      const params = body.params as GenerationParams;
      const entry: HistoryEntry = {
        id,
        source: "generated",
        createdAt: Date.now(),
        requestedUrl: generatedImage.url,
        imageUrl: generatedImage.url,
        localImageUrl,
        localImageFilename,
        params,
        importedParams: params,
        resources: [],
        missingResources: [],
        importedTags: [],
        userTags: [],
      };

      await writeFile(join(HISTORY_DIR, `${id}.json`), JSON.stringify(entry, null, 2));

      return NextResponse.json({ entry });
    } catch {
      return NextResponse.json(
        { error: "Generated image could not be saved to scrap" },
        { status: 500 }
      );
    }
  }

  if (!isRecord(body?.importResult) || !isRecord(body?.params)) {
    return NextResponse.json(
      { error: "Import result and applied params are required" },
      { status: 400 }
    );
  }

  await ensureHistoryDirs();

  const importResult = body.importResult as CivitaiImportResult;
  const duplicate = findDuplicateHistoryEntry(
    await readHistoryEntryFiles(),
    body.requestedUrl ?? "",
    importResult
  );

  if (duplicate) {
    const entry = await updateExistingHistoryEntry({
      duplicate,
      requestedUrl: body.requestedUrl ?? "",
      importResult,
      params: body.params as GenerationParams,
      missingResources: body.missingResources ?? [],
    });

    return NextResponse.json({ entry, updatedExisting: true });
  }

  const id = randomUUID();
  const { localImageFilename, localImageUrl } = await saveRemoteImage(
    id,
    importResult.imageUrl
  );
  const entry: HistoryEntry = {
    id,
    source: "civitai",
    createdAt: Date.now(),
    requestedUrl: body.requestedUrl ?? "",
    imageId: importResult.imageId,
    imageUrl: importResult.imageUrl,
    localImageUrl,
    localImageFilename,
    pageUrl: importResult.pageUrl,
    username: importResult.username,
    params: body.params as GenerationParams,
    importedParams: importResult.params,
    resources: importResult.resources,
    missingResources: body.missingResources ?? [],
    importedTags: normalizeImportedTags(importResult.importedTags),
    userTags: [],
    rawImport: importResult,
  };

  await writeFile(join(HISTORY_DIR, `${id}.json`), JSON.stringify(entry, null, 2));

  return NextResponse.json({ entry });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as UpdateHistoryBody | null;
  const id = body?.id ?? "";

  if (!isSafeHistoryId(id)) {
    return NextResponse.json({ error: "Valid scrap id is required" }, { status: 400 });
  }

  try {
    const entryPath = join(HISTORY_DIR, `${id}.json`);
    const entry = withHistoryDefaults(
      JSON.parse(await readFile(entryPath, "utf-8")) as HistoryEntry
    );

    if (body?.action === "refresh-import") {
      const refreshUrl = entry.pageUrl || entry.requestedUrl;

      if (entry.source !== "civitai" || !refreshUrl) {
        return NextResponse.json(
          { error: "Only URL-based Civitai scraps can be refreshed" },
          { status: 400 }
        );
      }

      const importResponse = await fetch(new URL("/api/civitai/import", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: refreshUrl }),
        next: { revalidate: 0 },
      });
      const importResult = (await importResponse.json().catch(() => null)) as
        | CivitaiImportResult
        | { error?: string }
        | null;

      if (!importResponse.ok || !isCivitaiImportResult(importResult)) {
        const errorResult = isRecord(importResult) ? importResult : null;
        return NextResponse.json(
          {
            error:
              typeof errorResult?.error === "string"
                ? errorResult.error
                : "Failed to refresh Civitai import",
          },
          { status: importResponse.ok ? 502 : importResponse.status }
        );
      }

      let localImageFilename = entry.localImageFilename;
      let localImageUrl = entry.localImageUrl;

      if (!localImageFilename && importResult.imageUrl) {
        const savedImage = await saveRemoteImage(entry.id, importResult.imageUrl);
        localImageFilename = savedImage.localImageFilename;
        localImageUrl = savedImage.localImageUrl;
      }

      const updatedEntry: HistoryEntry = {
        ...entry,
        imageId: importResult.imageId,
        imageUrl: importResult.imageUrl || entry.imageUrl,
        localImageUrl,
        localImageFilename,
        pageUrl: importResult.pageUrl,
        username: importResult.username,
        params: {
          ...entry.params,
          ...importResult.params,
        },
        importedParams: importResult.params,
        resources: importResult.resources,
        importedTags: normalizeImportedTags(importResult.importedTags),
        rawImport: importResult,
      };

      await writeFile(entryPath, JSON.stringify(updatedEntry, null, 2));

      return NextResponse.json({ entry: updatedEntry });
    }

    const updatedEntry: HistoryEntry = {
      ...entry,
      userTags: normalizeUserTags(body?.userTags),
    };

    await writeFile(entryPath, JSON.stringify(updatedEntry, null, 2));

    return NextResponse.json({ entry: updatedEntry });
  } catch {
    return NextResponse.json({ error: "Scrap entry not found" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as DeleteHistoryBody | null;
  const id = body?.id ?? "";

  if (!isSafeHistoryId(id)) {
    return NextResponse.json({ error: "Valid scrap id is required" }, { status: 400 });
  }

  try {
    const entryPath = join(HISTORY_DIR, `${id}.json`);
    const entry = JSON.parse(await readFile(entryPath, "utf-8")) as HistoryEntry;

    await unlink(entryPath);

    if (entry.localImageFilename) {
      await unlink(join(HISTORY_IMAGE_DIR, entry.localImageFilename)).catch(() => {});
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Scrap entry not found" }, { status: 404 });
  }
}
