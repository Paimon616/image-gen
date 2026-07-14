import { NextRequest, NextResponse } from "next/server";
import type { CivitaiLicenseInfo } from "@/lib/types";
import { parseCivitaiLicense } from "@/lib/civitai-license";

export const dynamic = "force-dynamic";

interface CivitaiModelLicense {
  allowNoCredit?: unknown;
  allowCommercialUse?: unknown;
  allowDerivatives?: unknown;
  allowDifferentLicense?: unknown;
}

function parseModelIds(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .map((id) => (typeof id === "number" ? id : Number(id)))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ).slice(0, 24);
}

function parseLicense(model: CivitaiModelLicense): CivitaiLicenseInfo {
  return parseCivitaiLicense(model) ?? {};
}

async function fetchLicense(modelId: number, token?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`https://civitai.com/api/v1/models/${modelId}`, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "image-gen-civitai-license/1.0",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) return null;

    const model = (await response.json()) as CivitaiModelLicense;
    return parseLicense(model);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { modelIds?: unknown } | null;
  const modelIds = parseModelIds(body?.modelIds);

  if (modelIds.length === 0) {
    return NextResponse.json(
      { licenses: {} },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const token = process.env.CIVITAI_API_TOKEN?.trim();
  const entries = await Promise.all(
    modelIds.map(async (modelId) => [modelId, await fetchLicense(modelId, token)] as const)
  );

  const licenses: Record<number, CivitaiLicenseInfo> = {};
  for (const [modelId, license] of entries) {
    if (license) licenses[modelId] = license;
  }

  return NextResponse.json(
    { licenses },
    { headers: { "Cache-Control": "no-store" } }
  );
}
