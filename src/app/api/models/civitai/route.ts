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

interface CivitaiModelDetails {
  id?: number;
  name?: string;
  type?: string;
  nsfw?: boolean;
  tags?: string[];
  modelVersions?: CivitaiModelVersion[];
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

function extractModelId(input: string) {
  try {
    const url = new URL(input);
    const modelMatch = url.pathname.match(/\/models\/(\d+)/);
    if (modelMatch) return modelMatch[1];
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

function uniqueTags(tags: string[] = []) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

function buildMetadata(
  version: CivitaiModelVersion,
  details: CivitaiModelDetails | null,
  civitaiUrl: string
) {
  const primaryFile =
    version.files?.find((file) => file.type === "Model" && file.primary) ??
    version.files?.find((file) => file.type === "Model") ??
    null;

  return {
    id: version.id,
    modelId: version.modelId,
    civitaiUrl,
    name: version.model?.name ?? details?.name ?? `Civitai ${version.modelId}`,
    version: normalizeVersion(version.name),
    type: version.model?.type ?? details?.type ?? "",
    baseModel: version.baseModel ?? "",
    thumbnailUrl: firstThumbnail(version.images),
    trainedWords: version.trainedWords ?? [],
    tags: uniqueTags(details?.tags),
    nsfw: Boolean(version.model?.nsfw ?? details?.nsfw),
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

async function fetchModelDetails(modelId: number | string) {
  const res = await fetch(`${CIVITAI_API_BASE}/models/${modelId}`, {
    headers: civitaiHeaders(),
    cache: "no-store",
  });

  return res.ok ? ((await res.json()) as CivitaiModelDetails) : null;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { url?: string };
    const civitaiUrl = body.url?.trim() ?? "";
    if (!civitaiUrl) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const versionId = extractModelVersionId(civitaiUrl);
    const modelId = extractModelId(civitaiUrl);
    if (!versionId && !modelId) {
      return NextResponse.json(
        { error: "Civitai URL에서 modelVersionId 또는 model id를 찾지 못했습니다." },
        { status: 400 }
      );
    }

    let version: CivitaiModelVersion | null = null;
    let details: CivitaiModelDetails | null = null;

    if (versionId) {
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

      version = (await res.json()) as CivitaiModelVersion;
      details = await fetchModelDetails(version.modelId);
    } else if (modelId) {
      details = await fetchModelDetails(modelId);
      version = details?.modelVersions?.[0] ?? null;
    }

    if (!version) {
      return NextResponse.json(
        { error: "Civitai 모델 버전 정보를 찾지 못했습니다." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      model: buildMetadata(version, details, civitaiUrl),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Civitai import failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
