import { NextResponse } from "next/server";
import { startComfy } from "@/lib/comfyui-process";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await startComfy();

  if (!result.ok) {
    const code = result.reason === "not-installed" ? 409 : 400;
    return NextResponse.json(
      { error: result.message, reason: result.reason },
      { status: code, headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(result.status, {
    headers: { "Cache-Control": "no-store" },
  });
}
