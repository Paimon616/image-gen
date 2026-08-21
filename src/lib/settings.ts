import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

import {
  DEFAULT_PAIMON_CHAT_MODEL,
  DEFAULT_PAIMON_CHAT_PROVIDER,
  isChatProviderId,
  type ChatProviderId,
} from "@/lib/chat-models";

export type RunpodPodKind = "image" | "video";

export interface RunpodPodSettings {
  id: string;
  kind: RunpodPodKind;
  label: string;
  podId: string;
  ssh: string;
  comfyUrl: string;
}

export interface AppSettings {
  civitaiApiKey: string;
  /** HuggingFace access token, for gated repos (e.g. Lightricks/LTX-2.5). */
  huggingfaceApiKey: string;
  runpodApiKey: string;
  runpodPods: RunpodPodSettings[];
  // Chat (LLM) providers Paimon can run on. One key per vendor; the selected
  // provider/model pair below decides which one Paimon actually uses.
  openrouterApiKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;
  paimonChatProvider: ChatProviderId;
  paimonChatModel: string;
  // Let a thinking-capable chat model reason before it answers. Off by default:
  // on the hybrid models (e.g. deepseek-v4) the reasoning pass runs BEFORE the
  // first answer token, which pushed a character-situation compose from ~4s to
  // ~60s+ before anything could be queued. Turn it on when prompt-editing
  // quality matters more than how fast the render starts.
  paimonChatReasoning: boolean;
}

export const CHAT_PROVIDER_KEY_FIELDS = {
  openrouter: "openrouterApiKey",
  anthropic: "anthropicApiKey",
  openai: "openaiApiKey",
  google: "googleApiKey",
} as const satisfies Record<ChatProviderId, keyof AppSettings>;

const SETTINGS_PATH = join(process.cwd(), ".local", "settings.json");
// Version-controlled pod list used to seed a fresh clone. It holds pod
// connection info only (no API keys), so it is safe to commit.
const DEFAULT_PODS_PATH = join(process.cwd(), "data", "default-pods.json");

const DEFAULT_SETTINGS: AppSettings = {
  civitaiApiKey: "",
  huggingfaceApiKey: "",
  runpodApiKey: "",
  runpodPods: [],
  openrouterApiKey: "",
  anthropicApiKey: "",
  openaiApiKey: "",
  googleApiKey: "",
  paimonChatProvider: DEFAULT_PAIMON_CHAT_PROVIDER,
  paimonChatModel: DEFAULT_PAIMON_CHAT_MODEL,
  paimonChatReasoning: false,
};

async function readDefaultPods(): Promise<RunpodPodSettings[]> {
  try {
    const raw = await readFile(DEFAULT_PODS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    // Accept either a bare array or a { runpodPods: [...] } wrapper.
    const pods = Array.isArray(parsed) ? parsed : parsed?.runpodPods;
    return cleanSettings({ runpodPods: pods }).runpodPods;
  } catch {
    return [];
  }
}

function cleanSettings(value: Partial<AppSettings>): AppSettings {
  return {
    civitaiApiKey: String(value.civitaiApiKey ?? "").trim(),
    huggingfaceApiKey: String(value.huggingfaceApiKey ?? "").trim(),
    runpodApiKey: String(value.runpodApiKey ?? "").trim(),
    openrouterApiKey: String(value.openrouterApiKey ?? "").trim(),
    anthropicApiKey: String(value.anthropicApiKey ?? "").trim(),
    openaiApiKey: String(value.openaiApiKey ?? "").trim(),
    googleApiKey: String(value.googleApiKey ?? "").trim(),
    paimonChatProvider: isChatProviderId(value.paimonChatProvider)
      ? value.paimonChatProvider
      : DEFAULT_PAIMON_CHAT_PROVIDER,
    paimonChatModel:
      String(value.paimonChatModel ?? "").trim() || DEFAULT_PAIMON_CHAT_MODEL,
    paimonChatReasoning: Boolean(value.paimonChatReasoning),
    runpodPods: Array.isArray(value.runpodPods)
      ? value.runpodPods.map((pod) => ({
          id: String(pod.id || crypto.randomUUID()),
          // Pods saved before the image/video split are untagged; treat them as
          // image pods so existing setups keep working on the image page.
          kind: pod.kind === "video" ? "video" : "image",
          label: String(pod.label ?? "").trim(),
          podId: String(pod.podId ?? "").trim(),
          ssh: String(pod.ssh ?? "").trim(),
          comfyUrl: String(pod.comfyUrl ?? "").trim().replace(/\/$/, ""),
        }))
      : [],
  };
}

export async function readSettings() {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return cleanSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
  } catch {
    // No local settings yet (e.g. a fresh git clone): seed the pod list from
    // the version-controlled defaults so a new machine has the pods ready.
    // API keys stay empty and must still be entered locally.
    return { ...DEFAULT_SETTINGS, runpodPods: await readDefaultPods() };
  }
}

export async function writeSettings(settings: AppSettings) {
  const clean = cleanSettings(settings);
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(clean, null, 2));
  return clean;
}

export async function getRunpodPod(id: string) {
  const settings = await readSettings();
  return settings.runpodPods.find((pod) => pod.id === id || pod.podId === id);
}

export async function getCivitaiApiKey() {
  const settings = await readSettings();
  return settings.civitaiApiKey || process.env.CIVITAI_API_TOKEN?.trim() || "";
}

export async function getHuggingfaceApiKey() {
  const settings = await readSettings();
  return (
    settings.huggingfaceApiKey ||
    process.env.HF_TOKEN?.trim() ||
    process.env.HUGGINGFACE_TOKEN?.trim() ||
    process.env.HUGGING_FACE_HUB_TOKEN?.trim() ||
    ""
  );
}

export async function getChatProviderApiKey(provider: ChatProviderId) {
  const settings = await readSettings();
  const stored = settings[CHAT_PROVIDER_KEY_FIELDS[provider]];
  if (stored) return stored;
  // Env fallbacks, so an existing .env keeps working without re-entering keys.
  switch (provider) {
    case "openrouter":
      return process.env.OPENROUTER_API_KEY?.trim() ?? "";
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY?.trim() ?? "";
    case "openai":
      return process.env.OPENAI_API_KEY?.trim() ?? "";
    case "google":
      return (
        process.env.GOOGLE_API_KEY?.trim() ||
        process.env.GEMINI_API_KEY?.trim() ||
        ""
      );
  }
}

/** Provider + model + key Paimon should talk to right now. */
export async function getPaimonChatConfig() {
  const settings = await readSettings();
  const provider = settings.paimonChatProvider;
  return {
    provider,
    model: settings.paimonChatModel,
    apiKey: await getChatProviderApiKey(provider),
    reasoning: settings.paimonChatReasoning,
  };
}
