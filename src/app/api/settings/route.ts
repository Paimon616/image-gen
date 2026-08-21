import { CHAT_PROVIDERS, type ChatProviderId } from "@/lib/chat-models";
import {
  CHAT_PROVIDER_KEY_FIELDS,
  getChatProviderApiKey,
  readSettings,
  writeSettings,
  type AppSettings,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

// Keys are never echoed back; the client only learns whether a usable key
// exists and whether it came from settings.json or from the environment.
async function chatProviderKeyFlags(settings: AppSettings) {
  const stored = {} as Record<ChatProviderId, boolean>;
  const available = {} as Record<ChatProviderId, boolean>;
  for (const provider of CHAT_PROVIDERS) {
    stored[provider.id] = Boolean(settings[CHAT_PROVIDER_KEY_FIELDS[provider.id]]);
    available[provider.id] = Boolean(await getChatProviderApiKey(provider.id));
  }
  return { stored, available };
}

async function publicSettings(settings: AppSettings) {
  const chatKeys = await chatProviderKeyFlags(settings);
  return {
    civitaiApiKeyConfigured: Boolean(settings.civitaiApiKey),
    huggingfaceApiKeyConfigured: Boolean(settings.huggingfaceApiKey),
    runpodApiKeyConfigured: Boolean(settings.runpodApiKey),
    runpodPods: settings.runpodPods,
    chatProviderKeysStored: chatKeys.stored,
    chatProviderKeysAvailable: chatKeys.available,
    paimonChatProvider: settings.paimonChatProvider,
    paimonChatModel: settings.paimonChatModel,
    paimonChatReasoning: settings.paimonChatReasoning,
    // Host platform, so the client can hide backends that aren't supported
    // here (AUTOMATIC1111 / Forge are not set up on macOS).
    platform: process.platform,
  };
}

export async function GET() {
  const settings = await readSettings();
  return Response.json(await publicSettings(settings), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Partial<AppSettings>;
  const current = await readSettings();

  // A blank key field means "keep what is stored" — the client never receives
  // the existing value, so it cannot send it back.
  const keepKey = (next: unknown, existing: string) =>
    typeof next === "string" && next.trim() ? next : existing;

  const settings = await writeSettings({
    civitaiApiKey: keepKey(body.civitaiApiKey, current.civitaiApiKey),
    huggingfaceApiKey: keepKey(body.huggingfaceApiKey, current.huggingfaceApiKey),
    runpodApiKey: keepKey(body.runpodApiKey, current.runpodApiKey),
    runpodPods: body.runpodPods ?? current.runpodPods,
    openrouterApiKey: keepKey(body.openrouterApiKey, current.openrouterApiKey),
    anthropicApiKey: keepKey(body.anthropicApiKey, current.anthropicApiKey),
    openaiApiKey: keepKey(body.openaiApiKey, current.openaiApiKey),
    googleApiKey: keepKey(body.googleApiKey, current.googleApiKey),
    paimonChatProvider: body.paimonChatProvider ?? current.paimonChatProvider,
    paimonChatModel: body.paimonChatModel ?? current.paimonChatModel,
    paimonChatReasoning:
      body.paimonChatReasoning ?? current.paimonChatReasoning,
  });

  return Response.json(await publicSettings(settings), {
    headers: { "Cache-Control": "no-store" },
  });
}
