import { NextRequest, NextResponse } from "next/server";

interface CivitaiModelVersion {
  id: number;
  name?: string;
  baseModel?: string;
  trainedWords?: string[];
  images?: {
    url?: string;
    type?: string;
  }[];
}

interface CivitaiModel {
  name?: string;
  tags?: string[];
  modelVersions?: CivitaiModelVersion[];
}

function parseCivitaiUrl(rawUrl: string) {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid Civitai URL");
  }

  if (!/^(www\.)?civitai\.(com|red)$/i.test(url.hostname)) {
    throw new Error("URL must be from civitai.com or civitai.red");
  }

  const modelId = url.pathname.match(/\/models\/(\d+)/)?.[1];
  const modelVersionId = url.searchParams.get("modelVersionId");

  if (!modelId) {
    throw new Error("Civitai model ID was not found in the URL");
  }

  return {
    modelId,
    modelVersionId: modelVersionId ? Number(modelVersionId) : null,
  };
}

async function fetchCivitaiModel(modelId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    return await fetch(`https://civitai.com/api/v1/models/${modelId}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "image-gen-model-management/1.0",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: NextRequest) {
  const rawUrl = req.nextUrl.searchParams.get("url")?.trim();

  if (!rawUrl) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const { modelId, modelVersionId } = parseCivitaiUrl(rawUrl);
    const res = await fetchCivitaiModel(modelId);

    if (!res.ok) {
      return NextResponse.json(
        { error: `Civitai request failed: ${res.status}` },
        { status: 502 }
      );
    }

    const model = (await res.json()) as CivitaiModel;
    const versions = model.modelVersions ?? [];
    const selectedVersion =
      versions.find((version) => version.id === modelVersionId) ?? versions[0];
    const thumbnailUrl =
      selectedVersion?.images?.find((image) => image.url && image.type !== "video")
        ?.url ??
      selectedVersion?.images?.find((image) => image.url)?.url ??
      null;

    return NextResponse.json(
      {
        name: model.name ?? "",
        version: selectedVersion?.name ?? "",
        base_model: selectedVersion?.baseModel ?? "",
        thumbnail_url: thumbnailUrl,
        tags: model.tags ?? [],
        trigger_words: selectedVersion?.trainedWords ?? [],
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Timed out while loading Civitai info" },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Civitai info" },
      { status: 400 }
    );
  }
}
