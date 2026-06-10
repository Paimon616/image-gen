import { basename, extname } from "path";
import { NextRequest, NextResponse } from "next/server";

const CIVITAI_API_BASE = "https://civitai.com/api/v1";

interface CivitaiFile {
  id: number;
  name: string;
  type: string;
  primary?: boolean;
  sizeKB?: number;
  hashes?: {
    SHA256?: string;
    AutoV2?: string;
  };
  metadata?: {
    format?: string;
    fp?: string;
  };
}

interface CivitaiModelVersion {
  id: number;
  modelId: number;
  name: string;
  baseModel?: string;
  description?: string | null;
  trainedWords?: string[];
  model?: {
    name?: string;
    type?: string;
    nsfw?: boolean;
  };
  files?: CivitaiFile[];
  images?: Array<{
    url?: string;
    nsfwLevel?: number;
  }>;
}

function civitaiHeaders() {
  const token = process.env.CIVITAI_API_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

function extractModelVersionId(input: string) {
  try {
    const url = new URL(input);
    const fromQuery = url.searchParams.get("modelVersionId");
    if (fromQuery) return fromQuery;

    const apiMatch = url.pathname.match(/\/model-versions\/(\d+)/);
    if (apiMatch) return apiMatch[1];
  } catch {
    return /^\d+$/.test(input.trim()) ? input.trim() : null;
  }

  return /^\d+$/.test(input.trim()) ? input.trim() : null;
}

function safeFilename(name: string) {
  return basename(name).replace(/[^\w .@()[\]+-]/g, "_").trim();
}

function normalizeVersion(versionName: string) {
  const value = versionName.trim();
  if (!value) return "";
  return /^v/i.test(value) ? value : `v${value}`;
}

function firstThumbnail(images: CivitaiModelVersion["images"]) {
  const safeImage = images?.find((image) => image.url && (image.nsfwLevel ?? 0) <= 1);
  return safeImage?.url ?? images?.find((image) => image.url)?.url ?? null;
}

function buildMetadata(version: CivitaiModelVersion) {
  const primaryFile =
    version.files?.find((file) => file.type === "Model" && file.primary) ??
    version.files?.find((file) => file.type === "Model") ??
    null;

  return {
    id: version.id,
    modelId: version.modelId,
    name: version.model?.name ?? `Civitai ${version.modelId}`,
    version: normalizeVersion(version.name),
    type: version.model?.type ?? "",
    baseModel: version.baseModel ?? "",
    thumbnailUrl: firstThumbnail(version.images),
    trainedWords: version.trainedWords ?? [],
    nsfw: Boolean(version.model?.nsfw),
    primaryFile: primaryFile
      ? {
          id: primaryFile.id,
          name: safeFilename(primaryFile.name),
          sizeKB: primaryFile.sizeKB ?? null,
          sha256: primaryFile.hashes?.SHA256 ?? null,
          format: primaryFile.metadata?.format ?? "",
          precision: primaryFile.metadata?.fp ?? "",
          inferredName: basename(primaryFile.name, extname(primaryFile.name)),
        }
      : null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    if (!body.url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const versionId = extractModelVersionId(body.url);
    if (!versionId) {
      return NextResponse.json(
        { error: "Civitai URL에서 modelVersionId를 찾지 못했습니다." },
        { status: 400 }
      );
    }

    const res = await fetch(`${CIVITAI_API_BASE}/model-versions/${versionId}`, {
      headers: civitaiHeaders(),
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Civitai 조회 실패: ${res.status}` },
        { status: res.status }
      );
    }

    const version = (await res.json()) as CivitaiModelVersion;
    return NextResponse.json({ ok: true, model: buildMetadata(version) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Civitai import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
