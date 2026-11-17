import "server-only";

import { execFile } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import {
  comfyBaseUrl,
  getComfyLaunch,
  isComfyInstalled,
  isComfyUp,
  isLocalComfy,
  startComfy,
} from "./comfyui-process";
import {
  getWebUiLaunch,
  isWebUiReady,
  startWebUiInBackground,
  webUiUrlFor,
} from "./a1111";
import { getBootProgress, launcherLogPaths, recordBootFinished, type BootProgress } from "./boot-progress";

// Local backend services the launcher (scripts/start-local.ps1) and the
// "실행 관리" panel on the image page manage together. The launcher writes
// .local/launcher-state.json with the PIDs it started; the panel writes
// .local/launcher-config.json to choose what the launcher auto-starts.

const execFileAsync = promisify(execFile);

export type LocalServiceId = "comfyui" | "a1111" | "forge";
export const LOCAL_SERVICE_IDS: LocalServiceId[] = ["comfyui", "a1111", "forge"];

export interface LauncherConfig {
  autoStart: Record<LocalServiceId, boolean>;
}

export const DEFAULT_LAUNCHER_CONFIG: LauncherConfig = {
  autoStart: { comfyui: true, a1111: false, forge: false },
};

export interface LocalServiceStatus {
  id: LocalServiceId;
  label: string;
  url: string;
  port: number;
  installed: boolean;
  running: boolean;
  starting: boolean;
  startedAt: number | null;
  startedBy: "launcher" | "app" | null;
  autoStart: boolean;
  progress: BootProgress | null;
}

// startedAt of boots we saw in progress, so the boot time is recorded once it finishes.
const bootsInFlight = new Map<LocalServiceId, number>();

export interface LauncherStatus {
  launcher: { running: boolean; startedAt: number | null };
  services: LocalServiceStatus[];
  config: LauncherConfig;
}

interface LauncherState {
  launcher?: { pid?: number; startedAt?: number };
  services?: Partial<Record<LocalServiceId, { pid?: number; startedAt?: number }>>;
}

