import Anthropic from "@anthropic-ai/sdk";

import {
  chatProviderMeta,
  isChatProviderId,
  type ChatModelOption,
  type ChatProviderId,
} from "@/lib/chat-models";
import { getChatProviderApiKey } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Live model list for one chat provider, so the settings screen shows what the
// stored key can actually reach instead of a hardcoded snapshot. Falls back to
// the small curated list in lib/chat-models.ts when there is no key or the
// provider is unreachable.

// OpenAI's /v1/models mixes in embeddings, audio and image models; keep only
// the ids that make sense for a chat completion.
const OPENAI_NON_CHAT =
  /embedding|whisper|tts|audio|realtime|transcribe|dall-e|moderation|image|sora|davinci|babbage|codex-mini|omni-moderation/i;

async function fetchJson(url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.error?.message ?? `Request failed (${response.status}).`
    );
  }
  return data;
}

async function listModels(
  provider: ChatProviderId,
  apiKey: string
): Promise<ChatModelOption[]> {
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey });
    const models: ChatModelOption[] = [];
    for await (const model of client.models.list({ limit: 100 })) {
      models.push({ id: model.id, label: model.display_name || model.id });
    }
    return models;
  }

  if (provider === "openrouter") {
    // Public endpoint — works even before a key is stored.
    const data = await fetchJson(
      "https://openrouter.ai/api/v1/models",
      apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    );
    return (Array.isArray(data?.data) ? data.data : [])
      .map((model: { id?: string; name?: string }) => ({
        id: String(model.id ?? ""),
        label: String(model.name || model.id || ""),
      }))
      .filter((model: ChatModelOption) => model.id)
      .sort((a: ChatModelOption, b: ChatModelOption) =>
        a.label.localeCompare(b.label)
      );
  }

  if (provider === "openai") {
    const data = await fetchJson("https://api.openai.com/v1/models", {
      Authorization: `Bearer ${apiKey}`,
    });
    return (Array.isArray(data?.data) ? data.data : [])
      .map((model: { id?: string }) => String(model.id ?? ""))
      .filter((id: string) => id && !OPENAI_NON_CHAT.test(id))
      .sort((a: string, b: string) => a.localeCompare(b))
      .map((id: string) => ({ id, label: id }));
  }

  // Google: only models that can serve generateContent are usable for chat.
  const data = await fetchJson(
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    { "x-goog-api-key": apiKey }
  );
  return (Array.isArray(data?.models) ? data.models : [])
    .filter((model: { supportedGenerationMethods?: string[] }) =>
      (model.supportedGenerationMethods ?? []).includes("generateContent")
    )
    .map((model: { name?: string; displayName?: string }) => {
      const id = String(model.name ?? "").replace(/^models\//, "");
      return { id, label: model.displayName || id };
    })
    .filter((model: ChatModelOption) => model.id)
    .sort((a: ChatModelOption, b: ChatModelOption) =>
      a.label.localeCompare(b.label)
    );
}

export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider");
  if (!isChatProviderId(provider)) {
    return Response.json({ error: "Unknown provider." }, { status: 400 });
  }

  const meta = chatProviderMeta(provider);
  const apiKey = await getChatProviderApiKey(provider);

  // OpenRouter's catalog is public; the others need the key first.
  if (!apiKey && provider !== "openrouter") {
    return Response.json(
      {
        provider,
        source: "fallback",
        models: meta.fallbackModels,
        error: `${meta.label} API 키를 저장하면 전체 모델 목록을 불러옵니다.`,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const models = await listModels(provider, apiKey);
    if (models.length === 0) throw new Error("The provider returned no models.");
    return Response.json(
      { provider, source: "live", models },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      {
        provider,
        source: "fallback",
        models: meta.fallbackModels,
        error: error instanceof Error ? error.message : "Model list failed.",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
