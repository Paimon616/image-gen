// Chat-model catalog shared by the settings UI and the Paimon routes.
// Paimon can talk to any of these providers; the user picks the provider + model
// on the settings screen and the key is stored server-side (see lib/settings.ts).

export type ChatProviderId = "openrouter" | "anthropic" | "openai" | "google";

export interface ChatModelOption {
  id: string;
  label: string;
}

export interface ChatProviderMeta {
  id: ChatProviderId;
  label: string;
  /** Settings field label for this provider's key. */
  keyLabel: string;
  keyPlaceholder: string;
  keyHintKo: string;
  keyHintEn: string;
  /** Where the user gets a key. */
  keyUrl: string;
  /**
   * Shown before a live model list has been fetched (no key yet, or the
   * provider's list endpoint is unreachable). Kept short on purpose — the live
   * list from the provider is authoritative.
   */
  fallbackModels: ChatModelOption[];
  /**
   * Ordered fallbacks for the attachment (vision) analysis pass. The selected
   * chat model is tried first on the single-vendor providers, since their
   * flagship models are multimodal.
   */
  visionModels: string[];
}

export const CHAT_PROVIDERS: ChatProviderMeta[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    keyLabel: "OpenRouter API Key",
    keyPlaceholder: "sk-or-v1-...",
    keyHintKo:
      "한 개의 키로 여러 벤더의 모델을 사용할 수 있습니다. 키가 없으면 OPENROUTER_API_KEY 환경변수를 사용합니다.",
    keyHintEn:
      "One key for models from many vendors. Falls back to the OPENROUTER_API_KEY environment variable.",
    keyUrl: "https://openrouter.ai/keys",
    fallbackModels: [
      { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "anthropic/claude-opus-5", label: "Claude Opus 5" },
      { id: "openai/gpt-5", label: "GPT-5" },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "qwen/qwen3-vl-32b-instruct", label: "Qwen3 VL 32B Instruct" },
    ],
    visionModels: [
      "qwen/qwen3-vl-8b-instruct",
      "google/gemini-2.5-flash",
      "qwen/qwen3-vl-32b-instruct",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyLabel: "Anthropic API Key",
    keyPlaceholder: "sk-ant-...",
    keyHintKo: "Claude 모델을 Anthropic Messages API로 직접 호출합니다.",
    keyHintEn: "Calls Claude models directly through the Anthropic Messages API.",
    keyUrl: "https://console.anthropic.com/settings/keys",
    fallbackModels: [
      { id: "claude-opus-5", label: "Claude Opus 5" },
      { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    ],
    visionModels: ["claude-sonnet-5", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyLabel: "OpenAI API Key",
    keyPlaceholder: "sk-...",
    keyHintKo: "OpenAI Chat Completions API를 직접 호출합니다.",
    keyHintEn: "Calls the OpenAI Chat Completions API directly.",
    keyUrl: "https://platform.openai.com/api-keys",
    fallbackModels: [
      { id: "gpt-5", label: "GPT-5" },
      { id: "gpt-5-mini", label: "GPT-5 mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
    visionModels: ["gpt-4o", "gpt-4o-mini"],
  },
  {
    id: "google",
    label: "Google",
    keyLabel: "Google AI Studio API Key",
    keyPlaceholder: "AIza...",
    keyHintKo:
      "Gemini 모델을 Google Generative Language API(OpenAI 호환 엔드포인트)로 호출합니다.",
    keyHintEn:
      "Calls Gemini models through Google's Generative Language API (OpenAI-compatible endpoint).",
    keyUrl: "https://aistudio.google.com/apikey",
    fallbackModels: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    ],
    visionModels: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
];

export const CHAT_PROVIDER_IDS = CHAT_PROVIDERS.map((provider) => provider.id);

export function chatProviderMeta(id: ChatProviderId) {
  return CHAT_PROVIDERS.find((provider) => provider.id === id) ?? CHAT_PROVIDERS[0];
}

export function isChatProviderId(value: unknown): value is ChatProviderId {
  return typeof value === "string" && CHAT_PROVIDER_IDS.includes(value as ChatProviderId);
}

/** Paimon's original model, kept as the default so existing setups behave the same. */
export const DEFAULT_PAIMON_CHAT_PROVIDER: ChatProviderId = "openrouter";
export const DEFAULT_PAIMON_CHAT_MODEL = "deepseek/deepseek-v4-flash";
