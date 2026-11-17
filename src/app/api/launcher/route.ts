import { NextRequest, NextResponse } from "next/server";
import {
  LOCAL_SERVICE_IDS,
  getLauncherStatus,
  restartService,
  startService,
  stopService,
  writeLauncherConfig,
  type LocalServiceId,
} from "@/lib/local-services";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  return NextResponse.json(await getLauncherStatus(), { headers: noStore });
}

// { action: "start" | "stop" | "restart", service }  or  { autoStart: { comfyui: true } }
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    service?: string;
    autoStart?: Record<string, unknown>;
  };

  try {
    if (body.autoStart && typeof body.autoStart === "object") {
      const autoStart: Partial<Record<LocalServiceId, boolean>> = {};
      for (const id of LOCAL_SERVICE_IDS) {
        if (typeof body.autoStart[id] === "boolean") autoStart[id] = body.autoStart[id] as boolean;
      }
      writeLauncherConfig({ autoStart: autoStart as Record<LocalServiceId, boolean> });
    } else {
      const service = body.service as LocalServiceId;
      if (!LOCAL_SERVICE_IDS.includes(service)) {
        return NextResponse.json({ error: "Unknown service." }, { status: 400, headers: noStore });
      }
      if (body.action === "start") await startService(service);
      else if (body.action === "stop") await stopService(service);
      else if (body.action === "restart") await restartService(service);
      else {
        return NextResponse.json({ error: "Unknown action." }, { status: 400, headers: noStore });
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400, headers: noStore }
    );
  }

  return NextResponse.json(await getLauncherStatus(), { headers: noStore });
}
