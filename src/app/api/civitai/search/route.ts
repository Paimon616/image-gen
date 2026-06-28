import { NextRequest, NextResponse } from "next/server";
import type { ImportedCivitaiResource } from "@/lib/types";

export const dynamic = "force-dynamic";

type ResourceType = ImportedCivitaiResource["type"];

interface CivitaiModelVersion {
  id: number;
  name?: string;
  baseModel?: string;
}

interface CivitaiModel {
  id: number;
  name?: string;
  type?: string;
  modelVersions?: CivitaiModelVersion[];
}

const TYPE_QUERY: Partial<Record<ResourceType, string>> = {
  checkpoint: "Checkpoint",
  lora: "LORA",
  embedding: "TextualInversion",
  vae: "VAE",
  upscaler: "Upscaler",
};

function resourceType(value: string | null): ResourceType {
  const normalized = (value ?? "").toLowerCase();

  if (normalized === "checkpoint") return "checkpoint";
  if (normalized === "lora") return "lora";
  if (normalized === "embedding") return "embedding";
  if (normalized === "vae") return "vae";
  if (normalized === "upscaler") return "upscaler";

  return "other";
}

function modelSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function modelUrl(model: CivitaiModel, version: CivitaiModelVersion) {
  const name = model.name ?? "model";
  const url = new URL(
    `https://civitai.red/models/${model.id}${modelSlug(name) ? `/${modelSlug(name)}` : ""}`
  );

  url.searchParams.set("modelVersionId", String(version.id));

  return url.toString();
}

function toResource(
  model: CivitaiModel,
  type: ResourceType
): ImportedCivitaiResource | null {
  const version = model.modelVersions?.[0];
  const name = model.name?.trim();

  if (!version || !name) return null;

  return {
    type,
    name,
    versionName: version.name,
    baseModel: version.baseModel,
    modelId: model.id,
    modelVersionId: version.id,
    url: modelUrl(model, version),
  };
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim();
  const type = resourceType(req.nextUrl.searchParams.get("type"));

  if (!query) {
    return NextResponse.json({ resources: [] });
  }

  const url = new URL("https://civitai.com/api/v1/models");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", "6");
  url.searchParams.set("sort", "Most Downloaded");

  const civitaiType = TYPE_QUERY[type];
  if (civitaiType) {
    url.searchParams.set("types", civitaiType);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "image-gen-civitai-search/1.0",
    },
  });

  if (!response.ok) {
    return NextResponse.json(
      { error: `Civitai search failed: ${response.status}` },
      { status: 502 }
    );
  }

  const data = (await response.json()) as { items?: CivitaiModel[] };
  const resources = (data.items ?? [])
    .map((model) => toResource(model, type))
    .filter((resource): resource is ImportedCivitaiResource => Boolean(resource));

  return NextResponse.json({ resources });
}
