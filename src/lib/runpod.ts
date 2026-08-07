import "server-only";

import { execFile, spawn } from "child_process";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, dirname } from "path";
import { promisify } from "util";
import type { GenerationParams, ImportedCivitaiResource } from "@/lib/types";
import { getRunpodPod, readSettings, type RunpodPodSettings } from "@/lib/settings";
import { parseCivitaiUrlIds } from "@/lib/civitai-url";
import {
  RESOURCE_CATALOG_FOLDERS,
  searchCivitaiResourceByFilename,
} from "@/lib/civitai-resource-search";
import {
  KREA2_CLIP_NAME,
  KREA2_VAE_NAME,
  isKrea2CheckpointName,
} from "@/lib/comfyui-model-files";

const execFileAsync = promisify(execFile);

const RESOURCE_FOLDERS: Partial<Record<ImportedCivitaiResource["type"], string>> = {
  checkpoint: "checkpoints",
  lora: "loras",
  embedding: "embeddings",
  vae: "vae",
  upscaler: "upscale_models",
};

const RUNPOD_BASE_ASSETS = [
  {
    path: "/workspace/ComfyUI/models/upscale_models/4x-UltraSharp.pth",
    url: "https://huggingface.co/shiertier/upscale_models/resolve/b73626f248084e9af7108621ace5651e1447af44/4x-UltraSharp.pth",
  },
  {
    path: "/workspace/ComfyUI/models/upscale_models/remacri_original.safetensors",
    url: "https://civitai.com/api/download/models/164821",
  },
  {
    path: `/workspace/ComfyUI/models/text_encoders/${KREA2_CLIP_NAME}`,
    url: `https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/${KREA2_CLIP_NAME}`,
  },
  {
    path: `/workspace/ComfyUI/models/vae/${KREA2_VAE_NAME}`,
    url: `https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/${KREA2_VAE_NAME}`,
  },
  {
    path: "/workspace/ComfyUI/models/ultralytics/bbox/face_yolov8n_v2.pt",
    url: "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8n_v2.pt",
  },
  {
    path: "/workspace/ComfyUI/models/ultralytics/bbox/face_yolov8m.pt",
    url: "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt",
  },
] as const;

