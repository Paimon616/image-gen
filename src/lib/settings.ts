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
  runpodApiKey: string;
  runpodPods: RunpodPodSettings[];
}

const SETTINGS_PATH = join(process.cwd(), ".local", "settings.json");

const DEFAULT_SETTINGS: AppSettings = {
  civitaiApiKey: "",
  runpodApiKey: "",
  runpodPods: [],
};

function cleanSettings(value: Partial<AppSettings>): AppSettings {
  return {
    civitaiApiKey: String(value.civitaiApiKey ?? "").trim(),
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
    return DEFAULT_SETTINGS;
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
