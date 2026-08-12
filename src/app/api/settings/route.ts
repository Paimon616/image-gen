import { readSettings, writeSettings, type AppSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

function publicSettings(settings: AppSettings) {
  return {
    civitaiApiKeyConfigured: Boolean(settings.civitaiApiKey),
    huggingfaceApiKeyConfigured: Boolean(settings.huggingfaceApiKey),
    runpodApiKeyConfigured: Boolean(settings.runpodApiKey),
    runpodPods: settings.runpodPods,
  };
}

export async function GET() {
  const settings = await readSettings();
  return Response.json(publicSettings(settings), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<AppSettings>;
  const current = await readSettings();
  const settings = await writeSettings({
    civitaiApiKey:
      typeof body.civitaiApiKey === "string" && body.civitaiApiKey.trim()
        ? body.civitaiApiKey
        : current.civitaiApiKey,
    huggingfaceApiKey:
      typeof body.huggingfaceApiKey === "string" && body.huggingfaceApiKey.trim()
        ? body.huggingfaceApiKey
        : current.huggingfaceApiKey,
    runpodApiKey:
      typeof body.runpodApiKey === "string" && body.runpodApiKey.trim()
        ? body.runpodApiKey
        : current.runpodApiKey,
    runpodPods: body.runpodPods ?? current.runpodPods,
  });

  return Response.json(publicSettings(settings), {
    headers: { "Cache-Control": "no-store" },
  });
}