function runpodBaseAssetForPath(path: string) {
  const normalized = path.replace(/^\/workspace\/ComfyUI\/models\//, "");
  return RUNPOD_BASE_ASSETS.find((asset) =>
    asset.path.endsWith(`/models/${normalized}`)
  );
}

function deriveHelperUrl(pod: RunpodPodSettings) {
  if (!pod.comfyUrl) return "";
  return pod.comfyUrl
    .replace(/\/$/, "")
    .replace(/-8188\.proxy\.runpod\.net/i, "-3000.proxy.runpod.net")
    .replace(/:8188\b/, ":3000");
}

async function fetchRunpodHelper(
  pod: RunpodPodSettings,
  path: string,
  init?: RequestInit
) {
  const helperUrl = deriveHelperUrl(pod);
  if (!helperUrl) {
    throw new Error("RunPod Image Gen helper URL is not configured.");
  }

  const response = await fetch(`${helperUrl}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok) {
    throw new Error(String(data.error || `RunPod helper HTTP ${response.status}`));
  }
  return data;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function extractSshCommand(value: string) {
  const normalized = value
    .trim()
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim().replace(/^\$\s*/, ""))
    .find((line) => line.includes("@") || line.startsWith("ssh "));

  if (!normalized) return "";

  const sshIndex = normalized.indexOf("ssh ");
  if (sshIndex >= 0) return normalized.slice(sshIndex).trim();

  if (normalized.includes("@")) {
    return `ssh ${normalized}`;
  }

  return "";
}

function splitShellWords(value: string) {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | "" = "";
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) words.push(current);
  return words;
}

function expandHomePath(value: string) {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return `${homedir()}${value.slice(1)}`;
  return value;
}

function normalizeSshOptionArgs(args: string[]) {
  return args.map((arg, index) => {
    const previous = args[index - 1];

    if (previous === "-i" || previous === "-F") {
      return expandHomePath(arg);
    }

    if (/^IdentityFile=~(?:\/|$)/.test(arg)) {
      return `IdentityFile=${expandHomePath(arg.slice("IdentityFile=".length))}`;
    }

    return arg;
  });
}

interface ParsedSshCommand {
  destination: string;
  user: string;
  host: string;
  optionArgs: string[];
}

function parseSshCommand(value: string): ParsedSshCommand | null {
  const words = splitShellWords(value);
  const args = words[0] === "ssh" ? words.slice(1) : words;
  const destinationIndex = args.findIndex((arg) =>
    /^[^@\s]+@[^@\s]+$/i.test(arg)
  );

  if (destinationIndex < 0) return null;

  const destination = args[destinationIndex];
  const [user, host] = destination.split("@", 2);
  const beforeDestination = args.slice(0, destinationIndex);
  const afterDestination = args.slice(destinationIndex + 1);

  return {
    destination,
    user,
    host,
    optionArgs: normalizeSshOptionArgs([
      ...beforeDestination,
      ...afterDestination,
    ]),
  };
}

function optionArgsWithoutEndpoint(args: string[]) {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-p" || arg === "-l") {
      index += 1;
      continue;
    }
    if (arg.startsWith("-p") && arg.length > 2) continue;
    if (arg.startsWith("-l") && arg.length > 2) continue;
    if (/^(?:Port|HostName|User)=/i.test(arg)) continue;
    result.push(arg);
  }
  return result;
}

function normalizedSshCommand(value: string) {
  const parsed = parseSshCommand(value);
  if (!parsed) return "";

  return [
    "ssh",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...parsed.optionArgs,
    parsed.destination,
  ]
    .map(shellQuote)
    .join(" ");
}

async function fetchRunpodSshEndpoint(pod: RunpodPodSettings) {
  if (!pod.podId) return null;

  const settings = await readSettings();
  if (!settings.runpodApiKey) return null;

  const response = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.runpodApiKey}`,
    },
    body: JSON.stringify({
      query:
        "query PodRuntime($podId: String!) { pod(input: { podId: $podId }) { runtime { ports { ip isIpPublic privatePort publicPort } } } }",
      variables: { podId: pod.podId },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RunPod runtime lookup failed: HTTP ${response.status} ${text}`);
  }

  const data = JSON.parse(text) as {
    errors?: Array<{ message?: string }>;
    data?: {
      pod?: {
        runtime?: {
          ports?: Array<{
            ip?: string;
            isIpPublic?: boolean;
            privatePort?: number;
            publicPort?: number;
          }>;
        };
      };
    };
  };

  if (data.errors?.length) {
    throw new Error(
      `RunPod runtime lookup failed: ${data.errors.map((error) => error.message).join(", ")}`
    );
  }

  const sshPort = data.data?.pod?.runtime?.ports?.find(
    (port) => port.privatePort === 22 && port.isIpPublic && port.ip && port.publicPort
  );

  if (!sshPort?.ip || !sshPort.publicPort) return null;

  return { host: sshPort.ip, port: String(sshPort.publicPort) };
}

async function resolvedSshCommand(pod: RunpodPodSettings) {
  const extracted = extractSshCommand(pod.ssh);
  if (!extracted) {
    throw new Error(
      "RunPod SSH command was not recognized. Paste the SSH line from RunPod Connect."
    );
  }

  const parsed = parseSshCommand(extracted);
  if (!parsed) {
    throw new Error("RunPod SSH command must include a user@host address.");
  }

  let safeSsh = normalizedSshCommand(extracted);
  const endpoint = await fetchRunpodSshEndpoint(pod);
  if (endpoint) {
    const destinationUser = /(?:^|\.)ssh\.runpod\.io$/i.test(parsed.host)
      ? "root"
      : parsed.user;
    const destination = `${destinationUser}@${endpoint.host}`;
    safeSsh = [
      "ssh",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-p",
      endpoint.port,
      ...optionArgsWithoutEndpoint(parsed.optionArgs),
      destination,
    ]
      .map(shellQuote)
      .join(" ");
  } else if (/(?:^|\.)ssh\.runpod\.io$/i.test(parsed.host)) {
    throw new Error(
      "RunPod SSH public port is not exposed yet. Add 22/tcp to the pod ports, wait for the runtime endpoint, then retry Helper 연결."
    );
  }

  if (!safeSsh) {
    throw new Error("RunPod SSH command must include a user@host address.");
  }

  return safeSsh;
}

async function remoteCommand(pod: RunpodPodSettings, command: string) {
  return `${await resolvedSshCommand(pod)} ${shellQuote(command)}`;
}

function identityFileFromSsh(value: string) {
  const extracted = extractSshCommand(value);
  if (!extracted) return "";
  const parsed = parseSshCommand(extracted);
  if (!parsed) return "";

  const identityIndex = parsed.optionArgs.findIndex((arg) => arg === "-i");
  if (identityIndex >= 0) return parsed.optionArgs[identityIndex + 1] ?? "";

  const identityOption = parsed.optionArgs.find((arg) =>
    /^IdentityFile=/i.test(arg)
  );
  return identityOption?.slice("IdentityFile=".length) ?? "";
}

function friendlySshError(pod: RunpodPodSettings, error: unknown) {
  const message = error instanceof Error ? error.message : "SSH failed.";
  if (/Connection refused/i.test(message)) {
    return "RunPod SSH endpoint is not accepting connections yet. Wait for the pod runtime port to finish attaching, then retry Helper 연결.";
  }
  if (/Operation timed out|Connection timed out/i.test(message)) {
    return "RunPod SSH endpoint timed out. Check that the pod is running and its 22/tcp port is exposed, then retry Helper 연결.";
  }
  if (!/Permission denied \(publickey,password\)/i.test(message)) {
    return message;
  }

  const identityFile = identityFileFromSsh(pod.ssh);
  const keyHint = identityFile ? ` (${identityFile})` : "";
  return [
    `RunPod가 SSH key를 거절했습니다${keyHint}.`,
    "SSH 명령 형식은 맞지만, 이 private key가 해당 pod에서 허용되지 않습니다.",
    "runpod-video는 전용 RunPod SSH key와 ssh_config를 사용했습니다. 같은 private key를 -i에 넣거나, 이 key의 .pub 파일을 RunPod에 등록한 뒤 pod를 다시 시작하세요.",
  ].join(" ");
}

export async function runSsh(
  pod: RunpodPodSettings,
  command: string,
  options: { timeoutMs?: number } = {}
) {
  if (!pod.ssh.trim()) {
    throw new Error("RunPod SSH command is not configured.");
  }

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(
      "bash",
      ["-lc", await remoteCommand(pod, command)],
      {
        timeout: options.timeoutMs ?? 30 * 60 * 1000,
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    throw new Error(friendlySshError(pod, error));
  }

  return { stdout, stderr };
}

export async function streamSsh(
  pod: RunpodPodSettings,
  command: string,
  handlers: {
    onStdout?: (chunk: string) => void;
    onStderr?: (chunk: string) => void;
  } = {}
) {
  if (!pod.ssh.trim()) {
    throw new Error("RunPod SSH command is not configured.");
  }

  const shellCommand = await remoteCommand(pod, command);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("bash", ["-lc", shellCommand], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => handlers.onStdout?.(chunk));
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      handlers.onStderr?.(chunk);
    });
    child.on("error", (error) => reject(new Error(friendlySshError(pod, error))));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(friendlySshError(pod, new Error(stderr || `SSH exited with code ${code}`))));
    });
  });
}

export async function startRunpodPod(podId: string) {
  const settings = await readSettings();
  if (!settings.runpodApiKey) {
    throw new Error("RunPod API key is not configured.");
  }

  const response = await fetch(
    `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}/start`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.runpodApiKey}` },
      cache: "no-store",
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RunPod start failed: ${response.status} ${text}`);
  }

  return text;
}

export async function ensureRunpodPort(
  podId: string,
  port: number,
  protocol: "http" | "tcp" = "http"
) {
  const settings = await readSettings();
  if (!settings.runpodApiKey) {
    throw new Error("RunPod API key is not configured.");
  }

  const podResponse = await fetch(
    `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}`,
    {
      headers: { Authorization: `Bearer ${settings.runpodApiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  );
  const podText = await podResponse.text();
  if (!podResponse.ok) {
    throw new Error(`RunPod pod lookup failed: ${podResponse.status} ${podText}`);
  }

  const podData = JSON.parse(podText) as { ports?: unknown };
  const currentPorts = Array.isArray(podData.ports)
    ? podData.ports.filter((value): value is string => typeof value === "string")
    : [];
  const portSpec = `${port}/${protocol}`;

  if (currentPorts.includes(portSpec)) {
    return { changed: false, ports: currentPorts };
  }

  const ports = [...currentPorts, portSpec];
  const patchResponse = await fetch(
    `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${settings.runpodApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ports }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    }
  );
  const patchText = await patchResponse.text();
  if (!patchResponse.ok) {
    throw new Error(`RunPod port update failed: ${patchResponse.status} ${patchText}`);
  }

  return { changed: true, ports };
}

export async function ensureRunpodHttpPort(podId: string, port: number) {
  return ensureRunpodPort(podId, port, "http");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function stopRunpodPod(podId: string) {
  const settings = await readSettings();
  if (!settings.runpodApiKey) {
    throw new Error("RunPod API key is not configured.");
  }

  const response = await fetch(
    `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}/stop`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.runpodApiKey}` },
      cache: "no-store",
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RunPod stop failed: ${response.status} ${text}`);
  }

  return text;
}

export async function fetchRunpodStatus(pod: RunpodPodSettings) {
  const comfyUrl = pod.comfyUrl.replace(/\/$/, "");
  let comfyReachable = false;
  let comfyError = "";

  if (comfyUrl) {
    try {
      const response = await fetch(`${comfyUrl}/system_stats`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      comfyReachable = response.ok;
      if (!response.ok) comfyError = `ComfyUI HTTP ${response.status}`;
    } catch (error) {
      comfyError = error instanceof Error ? error.message : "ComfyUI is not reachable.";
    }
  }

  let helperReachable = false;
  let helperError = "";
  try {
    const helper = await fetchRunpodHelper(pod, "/api/runpod/helper/status", {
      signal: AbortSignal.timeout(5_000),
    });
    helperReachable = Boolean(helper.ok);
  } catch (error) {
    helperError = error instanceof Error ? error.message : "RunPod helper is not reachable.";
  }

  return { comfyReachable, comfyError, helperReachable, helperError };
}

export async function ensureRunpodStatus(pod: RunpodPodSettings) {
  let status = await fetchRunpodStatus(pod);
  let startRequested = false;
  let portExposeRequested = false;
  let portExposeError = "";
  let setupRequested = false;
  let setupError = "";

  if (!status.helperReachable && pod.podId) {
    try {
      const result = await ensureRunpodHttpPort(pod.podId, 3000);
      portExposeRequested = result.changed;
    } catch (error) {
      portExposeError = error instanceof Error ? error.message : "RunPod port update failed.";
    }
  }

  if (!status.comfyReachable && !status.helperReachable && pod.podId) {
    await startRunpodPod(pod.podId);
    startRequested = true;
  }

  if (startRequested) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await wait(5_000);
      status = await fetchRunpodStatus(pod);
      if (status.comfyReachable && status.helperReachable) break;
    }
  }

  if (!status.helperReachable && pod.ssh.trim()) {
    try {
      await setupRunpodPod(pod);
      setupRequested = true;
      await wait(5_000);
      status = await fetchRunpodStatus(pod);
    } catch (error) {
      setupError = error instanceof Error ? error.message : "RunPod helper setup failed.";
    }
  }

  return { ...status, startRequested, portExposeRequested, portExposeError, setupRequested, setupError };
}

export async function setupRunpodPod(pod: RunpodPodSettings) {
  const helperServer = String.raw`
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("IMAGE_GEN_HELPER_PORT", "3000"))
HOST = os.environ.get("IMAGE_GEN_HELPER_HOST", "0.0.0.0")
COMFYUI_HOST = os.environ.get("COMFYUI_HOST", "0.0.0.0")
COMFYUI_PORT = int(os.environ.get("COMFYUI_PORT", "8188"))

