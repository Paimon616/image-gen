import { NextResponse } from "next/server";
import { getComfyStatus } from "@/lib/comfyui-process";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getComfyStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
