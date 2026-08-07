import { NextResponse } from "next/server";
import { getCivitaiApiKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getCivitaiApiKey();

  if (!token) {
    return NextResponse.json(
      { configured: false, valid: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch("https://civitai.com/api/v1/models?limit=1", {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "image-gen-civitai-token-check/1.0",
      },
    });

    return NextResponse.json(
      {
        configured: true,
        valid: response.ok,
        status: response.status,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        configured: true,
        valid: false,
        error:
          error instanceof Error && error.name === "AbortError"
            ? "Timed out while checking Civitai token"
            : "Failed to check Civitai token",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    clearTimeout(timeout);
  }
}
