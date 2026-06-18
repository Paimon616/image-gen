import { NextResponse } from "next/server";
import { getLoraRunnerStatus } from "@/lib/lora-training";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const status = await getLoraRunnerStatus();

  return NextResponse.json(status, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