function localDir() {
  const dir = join(process.cwd(), ".local");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const configPath = () => join(localDir(), "launcher-config.json");
const statePath = () => join(localDir(), "launcher-state.json");

function readJson<T>(path: string): T | null {
  try {
    // The launcher writes with PowerShell, which may prepend a UTF-8 BOM.
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as T;
  } catch {
    return null;
  }
}

export function readLauncherConfig(): LauncherConfig {
  const raw = readJson<Partial<LauncherConfig>>(configPath());
  return {
    autoStart: { ...DEFAULT_LAUNCHER_CONFIG.autoStart, ...(raw?.autoStart ?? {}) },
  };
}

export function writeLauncherConfig(patch: Partial<LauncherConfig>) {
  const current = readLauncherConfig();
  const next: LauncherConfig = {
    autoStart: { ...current.autoStart, ...(patch.autoStart ?? {}) },
  };
  writeFileSync(configPath(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

function readLauncherState(): LauncherState {
  return readJson<LauncherState>(statePath()) ?? {};
}

function clearLauncherServiceState(id: LocalServiceId) {
  const state = readLauncherState();
  if (!state.services?.[id]) return;
  delete state.services[id];
  try {
    writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
  } catch {}
}

function isPidAlive(pid: number | undefined | null) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means it exists but belongs to someone else — still alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function portOf(url: string, fallback: number) {
  try {
    const port = Number(new URL(url).port);
    return Number.isFinite(port) && port > 0 ? port : fallback;
  } catch {
    return fallback;
  }
}

function webUiInstalled(id: "a1111" | "forge") {
  const dir =
    id === "forge"
      ? process.env.FORGE_DIR || join(process.cwd(), "stable-diffusion-webui-forge")
      : process.env.A1111_DIR || join(process.cwd(), "stable-diffusion-webui");
  return (
    existsSync(join(dir, "launch.py")) &&
    (existsSync(join(dir, "venv", "Scripts", "python.exe")) ||
      existsSync(join(dir, "venv", "bin", "python")))
  );
}

async function serviceStatus(
  id: LocalServiceId,
  config: LauncherConfig,
  state: LauncherState
): Promise<LocalServiceStatus> {
  const launcherEntry = state.services?.[id];
  const launcherAlive = isPidAlive(launcherEntry?.pid);

  let label: string;
  let url: string;
  let installed: boolean;
  let running: boolean;
  let appLaunch: { startedAt: number; logPath: string } | null;
  if (id === "comfyui") {
    label = "ComfyUI";
    url = comfyBaseUrl();
    installed = isLocalComfy() && isComfyInstalled();
    running = await isComfyUp(1_500);
    appLaunch = getComfyLaunch();
  } else {
    label = id === "forge" ? "Forge" : "A1111";
    url = webUiUrlFor(id);
    installed = webUiInstalled(id);
    running = await isWebUiReady(id);
    appLaunch = getWebUiLaunch(id);
  }

  const startedBy = appLaunch ? "app" : launcherAlive ? "launcher" : null;
  const startedAt = appLaunch?.startedAt ?? (launcherAlive ? launcherEntry?.startedAt ?? null : null);
  const starting = !running && startedBy !== null;

  let progress: BootProgress | null = null;
  if (starting) {
    if (startedAt) bootsInFlight.set(id, startedAt);
    progress = getBootProgress(
      id,
      startedAt,
      appLaunch ? [appLaunch.logPath] : launcherLogPaths(id)
    );
  } else if (running && bootsInFlight.has(id)) {
    recordBootFinished(id, bootsInFlight.get(id)!);
    bootsInFlight.delete(id);
  } else if (!running) {
    bootsInFlight.delete(id);
  }

  return {
    id,
    label,
    url,
    port: portOf(url, id === "comfyui" ? 8188 : id === "forge" ? 7861 : 7860),
    installed,
    running,
    starting,
    startedAt,
    startedBy,
    autoStart: config.autoStart[id],
    progress,
  };
}

export async function getLauncherStatus(): Promise<LauncherStatus> {
  const config = readLauncherConfig();
  const state = readLauncherState();
  const services = await Promise.all(
    LOCAL_SERVICE_IDS.map((id) => serviceStatus(id, config, state))
  );
  const launcherAlive = isPidAlive(state.launcher?.pid);
  return {
    launcher: {
      running: launcherAlive,
      startedAt: launcherAlive ? state.launcher?.startedAt ?? null : null,
    },
    // Hide WebUIs that are not installed and not running — nothing to manage.
    services: services.filter((s) => s.id === "comfyui" || s.installed || s.running),
    config,
  };
}

export async function startService(id: LocalServiceId) {
  if (id === "comfyui") {
    const result = await startComfy();
    if (!result.ok) throw new Error(result.message);
    return;
  }
  if (!webUiInstalled(id)) {
    throw new Error(`${id === "forge" ? "Forge" : "A1111"} is not installed. Run: npm run setup:${id}`);
  }
  await startWebUiInBackground(id);
}

async function listeningPids(port: number): Promise<number[]> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "TCP"], {
        windowsHide: true,
      });
      const pids = new Set<number>();
      for (const line of stdout.split(/\r?\n/)) {
        const cols = line.trim().split(/\s+/);
        // Proto  Local Address  Foreign Address  State  PID
        if (cols.length < 5 || cols[3] !== "LISTENING") continue;
        if (!cols[1].endsWith(":" + port)) continue;
        const pid = Number(cols[4]);
        if (pid > 0) pids.add(pid);
      }
      return [...pids];
    }
    const { stdout } = await execFileAsync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"]);
    return stdout.split(/\s+/).map(Number).filter((pid) => pid > 0);
  } catch {
    return [];
  }
}

async function killTree(pid: number) {
  if (pid === process.pid) return;
  try {
    if (process.platform === "win32") {
      await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      process.kill(pid, "SIGTERM");
    }
  } catch {
    // Already gone.
  }
}

export async function stopService(id: LocalServiceId) {
  const status = await serviceStatus(id, readLauncherConfig(), readLauncherState());
  const pids = new Set(await listeningPids(status.port));
  // Also stop a still-booting wrapper (npm/powershell) that has not bound the port yet.
  const appLaunch = id === "comfyui" ? getComfyLaunch() : getWebUiLaunch(id);
  if (appLaunch?.pid) pids.add(appLaunch.pid);
  const launcherPid = readLauncherState().services?.[id]?.pid;
  if (launcherPid && isPidAlive(launcherPid)) pids.add(launcherPid);

  await Promise.all([...pids].map(killTree));
  clearLauncherServiceState(id);

  // Wait (briefly) for the port to free up so a following start doesn't race it.
  for (let i = 0; i < 20; i++) {
    if ((await listeningPids(status.port)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function restartService(id: LocalServiceId) {
  await stopService(id);
  await startService(id);
}