def detect_comfyui_dir():
    env_dir = Path(os.environ.get("COMFYUI_DIR", "")).resolve() if os.environ.get("COMFYUI_DIR") else None
    candidates = [
        env_dir,
        Path("/workspace/ComfyUI"),
        Path("/workspace/runpod-slim/ComfyUI"),
        Path("/opt/comfyui-baked"),
    ]
    proc = Path("/proc")
    if proc.exists():
        for item in proc.iterdir():
            if not item.name.isdigit():
                continue
            try:
                cmdline = (item / "cmdline").read_bytes().decode("utf-8", "ignore")
                if "main.py" not in cmdline:
                    continue
                cwd = (item / "cwd").resolve()
                candidates.insert(0, cwd)
            except Exception:
                continue
    for candidate in candidates:
        if candidate and (candidate / "main.py").is_file():
            return candidate.resolve()
    return Path("/workspace/ComfyUI").resolve()

COMFYUI_DIR = detect_comfyui_dir()
MODELS_DIR = Path(os.environ.get("COMFYUI_MODELS_DIR", str(COMFYUI_DIR / "models"))).resolve()

def migrate_legacy_models():
    legacy = Path("/workspace/ComfyUI/models").resolve()
    if legacy == MODELS_DIR or not legacy.exists():
        return
    for source in legacy.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(legacy)
        target = MODELS_DIR / relative
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.link(source, target)
        except Exception:
            shutil.copy2(source, target)

