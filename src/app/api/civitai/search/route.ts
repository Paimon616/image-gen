import { NextRequest, NextResponse } from "next/server";
import type { ImportedCivitaiResource } from "@/lib/types";
import { searchCivitaiResourceByFilename } from "@/lib/civitai-resource-search";

export const dynamic = "force-dynamic";

type ResourceType = ImportedCivitaiResource["type"];

function resourceType(value: string | null): ResourceType {
  const normalized = (value ?? "").toLowerCase();

  if (normalized === "checkpoint") return "checkpoint";
  if (normalized === "lora") return "lora";
  if (normalized === "embedding") return "embedding";
  if (normalized === "vae") return "vae";
  if (normalized === "upscaler") return "upscaler";

  return "other";
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim();
  const type = resourceType(req.nextUrl.searchParams.get("type"));

  if (!query) {
    return NextResponse.json({ resources: [] });
  }

  const resource = await searchCivitaiResourceByFilename(type, query);
  return NextResponse.json({ resources: resource ? [resource] : [] });
}
