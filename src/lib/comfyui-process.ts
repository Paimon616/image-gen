import "server-only";

import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "fs";
import { join } from "path";

// Local ComfyUI process management. The launcher no longer starts ComfyUI; the
// app starts it on demand (see /api/comfyui/start). This mirrors the on-demand
// WebUI launch pattern in a1111.ts.

const COMFYUI_BASE_URL =
  process.env.COMFYUI_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8188";
const COMFYUI_DIR = process.env.COMFYUI_DIR || join(process.cwd(), "ComfyUI");
const BOOT_TIMEOUT_MS = Number(process.env.COMFYUI_BOOT_TIMEOUT_MS ?? 300_000);

// Only a loopback ComfyUI is ours to spawn. A remote/override URL is managed
// elsewhere (e.g. a RunPod pod), so we never try to launch a process for it.
export function isLocalComfy() {
  try {
    const host = new URL(COMFYUI_BASE_URL).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

// ComfyUI is installed when both the entrypoint and its venv python exist. This
// matches the check the launcher uses before offering to run setup.
export function isComfyInstalled() {
  return (
    existsSync(join(COMFYUI_DIR, "main.py")) &&
    existsSync(join(COMFYUI_DIR, "venv", "bin", "python"))
  );
}

// Reachable AND initialized: /system_stats only answers once the server is up.
export async function isComfyUp(timeoutMs = 3_000) {
  try {
    const res = await fetch(COMFYUI_BASE_URL + "/system_stats", {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Track whether we have already asked ComfyUI to launch so overlapping status
// polls / clicks don't each spawn their own process.
let launching: { child: ChildProcess; logPath: string } | null = null;

function comfyLogPath() {
  const logDir = process.env.LOG_DIR || join(process.cwd(), ".local", "logs");
  mkdirSync(logDir, { recursive: true });
  return join(logDir, "comfyui.log");
}

function lastLogLines(logPath: string, lines: number) {
  try {
    return readFileSync(logPath, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

function spawnComfy() {
  const windows = process.platform === "win32";
  const script = join(
    process.cwd(),
    "scripts",
    windows ? "run-comfyui.ps1" : "run-comfyui.sh"
  );
  if (!existsSync(script)) {
    throw new Error(`No ComfyUI launcher script at ${script}.`);
  }

  const logPath = comfyLogPath();
  const fd = openSync(logPath, "w");
  const child = spawn(
    windows ? "powershell.exe" : "bash",
    windows
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]
      : [script],
    {
      detached: true,
      stdio: ["ignore", fd, fd],
      cwd: process.cwd(),
      // Keep host/port consistent with COMFYUI_BASE_URL even if it was overridden.
      env: (() => {
        try {
          const url = new URL(COMFYUI_BASE_URL);
          return {
            ...process.env,
            COMFYUI_HOST: url.hostname,
            COMFYUI_PORT: url.port || "8188",
          };
        } catch {
          return process.env;
        }
      })(),
    }
  );
  child.unref();
  return { child, logPath };
}

export interface ComfyStatus {
  running: boolean;
  starting: boolean;
  local: boolean;
  installed: boolean;
}

export async function getComfyStatus(): Promise<ComfyStatus> {
  const local = isLocalComfy();
  const installed = local && isComfyInstalled();
  const running = await isComfyUp();

  // Once it is up, clear any launch bookkeeping. If the launch process died
  // before the server came up, the start failed — drop it so a retry is allowed.
  if (running) {
    launching = null;
  } else if (launching && launching.child.exitCode !== null) {
    launching = null;
  }

  return {
    running,
    starting: !running && launching !== null,
    local,
    installed,
  };
}

// Kick off a ComfyUI launch if it is not already up or starting. Returns
// immediately; callers poll getComfyStatus() until `running` flips true.
export async function startComfy(): Promise<
  | { ok: true; status: ComfyStatus }
  | { ok: false; reason: "not-local" | "not-installed" | "spawn-failed"; message: string }
> {
  if (!isLocalComfy()) {
    return {
      ok: false,
      reason: "not-local",
      message: "ComfyUI is configured at a non-local URL; start it there.",
    };
  }
  if (!isComfyInstalled()) {
    return {
      ok: false,
      reason: "not-installed",
      message: "ComfyUI is not installed. Run: npm run setup:comfyui",
    };
  }

  if (await isComfyUp()) {
    return { ok: true, status: await getComfyStatus() };
  }

  if (!launching || launching.child.exitCode !== null) {
    try {
      launching = spawnComfy();
    } catch (error) {
      launching = null;
      return {
        ok: false,
        reason: "spawn-failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { ok: true, status: await getComfyStatus() };
}

// Wait until ComfyUI is up (used only if a caller wants to block). The route
// layer stays non-blocking and lets the client poll instead.
export async function waitForComfy(signal?: AbortSignal) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("Canceled.");
    if (await isComfyUp()) return true;
    if (launching && launching.child.exitCode !== null) {
      const tail = lastLogLines(launching.logPath, 20);
      launching = null;
      throw new Error(
        `ComfyUI failed to start.${tail ? "\n" + tail : ""}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Timed out waiting for ComfyUI to start.");
}
