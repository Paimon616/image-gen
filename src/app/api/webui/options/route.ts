import { NextRequest, NextResponse } from "next/server";
import { listWebUiOptions } from "@/lib/a1111";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const backend = req.nextUrl.searchParams.get("backend") === "forge" ? "forge" : "a1111";

  try {
    const options = await listWebUiOptions(backend, AbortSignal.timeout(8_000));
    return NextResponse.json(options, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { upscalers: [], adetailerModels: [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
