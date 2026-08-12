import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

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
}

const SETTINGS_PATH = join(process.cwd(), ".local", "settings.json");
// Version-controlled pod list used to seed a fresh clone. It holds pod
// connection info only (no API keys), so it is safe to commit.
const DEFAULT_PODS_PATH = join(process.cwd(), "data", "default-pods.json");

const DEFAULT_SETTINGS: AppSettings = {
  civitaiApiKey: "",
  huggingfaceApiKey: "",
  runpodApiKey: "",
  runpodPods: [],
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