migrate_legacy_models()

def model_path(value):
    raw = str(value or "").strip()
    prefix = "/workspace/ComfyUI/models/"
    rel = raw[len(prefix):] if raw.startswith(prefix) else raw.lstrip("/")
    target = (MODELS_DIR / rel).resolve()
    if target == MODELS_DIR or MODELS_DIR not in target.parents:
        raise ValueError("Invalid model path.")
    return target

def read_json(handler):
    length = int(handler.headers.get("Content-Length") or "0")
    data = handler.rfile.read(length) if length > 0 else b"{}"
    return json.loads(data.decode("utf-8") or "{}")

def write_json(handler, status, data):
    body = json.dumps(data).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def restart_comfyui():
    main_py = COMFYUI_DIR / "main.py"
    if not main_py.is_file():
        raise RuntimeError("ComfyUI main.py was not found: " + str(main_py))

    python = COMFYUI_DIR / "venv/bin/python"
    python_cmd = str(python) if python.exists() else shutil.which("python3")
    if not python_cmd:
        raise RuntimeError("python3 was not found.")

    os.system("pkill -f '/workspace/ComfyUI/main.py' >/dev/null 2>&1 || true")
    os.system("fuser -k %d/tcp >/dev/null 2>&1 || true" % COMFYUI_PORT)

    log = open("/workspace/image-gen-helper/comfyui-restart.log", "ab", buffering=0)
    process = subprocess.Popen(
        [
            python_cmd,
            str(main_py),
            "--listen",
            COMFYUI_HOST,
            "--port",
            str(COMFYUI_PORT),
            "--enable-cors-header",
        ],
        cwd=str(COMFYUI_DIR),
        env=dict(os.environ, COMFYUI_MODELS_DIR=str(MODELS_DIR)),
        stdout=log,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    with open("/workspace/image-gen-helper/comfyui.pid", "w") as pid_file:
        pid_file.write(str(process.pid))
    log.write(("ComfyUI restart requested, pid=%s\n" % process.pid).encode("utf-8"))
    return process.pid

def download_to_file(target, url, token="", progress=None):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.is_file():
        return str(target)
    tmp = Path(str(target) + ".download")
    existing = tmp.stat().st_size if tmp.exists() else 0
    headers = {"User-Agent": "image-gen-runpod-download/1.0"}
    if token:
        headers["Authorization"] = "Bearer " + token
    if existing > 0:
        headers["Range"] = "bytes=%d-" % existing
    if progress:
        progress(existing, 0)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    response = None
    for _ in range(5):
        req = urllib.request.Request(url, headers=headers)
        try:
            response = opener.open(req, timeout=60)
            break
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303, 307, 308):
                raise
            location = error.headers.get("Location")
            if not location:
                raise
            url = urllib.request.urljoin(url, location)
            headers.pop("Authorization", None)
    else:
        raise RuntimeError("Too many redirects.")

    with response:
        total = int(response.headers.get("Content-Length") or "0")
        total = existing + total if total > 0 else 0
        downloaded = existing
        with open(tmp, "ab" if existing > 0 else "wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                if progress:
                    progress(downloaded, total)
    tmp.replace(target)
    if progress:
        progress(target.stat().st_size, target.stat().st_size)
    return str(target)

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stdout.write(fmt % args + "\n")
        sys.stdout.flush()

    def do_GET(self):
        if self.path == "/api/runpod/helper/status":
            write_json(self, 200, {
                "ok": True,
                "message": "RunPod Image Gen helper ready",
                "comfyModelsDir": str(MODELS_DIR),
            })
            return
        write_json(self, 404, {"error": "Not found."})

    def do_POST(self):
        try:
            if self.path == "/api/runpod/helper/files":
                body = read_json(self)
                files = [str(value) for value in body.get("files", [])] if isinstance(body.get("files"), list) else []
                write_json(self, 200, {"files": [
                    {"path": path, "exists": model_path(path).is_file()} for path in files
                ]})
                return
            if self.path == "/api/runpod/helper/download":
                body = read_json(self)
                target = model_path(body.get("targetFile", ""))
                url = str(body.get("downloadUrl", "")).strip()
                if not url:
                    raise ValueError("Download URL is required.")
                write_json(self, 200, {"path": download_to_file(target, url, str(body.get("token", "")))})
                return
            if self.path == "/api/runpod/helper/download/stream":
                body = read_json(self)
                target = model_path(body.get("targetFile", ""))
                url = str(body.get("downloadUrl", "")).strip()
                if not url:
                    raise ValueError("Download URL is required.")
                self.send_response(200)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                def send(event):
                    self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                download_to_file(target, url, str(body.get("token", "")), lambda downloaded, total: send({
                    "type": "status" if total > 0 and downloaded >= total else "progress",
                    "path": str(target),
                    "downloaded": downloaded,
                    "total": total,
                    "percent": min(100, round(downloaded / total * 100)) if total > 0 else 0,
                }))
                send({"type": "complete", "path": str(target), "percent": 100})
                return
            if self.path == "/api/runpod/helper/restart-comfy":
                pid = restart_comfyui()
                write_json(self, 200, {"ok": True, "pid": pid})
                return
            write_json(self, 404, {"error": "Not found."})
        except Exception as error:
            write_json(self, 400, {"error": str(error)})

ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
`.trim();
  const helperServerBase64 = Buffer.from(helperServer, "utf8").toString("base64");

  const script = [
    "set -euo pipefail",
    "command -v python3 >/dev/null 2>&1",
    "mkdir -p /workspace/image-gen-helper",
    "if [ -f /workspace/image-gen-helper/helper.pid ]; then kill \"$(cat /workspace/image-gen-helper/helper.pid)\" >/dev/null 2>&1 || true; fi",
    "if command -v fuser >/dev/null 2>&1; then fuser -k 3000/tcp >/dev/null 2>&1 || true; fi",
    `printf %s ${shellQuote(helperServerBase64)} | base64 -d > /workspace/image-gen-helper/server.py`,
    "nohup python3 /workspace/image-gen-helper/server.py > /workspace/image-gen-helper.log 2>&1 < /dev/null & echo $! > /workspace/image-gen-helper/helper.pid",
    "echo 'Image Gen helper start requested on port 3000.'",
  ].join("; ");

  return runSsh(pod, script, { timeoutMs: 30_000 });
}

interface CatalogEntry {
  name?: string;
  version?: string;
  base_model?: string;
  civitai_url?: string | null;
  source_url?: string | null;
}

async function readModelCatalog() {
  try {
    return JSON.parse(await readFile("data/model-catalog.json", "utf8")) as Record<string, CatalogEntry>;
  } catch {
    return {};
  }
}

async function writeModelCatalog(catalog: Record<string, CatalogEntry>) {
  await mkdir("data", { recursive: true });
  await writeFile("data/model-catalog.json", JSON.stringify(catalog, null, 2));
}

async function upsertCatalogResource(
  catalog: Record<string, CatalogEntry>,
  folder: string,
  filename: string,
  resource: ImportedCivitaiResource
) {
  const key = `${folder}/${filename}`;
  const existing = catalog[key] ?? {};
  catalog[key] = {
    ...existing,
    name: resource.name || existing.name || filename,
    version: resource.versionName || existing.version || "",
    base_model: resource.baseModel || existing.base_model || "",
    civitai_url: resource.url || existing.civitai_url || null,
    source_url: resource.url || existing.source_url || null,
  };
  await writeModelCatalog(catalog);
}

function resourceFromCatalog(
  catalog: Record<string, CatalogEntry>,
  type: ImportedCivitaiResource["type"],
  folder: string,
  filename: string
) {
  const metadata = catalog[`${folder}/${filename}`] ?? catalog[filename];
  const baseAsset = runpodBaseAssetForPath(`${folder}/${filename}`);
  const url = metadata?.civitai_url || metadata?.source_url || baseAsset?.url || "";
  const ids = parseCivitaiUrlIds(url);
  return {
    type,
    name: metadata?.name || filename,
    versionName: metadata?.version || "",
    baseModel: metadata?.base_model || "",
    url,
    modelId: ids.modelId ? Number(ids.modelId) : undefined,
    modelVersionId: ids.modelVersionId ? Number(ids.modelVersionId) : undefined,
  } satisfies ImportedCivitaiResource;
}

function importedResourceCandidateNames(resource: ImportedCivitaiResource) {
  const candidates = [
    resource.fileName ?? "",
    resource.name,
    resource.versionName ?? "",
    [resource.name, resource.versionName].filter(Boolean).join(" "),
  ].filter(Boolean);

  if (resource.type === "embedding") {
    const source = resource.versionName || resource.name;
    const lazyToken = source.match(/\b(lazypos|lazyneg|lazyhand)\b/i)?.[1];
    if (lazyToken) candidates.push(lazyToken.toLowerCase());
  }

  return candidates.flatMap((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return [];
    return /\.(ckpt|pt|pth|safetensors)$/i.test(trimmed)
      ? [trimmed]
      : [trimmed, `${trimmed}.safetensors`];
  });
}

function resourceFromImportedResources(
  resources: ImportedCivitaiResource[],
  type: ImportedCivitaiResource["type"],
  filename: string
) {
  const normalizedFilename = filename.trim().toLowerCase();
  if (!normalizedFilename) return undefined;

  return resources.find((resource) => {
    if (resource.type !== type) return false;
    return importedResourceCandidateNames(resource).some(
      (candidate) => candidate.toLowerCase() === normalizedFilename
    );
  });
}

async function namesForParams(
  params: GenerationParams,
  importedResources: ImportedCivitaiResource[] = []
) {
  const catalog = await readModelCatalog();
  const names: Array<{
    type: ImportedCivitaiResource["type"];
    folder: string;
    name: string;
    resource: ImportedCivitaiResource;
  }> = [];
  const push = (type: ImportedCivitaiResource["type"], folder: string, name: string) => {
    names.push({
      type,
      folder,
      name,
      resource:
        resourceFromImportedResources(importedResources, type, name) ??
        resourceFromCatalog(catalog, type, folder, name),
    });
  };
  const checkpointName = params.model_name.trim();
  if (checkpointName) {
    push(
      "checkpoint",
      isKrea2CheckpointName(checkpointName) ? "diffusion_models" : "checkpoints",
      checkpointName
    );
    if (isKrea2CheckpointName(checkpointName)) {
      push("other", "text_encoders", KREA2_CLIP_NAME);
      push("vae", "vae", KREA2_VAE_NAME);
    }
  }
  (params.loras ?? []).forEach((lora) => {
    if (lora.path.trim()) push("lora", "loras", lora.path.trim());
  });
  (params.embeddings ?? []).forEach((embedding) => {
    if (embedding.path.trim()) {
      push("embedding", "embeddings", embedding.path.trim());
    }
  });
  if (params.vae_name.trim()) {
    push("vae", "vae", params.vae_name.trim());
  }
  if (params.upscale_model_name.trim()) {
    push("upscaler", "upscale_models", params.upscale_model_name.trim());
  }
  if (params.adetailer_enabled) {
    const requestedModel = params.adetailer_model.trim();
    const normalizedDetectorModel = requestedModel.startsWith("bbox/")
      ? requestedModel
      : requestedModel
        ? `bbox/${requestedModel}`
        : "bbox/face_yolov8n_v2.pt";
    const detectorModel = [
      "bbox/face_yolov8n_v2.pt",
      "bbox/face_yolov8m.pt",
    ].includes(normalizedDetectorModel)
      ? normalizedDetectorModel
      : "bbox/face_yolov8n_v2.pt";
    push("other", "ultralytics", detectorModel);
  }
  return names;
}

export async function checkRunpodGenerationFiles(
  pod: RunpodPodSettings,
  params: GenerationParams,
  importedResources: ImportedCivitaiResource[] = []
) {
  const resources = await namesForParams(params, importedResources);
  if (resources.length === 0) return [];

  const files = resources.map((resource) => `${resource.folder}/${resource.name}`);
  const data = await fetchRunpodHelper(pod, "/api/runpod/helper/files", {
    method: "POST",
    body: JSON.stringify({ files }),
  });
  const present = Array.isArray(data.files)
    ? new Set(
        data.files
          .filter((file): file is { path: string; exists: boolean } =>
            Boolean(file) && typeof file === "object" && "path" in file
          )
          .filter((file) => file.exists)
          .map((file) => file.path)
      )
    : new Set<string>();

  const missing = resources
    .filter(({ folder, name }) => !present.has(`${folder}/${name}`))
    .map(({ folder, name, resource }) => ({ folder, path: `${folder}/${name}`, resource }));

  if (missing.length === 0) return [];

  const catalog = await readModelCatalog();
  const enriched = await Promise.all(
    missing.map(async (item) => {
      if (item.resource.url && item.resource.modelVersionId) return item;
      const catalogFolder = RESOURCE_CATALOG_FOLDERS[item.resource.type];
      if (!catalogFolder || catalogFolder !== item.folder) return item;

      const found = await searchCivitaiResourceByFilename(
        item.resource.type,
        basename(item.path)
      );
      if (!found) return item;
      const foundResource = found as ImportedCivitaiResource;

      await upsertCatalogResource(catalog, item.folder, basename(item.path), foundResource);
      const resource: ImportedCivitaiResource = {
        ...item.resource,
        ...foundResource,
      };
      return { ...item, resource };
    })
  );

  return enriched;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function comfyObjectOptions(
  pod: RunpodPodSettings,
  classType: string,
  inputName: string
) {
  if (!pod.comfyUrl) return [];

  const response = await fetch(
    `${pod.comfyUrl.replace(/\/$/, "")}/object_info/${encodeURIComponent(classType)}`,
    { cache: "no-store", signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok) return [];

  const data = (await response.json()) as Record<string, {
    input?: { required?: Record<string, unknown> };
  }>;
  const input = data[classType]?.input?.required?.[inputName];
  if (!Array.isArray(input)) return [];
  if (Array.isArray(input[0])) {
    return input[0].filter((item): item is string => typeof item === "string");
  }
  const comboOptions = input[1];
  if (
    comboOptions &&
    typeof comboOptions === "object" &&
    !Array.isArray(comboOptions) &&
    Array.isArray((comboOptions as { options?: unknown }).options)
  ) {
    return (comboOptions as { options: unknown[] }).options.filter(
      (item): item is string => typeof item === "string"
    );
  }
  return [];
}

async function requiredComfyCatalogs(params: GenerationParams) {
  const catalogs: Array<{
    label: string;
    classType: string;
    inputName: string;
  }> = [];

  if (params.model_name?.trim()) {
    catalogs.push({
      label: "checkpoint",
      classType: "CheckpointLoaderSimple",
      inputName: "ckpt_name",
    });
  }
  if ((params.loras ?? []).some((lora) => lora.path.trim())) {
    catalogs.push({
      label: "LoRA",
      classType: "LoraLoader",
      inputName: "lora_name",
    });
  }
  if (params.hires_upscale > 1 && params.upscale_model_name?.trim()) {
    catalogs.push({
      label: "upscale model",
      classType: "UpscaleModelLoader",
      inputName: "model_name",
    });
  }

  return catalogs;
}

export async function ensureRunpodComfyCatalogReady(
  pod: RunpodPodSettings,
  params: GenerationParams
) {
  const catalogs = await requiredComfyCatalogs(params);
  if (catalogs.length === 0) return;

  const emptyCatalogs = [];
  for (const catalog of catalogs) {
    const options = await comfyObjectOptions(pod, catalog.classType, catalog.inputName);
    if (options.length === 0) emptyCatalogs.push(catalog.label);
  }
  if (emptyCatalogs.length === 0) return;

  await fetchRunpodHelper(pod, "/api/runpod/helper/restart-comfy", {
    method: "POST",
    body: JSON.stringify({ reason: `empty ${emptyCatalogs.join(", ")} catalog` }),
  });

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(2_000);
    const ready = await Promise.all(
      catalogs.map(async (catalog) => {
        const options = await comfyObjectOptions(
          pod,
          catalog.classType,
          catalog.inputName
        ).catch(() => []);
        return options.length > 0;
      })
    );
    if (ready.every(Boolean)) return;
  }

  throw new Error(
    `ComfyUI model catalog is still empty after restart: ${emptyCatalogs.join(", ")}.`
  );
}

function fallbackFilename(resource: ImportedCivitaiResource) {
  const base = [resource.name, resource.versionName].filter(Boolean).join(" ") ||
    `civitai-${resource.modelVersionId}`;
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").trim();
  return /\.(ckpt|pt|pth|safetensors)$/i.test(safe) ? safe : `${safe}.safetensors`;
}

async function getRunpodDownloadPlan(
  pod: RunpodPodSettings,
  resource: ImportedCivitaiResource,
  targetPath?: string
) {
  const settings = await readSettings();
  const token = settings.civitaiApiKey || process.env.CIVITAI_API_TOKEN?.trim();

  const folder = RESOURCE_FOLDERS[resource.type];
  const baseAsset = targetPath ? runpodBaseAssetForPath(targetPath) : undefined;
  if (!folder && !baseAsset) {
    throw new Error("This resource cannot be downloaded automatically.");
  }

  if (!baseAsset && !resource.modelVersionId) {
    throw new Error("This resource cannot be downloaded automatically.");
  }

  if (!baseAsset && !token) throw new Error("Civitai API key is not configured.");

  const normalizedTargetPath = targetPath
    ?.replace(/^\/workspace\/ComfyUI\/models\//, "")
    .replace(/^\/+/, "");
  const filename = normalizedTargetPath
    ? basename(normalizedTargetPath)
    : fallbackFilename(resource);
  const targetDir = baseAsset
    ? baseAsset.path.slice(0, baseAsset.path.lastIndexOf("/"))
    : normalizedTargetPath
      ? `/workspace/ComfyUI/models/${dirname(normalizedTargetPath)}`
      : `/workspace/ComfyUI/models/${folder}`;
  const targetFile = baseAsset
    ? baseAsset.path
    : normalizedTargetPath
      ? `/workspace/ComfyUI/models/${normalizedTargetPath}`
      : `${targetDir}/${filename}`;
  const downloadUrl = baseAsset?.url ??
    `https://civitai.com/api/download/models/${resource.modelVersionId}`;
  const tokenValue = !baseAsset && token ? token : "";

  return { pod, targetDir, targetFile, downloadUrl, tokenValue };
}

