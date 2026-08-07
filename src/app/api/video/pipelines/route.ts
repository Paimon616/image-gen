import { NextResponse } from "next/server";
import { listVideoPipelines } from "@/lib/video-pipelines";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { pipelines: await listVideoPipelines() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