export async function downloadRunpodResource(
  podId: string,
  resource: ImportedCivitaiResource,
  targetPath?: string
) {
  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  const { targetFile, downloadUrl, tokenValue } =
    await getRunpodDownloadPlan(pod, resource, targetPath);
  const data = await fetchRunpodHelper(pod, "/api/runpod/helper/download", {
    method: "POST",
    body: JSON.stringify({ targetFile, downloadUrl, token: tokenValue }),
  });
  return String(data.path || targetFile);
}

export async function streamRunpodResourceDownload(
  podId: string,
  resource: ImportedCivitaiResource,
  targetPath: string | undefined,
  onEvent: (event: {
    type: "progress" | "status" | "complete";
    path?: string;
    downloaded?: number;
    total?: number;
    percent?: number;
    message?: string;
  }) => void
) {
  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  const { targetFile, downloadUrl, tokenValue } =
    await getRunpodDownloadPlan(pod, resource, targetPath);

  const helperUrl = deriveHelperUrl(pod);
  if (!helperUrl) throw new Error("RunPod Image Gen helper URL is not configured.");

  const response = await fetch(`${helperUrl}/api/runpod/helper/download/stream`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetFile, downloadUrl, token: tokenValue }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `RunPod helper HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let helperError = "";
  let completed = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = JSON.parse(line.slice(5).trim()) as {
        type: "progress" | "status" | "complete";
        path?: string;
        downloaded?: number;
        total?: number;
        percent?: number;
        message?: string;
      };
      if (data.type === "status" && data.message && /failed|error/i.test(data.message)) {
        helperError = data.message;
      }
      if (data.type === "complete") completed = true;
      onEvent(data);
    }
  }
  if (buffer.startsWith("data:")) {
    const data = JSON.parse(buffer.slice(5).trim()) as {
      type: "progress" | "status" | "complete";
      path?: string;
      downloaded?: number;
      total?: number;
      percent?: number;
      message?: string;
    };
    if (data.type === "status" && data.message && /failed|error/i.test(data.message)) {
      helperError = data.message;
    }
    if (data.type === "complete") completed = true;
    onEvent(data);
  }
  if (helperError) throw new Error(helperError);

  const checkPath = targetPath
    ? targetPath.replace(/^\/workspace\/ComfyUI\/models\//, "")
    : targetFile.replace(/^\/workspace\/ComfyUI\/models\//, "");
  const check = await fetchRunpodHelper(pod, "/api/runpod/helper/files", {
    method: "POST",
    body: JSON.stringify({ files: [checkPath] }),
  });
  const exists = Array.isArray(check.files) &&
    check.files.some((file) =>
      Boolean(file) &&
      typeof file === "object" &&
      "path" in file &&
      "exists" in file &&
      file.path === checkPath &&
      file.exists
    );
  if (!exists) {
    throw new Error(
      completed
        ? `RunPod download finished but file was not found: ${checkPath}`
        : `RunPod download did not complete: ${checkPath}`
    );
  }

  return targetFile;
}
