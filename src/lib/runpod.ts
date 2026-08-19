import "server-only";

import { execFile, spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { basename, dirname } from "path";
import { promisify } from "util";
import type { GenerationParams, ImportedCivitaiResource } from "@/lib/types";
import { getRunpodPod, readSettings, type RunpodPodSettings } from "@/lib/settings";
import { PULID_INSIGHTFACE, PULID_NODE_REPO, PULID_WEIGHT } from "@/lib/pulid-assets";
import { parseCivitaiUrlIds } from "@/lib/civitai-url";
import {
  RESOURCE_CATALOG_FOLDERS,
  searchCivitaiResourceByFilename,
} from "@/lib/civitai-resource-search";
import {
  ANIMA_CLIP_NAME,
  ANIMA_VAE_NAME,
  KREA2_CLIP_NAME,
  KREA2_VAE_NAME,
  PORNMASTER_CLIP_NAME,
  PORNMASTER_VAE_NAME,
  ZIMAGE_CLIP_NAME,
  ZIMAGE_VAE_NAME,
  isAnimaCheckpointName,
  isDiffusionOnlyImageCheckpointName,
  isKrea2CheckpointName,
  isZImageCheckpointName,
  type CheckpointCapabilities,
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
    // Anima's external text encoder (Qwen3-0.6B base). Its VAE is qwen_image_vae,
    // the same file as KREA2_VAE_NAME above, so no separate VAE entry is needed.
    path: `/workspace/ComfyUI/models/text_encoders/${ANIMA_CLIP_NAME}`,
    url: `https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/${ANIMA_CLIP_NAME}`,
  },
  {
    // PornMaster Krea2 workflow stack (abliterated int8 Qwen3-VL + Wan 2.1 VAE).
    path: `/workspace/ComfyUI/models/text_encoders/${PORNMASTER_CLIP_NAME}`,
    url: `https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/resolve/main/${PORNMASTER_CLIP_NAME}`,
  },
  {
    path: `/workspace/ComfyUI/models/vae/${PORNMASTER_VAE_NAME}`,
    url: `https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/${PORNMASTER_VAE_NAME}`,
  },
  {
    // Z-Image's external stack: Qwen3-4B text encoder + the Flux-style 16ch VAE.
    path: `/workspace/ComfyUI/models/text_encoders/${ZIMAGE_CLIP_NAME}`,
    url: `https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/${ZIMAGE_CLIP_NAME}`,
  },
  {
    path: `/workspace/ComfyUI/models/vae/${ZIMAGE_VAE_NAME}`,
    url: `https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/${ZIMAGE_VAE_NAME}`,
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

function helperUrlFromComfyUrl(comfyUrl: string) {
  if (!comfyUrl) return "";
  return comfyUrl
    .replace(/\/$/, "")
    .replace(/-8188\.proxy\.runpod\.net/i, "-3000.proxy.runpod.net")
    .replace(/:8188\b/, ":3000");
}

function deriveHelperUrl(pod: RunpodPodSettings) {
  return helperUrlFromComfyUrl(pod.comfyUrl);
}

// Read a checkpoint's baked-in CLIP / VAE presence FROM THE POD rather than the
// local disk. In RunPod mode the checkpoint lives on the pod, so the local
// getCheckpointCapabilities can't see it (it silently returns null and the
// diffusion-only guard is skipped, leaking a cryptic ComfyUI "clip input is
// invalid: None" error). This asks the pod helper to parse the safetensors
// header. Returns null when the helper is old/unreachable or the file can't be
// inspected, so callers degrade to today's behaviour instead of blocking.
export async function getRunpodCheckpointCapabilities(
  comfyUrl: string,
  checkpointName: string
): Promise<CheckpointCapabilities | null> {
  if (!checkpointName.endsWith(".safetensors")) return null;
  const helperUrl = helperUrlFromComfyUrl(comfyUrl);
  if (!helperUrl) return null;

  try {
    const response = await fetch(`${helperUrl}/api/runpod/helper/model-capabilities`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: `checkpoints/${checkpointName}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      capabilities?: { clip?: unknown; vae?: unknown } | null;
    };
    const caps = data.capabilities;
    if (!caps || typeof caps !== "object") return null;
    return { clip: Boolean(caps.clip), vae: Boolean(caps.vae) };
  } catch {
    return null;
  }
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

// Thin POST wrapper around the pod helper for callers outside this module (the
// share sync). Kept separate from fetchRunpodHelper because share payloads carry
// base64 image bytes and so need a much longer timeout than a metadata call.
export async function postRunpodHelper(
  pod: RunpodPodSettings,
  path: string,
  body: unknown,
  timeoutMs = 180_000
) {
  const helperUrl = deriveHelperUrl(pod);
  if (!helperUrl) {
    throw new Error("RunPod Image Gen helper URL is not configured.");
  }

  const response = await fetch(`${helperUrl}${path}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`RunPod helper returned a non-JSON response (HTTP ${response.status}).`);
  }
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

async function fetchRunpodPodSummary(podId: string) {
  const settings = await readSettings();
  if (!settings.runpodApiKey) return null;

  const response = await fetch(
    `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}`,
    {
      headers: { Authorization: `Bearer ${settings.runpodApiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    }
  );
  const text = await response.text();
  if (!response.ok) {
    return { error: `RunPod API HTTP ${response.status} ${text}` };
  }

  const data = JSON.parse(text) as {
    desiredStatus?: string;
    machine?: { podHostId?: string };
    runtime?: {
      ports?: Array<{
        ip?: string;
        isIpPublic?: boolean;
        privatePort?: number;
        publicPort?: number;
        type?: string;
      }>;
    };
    ports?: string[];
  };

  return {
    desiredStatus: data.desiredStatus ?? "",
    podHostId: data.machine?.podHostId ?? "",
    configuredPorts: Array.isArray(data.ports) ? data.ports : [],
    runtimePorts: Array.isArray(data.runtime?.ports) ? data.runtime.ports : [],
  };
}

// Lightweight bulk lookup: query RunPod's REST list endpoint ONCE and return a
// map of podId -> desiredStatus. Used to auto-select a running pod and to flag
// running pods in the target dropdown without probing every ComfyUI/helper port.
export async function fetchRunpodDesiredStatusMap(): Promise<Record<string, string>> {
  const settings = await readSettings();
  if (!settings.runpodApiKey) return {};

  const response = await fetch("https://rest.runpod.io/v1/pods", {
    headers: { Authorization: `Bearer ${settings.runpodApiKey}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`RunPod API HTTP ${response.status} ${text}`);
  }

  const parsed = JSON.parse(text) as unknown;
  // The REST list endpoint has returned both a bare array and a { pods: [...] }
  // envelope across API versions; accept either.
  const pods = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { pods?: unknown }).pods)
      ? (parsed as { pods: unknown[] }).pods
      : [];

  const map: Record<string, string> = {};
  for (const entry of pods) {
    if (!entry || typeof entry !== "object") continue;
    const id = String((entry as { id?: unknown }).id ?? "");
    if (!id) continue;
    map[id] = String((entry as { desiredStatus?: unknown }).desiredStatus ?? "");
  }
  return map;
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
  // Prefer a direct TCP endpoint (22/tcp exposed) when RunPod offers one — it is
  // faster and supports the full SSH feature set. Many templates only expose the
  // ssh.runpod.io proxy though; a lookup failure must NOT block setup.
  const endpoint = await fetchRunpodSshEndpoint(pod).catch(() => null);
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
  }
  // Otherwise fall back to the pasted command as-is (the ssh.runpod.io proxy).
  // RunPod's SSH proxy supports remote command execution — only SCP/SFTP is
  // unsupported — which is exactly how runpod-video runs its remote commands.

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
    return "RunPod SSH endpoint is not accepting connections yet. Wait for the pod runtime port to finish attaching, then retry Helper 초기화.";
  }
  if (/Operation timed out|Connection timed out/i.test(message)) {
    return "RunPod SSH endpoint timed out. Check that the pod is running and its 22/tcp port is exposed, then retry Helper 초기화.";
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
  const podSummary = pod.podId ? await fetchRunpodPodSummary(pod.podId) : null;
  const desiredStatus =
    podSummary && "desiredStatus" in podSummary ? podSummary.desiredStatus ?? "" : "";
  // RunPod REST API reports the pod is up (like runpod-video's desiredStatus check).
  // While it is RUNNING, unreachable ComfyUI/helper endpoints mean "still booting",
  // not a hard failure — the proxy answers before the service binds its port.
  const podRunning = desiredStatus.toUpperCase() === "RUNNING";

  const comfyUrl = pod.comfyUrl.replace(/\/$/, "");
  let comfyReachable = false;
  let comfyInitializing = false;
  let comfyError = "";
  let comfyVersion = "";

  if (comfyUrl) {
    try {
      const response = await fetch(`${comfyUrl}/system_stats`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      comfyReachable = response.ok;
      if (response.ok) {
        // /system_stats reports system.comfyui_version — surface it so the UI can
        // show the running version and flag models that need a newer build.
        try {
          const stats = (await response.json()) as {
            system?: { comfyui_version?: unknown };
          };
          if (typeof stats?.system?.comfyui_version === "string") {
            comfyVersion = stats.system.comfyui_version;
          }
        } catch {
          // Non-JSON body (proxy loading page): leave version unknown.
        }
      } else {
        comfyError = `ComfyUI HTTP ${response.status}`;
        // 502/503/504 from the RunPod proxy = proxy is up, ComfyUI not ready yet.
        if ([502, 503, 504].includes(response.status)) comfyInitializing = true;
      }
    } catch (error) {
      comfyError = error instanceof Error ? error.message : "ComfyUI is not reachable.";
      if (podRunning) comfyInitializing = true;
    }
  }
  if (!comfyReachable && podRunning) comfyInitializing = true;

  let helperReachable = false;
  let helperInitializing = false;
  let helperError = "";
  let helperOutdated = false;
  try {
    const helper = await fetchRunpodHelper(pod, "/api/runpod/helper/status", {
      signal: AbortSignal.timeout(5_000),
    });
    helperReachable = Boolean(helper.ok);
    // Old helpers report no version; treat any mismatch as outdated so the user
    // is prompted to redeploy (which enables newer features like the shared
    // model catalog).
    const helperVersion =
      typeof helper.version === "string" ? helper.version : "";
    helperOutdated = helperReachable && helperVersion !== RUNPOD_HELPER_VERSION;
  } catch (error) {
    const message = error instanceof Error ? error.message : "RunPod helper is not reachable.";
    if (message.includes("Unexpected token") || message.includes("<!DOCTYPE")) {
      // Proxy returns RunPod's HTML loading page until the helper starts serving JSON.
      helperError = "RunPod helper HTTP endpoint is not serving helper JSON yet.";
      helperInitializing = true;
    } else if (/HTTP 50[234]\b/.test(message)) {
      helperError = message;
      helperInitializing = true;
    } else {
      helperError = message;
      if (podRunning) helperInitializing = true;
    }
  }

  return {
    comfyReachable,
    comfyInitializing: comfyInitializing && !comfyReachable,
    comfyError,
    comfyVersion,
    helperReachable,
    helperInitializing: helperInitializing && !helperReachable,
    helperError,
    helperOutdated,
    podDesiredStatus: desiredStatus,
    podHostId: podSummary && "podHostId" in podSummary ? podSummary.podHostId : "",
    configuredPorts:
      podSummary && "configuredPorts" in podSummary ? podSummary.configuredPorts : [],
    runtimePorts: podSummary && "runtimePorts" in podSummary ? podSummary.runtimePorts : [],
    runpodApiError: podSummary && "error" in podSummary ? podSummary.error : "",
  };
}

export async function ensureRunpodStatus(pod: RunpodPodSettings) {
  let status = await fetchRunpodStatus(pod);
  let startRequested = false;
  let portExposeRequested = false;
  let portExposeError = "";
  let startError = "";
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
    try {
      await startRunpodPod(pod.podId);
      startRequested = true;
    } catch (error) {
      startError = error instanceof Error ? error.message : "RunPod start failed.";
    }
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

  return {
    ...status,
    startRequested,
    startError,
    portExposeRequested,
    portExposeError,
    setupRequested,
    setupError,
  };
}

// The RunPod Image Gen helper — a stdlib Python http.server that serves the
// /api/runpod/helper/* endpoints on port 3000 and downloads model files into the
// pod's ComfyUI models dir. Shipped to the pod either over SSH (setupRunpodPod)
// or, when the pod has no sshd, over the Jupyter kernel websocket
// (deployRunpodHelperViaJupyter) — matching runpod-video.
// Must equal HELPER_VERSION inside HELPER_SERVER_SOURCE. Bump both together when
// the helper source changes so a pod running an older build is flagged as stale
// (helperOutdated) and the user is offered a redeploy.
export const RUNPOD_HELPER_VERSION = "6";

const HELPER_SERVER_SOURCE = String.raw`
import base64
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Bumped whenever this helper source changes so the app can tell a running pod is
# on an old build and offer to redeploy. Must equal RUNPOD_HELPER_VERSION below.
HELPER_VERSION = "6"

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

# The pod's shared model metadata catalog. It lives on the persistent models
# volume so a model one user downloads carries its name/thumbnail for everyone
# else who lists models against this pod.
CATALOG_FILE = MODELS_DIR / ".image-gen-catalog.json"

def read_catalog():
    try:
        with open(CATALOG_FILE, "r", encoding="utf-8") as handle:
            data = json.loads(handle.read() or "{}")
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}

def merge_catalog(entries):
    catalog = read_catalog()
    if isinstance(entries, dict):
        for key, value in entries.items():
            if not key or not isinstance(value, dict) or not value.get("name"):
                continue
            existing = catalog.get(key)
            catalog[key] = {**existing, **value} if isinstance(existing, dict) else value
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    tmp = Path(str(CATALOG_FILE) + ".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(catalog, indent=2))
    tmp.replace(CATALOG_FILE)
    return catalog

# ---- Shared workspaces / characters ----------------------------------------
# Sharing pushes a workspace (or a character) plus its images onto the pod so
# every user of that pod can download it. Like the catalog above it lives on the
# persistent models volume, so a pod restart doesn't lose what people shared.
SHARE_DIR = MODELS_DIR / ".image-gen-share"
SHARE_KINDS = ("workspaces", "characters")
SHARE_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")
SHARE_FILE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}")

def share_dir(kind, share_id):
    if kind not in SHARE_KINDS:
        raise ValueError("Invalid share kind.")
    ident = str(share_id or "").strip()
    if not SHARE_ID_RE.fullmatch(ident):
        raise ValueError("Invalid share id.")
    return SHARE_DIR / kind / ident

def share_file(kind, share_id, filename):
    name = str(filename or "").strip()
    if not SHARE_FILE_RE.fullmatch(name) or ".." in name:
        raise ValueError("Invalid share filename.")
    return share_dir(kind, share_id) / "files" / name

def read_share_manifest(kind, share_id):
    try:
        with open(share_dir(kind, share_id) / "manifest.json", "r", encoding="utf-8") as handle:
            data = json.loads(handle.read() or "{}")
        return data if isinstance(data, dict) else None
    except Exception:
        return None

# Listing is deliberately manifest-only (no file bytes) so the download picker
# stays responsive no matter how many images a share holds.
def list_shares(kind):
    if kind not in SHARE_KINDS:
        return []
    root = SHARE_DIR / kind
    if not root.is_dir():
        return []
    items = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        manifest = read_share_manifest(kind, entry.name)
        if manifest:
            items.append(manifest)
    return items

# Writes the manifest and returns the referenced files that aren't on the pod
# yet, so the uploader only sends what's actually missing (re-syncing a share
# after a name change or a single new image costs one request plus that image).
# Files the new manifest no longer lists are deleted: removing an image from a
# shared workspace has to remove it from the share too.
def write_share_manifest(kind, share_id, manifest):
    target = share_dir(kind, share_id)
    files_dir = target / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    wanted = set()
    listed = manifest.get("files")
    for name in listed if isinstance(listed, list) else []:
        try:
            wanted.add(share_file(kind, share_id, name).name)
        except Exception:
            continue

    tmp = Path(str(target / "manifest.json") + ".tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(manifest, indent=2))
    tmp.replace(target / "manifest.json")

    for existing in files_dir.iterdir():
        if existing.is_file() and existing.name not in wanted:
            try:
                existing.unlink()
            except Exception:
                pass
    return [name for name in sorted(wanted) if not (files_dir / name).is_file()]

def delete_share(kind, share_id):
    target = share_dir(kind, share_id)
    if not target.is_dir():
        return False
    shutil.rmtree(target, ignore_errors=True)
    return True

MODEL_EXTS = (".safetensors", ".ckpt", ".pt", ".pth")

# Physically enumerate every model file under a models subfolder (recursively),
# returning folder-relative POSIX paths. This is the source of truth for "what is
# actually on the pod", independent of ComfyUI's /object_info (which can be stale
# until a restart) or the download-time catalog (which only knows app downloads).
def list_model_files(folder):
    root = MODELS_DIR / folder
    if not root.is_dir():
        return []
    result = []
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in MODEL_EXTS:
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith("put_") or path.name.startswith("."):
            continue
        result.append(rel)
    return result

def write_json(handler, status, data):
    body = json.dumps(data).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def safetensors_header_keys(target):
    try:
        with open(target, "rb") as handle:
            size_bytes = handle.read(8)
            if len(size_bytes) < 8:
                return None
            header_size = int.from_bytes(size_bytes, "little")
            if header_size <= 0 or header_size > 64 * 1024 * 1024:
                return None
            header_bytes = handle.read(header_size)
            if len(header_bytes) < header_size:
                return None
            header = json.loads(header_bytes.decode("utf-8"))
            if not isinstance(header, dict):
                return None
            return [key for key in header.keys() if key != "__metadata__"]
    except Exception:
        return None

def checkpoint_capabilities(target):
    if not target.is_file() or not str(target).endswith(".safetensors"):
        return None
    keys = safetensors_header_keys(target)
    if keys is None:
        return None
    clip = any(
        key.startswith("conditioner.embedders.")
        or key.startswith("cond_stage_model.")
        or key.startswith("clip_l.")
        or key.startswith("clip_g.")
        or ("text_model" in key)
        for key in keys
    )
    vae = any(
        key.startswith("first_stage_model.") or key.startswith("vae.")
        for key in keys
    )
    return {"clip": clip, "vae": vae}

def port_in_use(port):
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(0.5)
    try:
        return sock.connect_ex(("127.0.0.1", int(port))) == 0
    finally:
        sock.close()

def pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except Exception:
        return False

# Find the PID(s) of the running ComfyUI server. Matches a process running
# main.py that is either bound to our port (in argv) or whose cwd is the ComfyUI
# dir — robust to how it was launched (relative "main.py", supervisor, etc.).
def comfyui_pids():
    pids = []
    proc = Path("/proc")
    if not proc.exists():
        return pids
    comfy_dir = str(COMFYUI_DIR)
    self_pid = os.getpid()
    for item in proc.iterdir():
        if not item.name.isdigit():
            continue
        pid = int(item.name)
        if pid == self_pid:
            continue
        try:
            cmdline = (item / "cmdline").read_bytes().decode("utf-8", "ignore")
        except Exception:
            continue
        if "main.py" not in cmdline:
            continue
        matched = "--port" in cmdline and str(COMFYUI_PORT) in cmdline
        if not matched:
            try:
                cwd = os.readlink(str(item / "cwd"))
                matched = cwd == comfy_dir or cwd.startswith(comfy_dir + "/")
            except Exception:
                matched = False
        if matched:
            pids.append(pid)
    return pids

# Query the version the ComfyUI on our port is actually serving (from memory), as
# opposed to what is on disk. "" when unreachable.
def serving_comfy_version():
    try:
        with urllib.request.urlopen(
            "http://127.0.0.1:%d/system_stats" % COMFYUI_PORT, timeout=5
        ) as response:
            data = json.loads(response.read().decode("utf-8", "ignore"))
        return str(data.get("system", {}).get("comfyui_version", ""))
    except Exception:
        return ""

def stop_comfyui():
    pids = comfyui_pids()
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
    # Best-effort belt-and-braces: kill by port and by argv pattern too.
    os.system("fuser -k %d/tcp >/dev/null 2>&1 || true" % COMFYUI_PORT)
    os.system("pkill -f 'main.py.*--port %d' >/dev/null 2>&1 || true" % COMFYUI_PORT)
    # Wait for the port to free; escalate to SIGKILL if anything lingers.
    for _ in range(30):
        if not port_in_use(COMFYUI_PORT) and not any(pid_alive(p) for p in pids):
            return
        time.sleep(0.5)
    for pid in comfyui_pids():
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass
    for _ in range(20):
        if not port_in_use(COMFYUI_PORT):
            return
        time.sleep(0.5)

def restart_comfyui():
    main_py = COMFYUI_DIR / "main.py"
    if not main_py.is_file():
        raise RuntimeError("ComfyUI main.py was not found: " + str(main_py))

    python_cmd = comfy_python()
    if not python_cmd:
        raise RuntimeError("python3 was not found.")

    stop_comfyui()

    # A process manager may respawn ComfyUI from the (now-updated) dir on its own.
    # If the port is re-bound within a moment, don't double-launch — that instance
    # already runs the new code. Otherwise launch it ourselves.
    time.sleep(1)
    if port_in_use(COMFYUI_PORT):
        return None

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

def comfy_python():
    venv = COMFYUI_DIR / "venv/bin/python"
    if venv.exists():
        return str(venv)
    return shutil.which("python3") or shutil.which("python") or sys.executable

def stream_cmd(args, cwd, on_line, timeout=2400):
    proc = subprocess.Popen(
        args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode("utf-8", "ignore").rstrip()
        if line:
            on_line(line)
    proc.stdout.close()
    proc.wait(timeout=timeout)
    return proc.returncode

# Install a list of {name, url} custom-node git repos into ComfyUI/custom_nodes,
# running each repo's requirements.txt through the ComfyUI python. Emits progress
# events so the caller's SSE stream stays alive during long pip installs.
def install_node_repos(repos, on_event):
    custom_nodes = COMFYUI_DIR / "custom_nodes"
    custom_nodes.mkdir(parents=True, exist_ok=True)
    git = shutil.which("git")
    if not git:
        raise RuntimeError("git is not available on this pod.")
    py = comfy_python()
    installed = []
    for repo in repos:
        name = str(repo.get("name") or "").strip()
        url = str(repo.get("url") or "").strip()
        if not name or not url or not url.startswith("https://"):
            on_event({"type": "repo", "name": name, "status": "skipped",
                      "message": "invalid repo"})
            continue
        safe = name.replace("/", "_").replace("\\", "_").replace("..", "_")
        target = custom_nodes / safe
        emit = lambda line, _n=name: on_event({"type": "log", "name": _n, "message": line})
        try:
            if (target / ".git").exists():
                on_event({"type": "repo", "name": name, "status": "updating"})
                code = stream_cmd([git, "-C", str(target), "pull", "--ff-only"],
                                  str(custom_nodes), emit)
            elif target.exists():
                on_event({"type": "repo", "name": name, "status": "exists"})
                code = 0
            else:
                on_event({"type": "repo", "name": name, "status": "cloning"})
                code = stream_cmd([git, "clone", "--depth", "1", url, str(target)],
                                  str(custom_nodes), emit)
            if code != 0:
                on_event({"type": "repo", "name": name, "status": "error",
                          "message": "git exited with code %s" % code})
                continue
            req = target / "requirements.txt"
            if req.is_file():
                on_event({"type": "repo", "name": name, "status": "pip"})
                pcode = stream_cmd([py, "-m", "pip", "install", "-r", str(req)],
                                   str(target), emit)
                if pcode != 0:
                    on_event({"type": "repo", "name": name, "status": "pip-error",
                              "message": "pip exited with code %s" % pcode})
                    continue
            installed.append(name)
            on_event({"type": "repo", "name": name, "status": "done"})
        except Exception as error:
            on_event({"type": "repo", "name": name, "status": "error",
                      "message": str(error)})
    return installed

def comfyui_info():
    version = ""
    try:
        text = (COMFYUI_DIR / "comfyui_version.py").read_text(encoding="utf-8")
        import re as _re
        match = _re.search(r"__version__\s*=\s*['\"]([^'\"]+)['\"]", text)
        if match:
            version = match.group(1)
    except Exception:
        version = ""
    commit = ""
    git = shutil.which("git")
    if git and (COMFYUI_DIR / ".git").exists():
        try:
            commit = subprocess.check_output(
                [git, "-C", str(COMFYUI_DIR), "rev-parse", "--short", "HEAD"],
                stderr=subprocess.DEVNULL,
            ).decode("utf-8", "ignore").strip()
        except Exception:
            commit = ""
    is_git = bool(git and (COMFYUI_DIR / ".git").exists())
    return {"version": version, "commit": commit, "dir": str(COMFYUI_DIR), "git": is_git}

# Update the ComfyUI checkout to a pinned git ref, reinstall its requirements, and
# restart the server. Streams progress so the caller's SSE stays alive through the
# (multi-minute) pip step. int8 models need >= 0.27.0; the app pins the target ref.
def upgrade_comfyui(ref, on_event):
    git = shutil.which("git")
    if not git:
        raise RuntimeError("git is not available on this pod.")
    if not (COMFYUI_DIR / ".git").exists():
        raise RuntimeError(
            "ComfyUI at %s is not a git checkout, so it cannot be updated automatically. "
            "Reinstall ComfyUI from git or update it manually." % str(COMFYUI_DIR))
    ref = str(ref or "").strip()
    if not ref:
        raise RuntimeError("No target ComfyUI ref was provided.")
    emit = lambda line: on_event({"type": "log", "message": line})

    on_event({"type": "status", "message": "fetching ComfyUI %s" % ref})
    # Fetch the specific ref when possible (works for a commit SHA or a tag);
    # fall back to a full fetch so branch names and shallow clones still resolve.
    if stream_cmd([git, "-C", str(COMFYUI_DIR), "fetch", "--tags", "origin", ref],
                  str(COMFYUI_DIR), emit) != 0:
        stream_cmd([git, "-C", str(COMFYUI_DIR), "fetch", "--tags", "--all"],
                   str(COMFYUI_DIR), emit)

    on_event({"type": "status", "message": "checking out %s" % ref})
    if stream_cmd([git, "-C", str(COMFYUI_DIR), "checkout", "-f", ref],
                  str(COMFYUI_DIR), emit) != 0:
        raise RuntimeError("git checkout %s failed." % ref)

    py = comfy_python()
    on_event({"type": "status", "message": "installing requirements (pip, may take minutes)"})
    req = COMFYUI_DIR / "requirements.txt"
    if req.is_file():
        if stream_cmd([py, "-m", "pip", "install", "-r", str(req)],
                      str(COMFYUI_DIR), emit) != 0:
            raise RuntimeError("pip install of ComfyUI requirements failed.")

    on_disk = comfyui_info().get("version", "")
    on_event({"type": "status", "message": "restarting ComfyUI"})
    pid = restart_comfyui()

    # Verify the server actually came back on the new version — a checkout is
    # worthless if the old process kept the port. Poll until it serves the
    # on-disk version (or times out) and report whatever it truly serves.
    on_event({"type": "status", "message": "waiting for ComfyUI to come back"})
    served = ""
    for _ in range(120):
        served = serving_comfy_version()
        if served and (not on_disk or served == on_disk):
            break
        time.sleep(1)
    return {"pid": pid, "servedVersion": served, "diskVersion": on_disk}

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
                "version": HELPER_VERSION,
            })
            return
        if self.path == "/api/runpod/helper/catalog":
            write_json(self, 200, {"catalog": read_catalog()})
            return
        if self.path == "/api/runpod/helper/models":
            write_json(self, 200, {
                "checkpoints": list_model_files("checkpoints"),
                "loras": list_model_files("loras"),
                "diffusion_models": list_model_files("diffusion_models"),
                "embeddings": list_model_files("embeddings"),
            })
            return
        if self.path == "/api/runpod/helper/comfyui/info":
            write_json(self, 200, comfyui_info())
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
            if self.path == "/api/runpod/helper/model-capabilities":
                body = read_json(self)
                target = model_path(body.get("file", ""))
                exists = target.is_file()
                write_json(self, 200, {
                    "exists": exists,
                    "size": target.stat().st_size if exists else 0,
                    "capabilities": checkpoint_capabilities(target) if exists else None,
                })
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
            if self.path == "/api/runpod/helper/install-nodes/stream":
                body = read_json(self)
                repos = body.get("repos") if isinstance(body.get("repos"), list) else []
                restart = bool(body.get("restart", True))
                self.send_response(200)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                def send(event):
                    self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                try:
                    send({"type": "status", "message": "installing", "total": len(repos)})
                    installed = install_node_repos(repos, send)
                    pid = restart_comfyui() if (restart and installed) else None
                    send({"type": "complete", "installed": installed,
                          "restarted": bool(restart and installed), "pid": pid})
                except Exception as error:
                    send({"type": "error", "message": str(error)})
                return
            if self.path == "/api/runpod/helper/comfyui/upgrade/stream":
                body = read_json(self)
                ref = str(body.get("ref", "")).strip()
                self.send_response(200)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                def send(event):
                    self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode("utf-8"))
                    self.wfile.flush()
                try:
                    before = serving_comfy_version()
                    result = upgrade_comfyui(ref, send)
                    served = result.get("servedVersion", "")
                    disk = result.get("diskVersion", "")
                    # A checkout that doesn't take over the port is a failed upgrade;
                    # tell the truth so the UI never shows a false "done".
                    if disk and served and served != disk:
                        send({"type": "error",
                              "message": ("Updated files to %s but ComfyUI still serves %s "
                                          "(the old process kept port %d). Restart the pod, "
                                          "or stop ComfyUI and retry." )
                                         % (disk, served, COMFYUI_PORT)})
                    elif disk and not served:
                        send({"type": "error",
                              "message": ("Updated files to %s but ComfyUI did not come back "
                                          "on port %d. Check the pod." ) % (disk, COMFYUI_PORT)})
                    else:
                        send({"type": "complete", "restarted": True,
                              "pid": result.get("pid"),
                              "previousVersion": before, "version": served or disk})
                except Exception as error:
                    send({"type": "error", "message": str(error)})
                return
            if self.path == "/api/runpod/helper/restart-comfy":
                pid = restart_comfyui()
                write_json(self, 200, {"ok": True, "pid": pid})
                return
            if self.path == "/api/runpod/helper/catalog":
                body = read_json(self)
                entries = body.get("entries") if isinstance(body.get("entries"), dict) else {}
                write_json(self, 200, {"ok": True, "catalog": merge_catalog(entries)})
                return
            # Share endpoints are POST-only (including the reads) so the hand-rolled
            # router never has to parse query strings, and file bytes travel as
            # base64 in the same JSON envelope every other endpoint uses.
            if self.path == "/api/runpod/helper/share/list":
                body = read_json(self)
                write_json(self, 200, {"items": list_shares(str(body.get("kind", "")))})
                return
            if self.path == "/api/runpod/helper/share/get":
                body = read_json(self)
                manifest = read_share_manifest(str(body.get("kind", "")), body.get("id"))
                if manifest is None:
                    write_json(self, 404, {"error": "Share not found."})
                    return
                write_json(self, 200, {"manifest": manifest})
                return
            if self.path == "/api/runpod/helper/share/manifest":
                body = read_json(self)
                manifest = body.get("manifest")
                if not isinstance(manifest, dict):
                    raise ValueError("A share manifest is required.")
                missing = write_share_manifest(
                    str(body.get("kind", "")), body.get("id"), manifest
                )
                write_json(self, 200, {"ok": True, "missing": missing})
                return
            if self.path == "/api/runpod/helper/share/put":
                body = read_json(self)
                target = share_file(
                    str(body.get("kind", "")), body.get("id"), body.get("filename")
                )
                target.parent.mkdir(parents=True, exist_ok=True)
                raw = base64.b64decode(str(body.get("data", "")))
                tmp = Path(str(target) + ".part")
                with open(tmp, "wb") as handle:
                    handle.write(raw)
                tmp.replace(target)
                write_json(self, 200, {"ok": True, "size": len(raw)})
                return
            if self.path == "/api/runpod/helper/share/file":
                body = read_json(self)
                target = share_file(
                    str(body.get("kind", "")), body.get("id"), body.get("filename")
                )
                if not target.is_file():
                    write_json(self, 404, {"error": "Shared file not found."})
                    return
                with open(target, "rb") as handle:
                    payload = base64.b64encode(handle.read()).decode("ascii")
                write_json(self, 200, {"data": payload})
                return
            if self.path == "/api/runpod/helper/share/delete":
                body = read_json(self)
                write_json(self, 200, {
                    "ok": delete_share(str(body.get("kind", "")), body.get("id")),
                })
                return
            write_json(self, 404, {"error": "Not found."})
        except Exception as error:
            write_json(self, 400, {"error": str(error)})

ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
`.trim();

const HELPER_SERVER_BASE64 = Buffer.from(HELPER_SERVER_SOURCE, "utf8").toString("base64");

export async function setupRunpodPod(pod: RunpodPodSettings) {
  const helperServerBase64 = HELPER_SERVER_BASE64;

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

// ── Jupyter-based helper deploy ─────────────────────────────────────────────
// Many RunPod ComfyUI templates (e.g. antilopax/ltx23) expose Jupyter on 8888
// but do NOT run an sshd, so the SSH install path fails with "connection
// refused". runpod-video works around this by shipping its agent over the
// Jupyter kernel websocket. We do the same here: write the helper file and
// launch it on port 3000 by executing Python in a throwaway Jupyter kernel.

function deriveJupyterUrl(pod: RunpodPodSettings) {
  if (!pod.comfyUrl) return "";
  return pod.comfyUrl
    .replace(/\/$/, "")
    .replace(/-8188\.proxy\.runpod\.net/i, "-8888.proxy.runpod.net")
    .replace(/:8188\b/, ":8888");
}

async function fetchRunpodPodEnv(podId: string): Promise<Record<string, string>> {
  const settings = await readSettings();
  if (!settings.runpodApiKey) return {};
  try {
    const response = await fetch(
      `https://rest.runpod.io/v1/pods/${encodeURIComponent(podId)}`,
      {
        headers: { Authorization: `Bearer ${settings.runpodApiKey}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }
    );
    if (!response.ok) return {};
    const data = JSON.parse(await response.text()) as { env?: unknown };
    if (data.env && typeof data.env === "object") {
      return data.env as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function cookieJarFrom(response: Response) {
  const jar: Record<string, string> = {};
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
  for (const cookie of cookies) {
    const first = cookie.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar[first.slice(0, eq).trim()] = first.slice(eq + 1).trim();
  }
  return jar;
}

// Execute one block of Python in a Jupyter kernel over the channels websocket and
// return the accumulated stdout. Waits for the kernel to be ready before sending.
function runJupyterKernelCode(
  jupyterUrl: string,
  kernelId: string,
  password: string,
  cookieHeader: string,
  code: string,
  timeoutMs = 90_000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsBase = jupyterUrl.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    const sessionId = randomUUID();
    const wsUrl = `${wsBase}/api/kernels/${encodeURIComponent(kernelId)}/channels?session_id=${sessionId}&token=${encodeURIComponent(password)}`;

    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl, {
        headers: { Cookie: cookieHeader },
      } as unknown as string[]);
    } catch {
      socket = new WebSocket(wsUrl);
    }

    const output: string[] = [];
    const msgId = randomUUID();
    let sent = false;
    let settled = false;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(
      () => finish(new Error("Jupyter execution timed out.")),
      timeoutMs
    );

    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (readyTimer) clearTimeout(readyTimer);
      try {
        socket.close();
      } catch {
        // ignore
      }
      if (error) reject(error);
      else resolve(value ?? output.join(""));
    };

    const sendExecute = () => {
      if (sent || settled) return;
      sent = true;
      socket.send(
        JSON.stringify({
          header: {
            msg_id: msgId,
            username: "image-gen",
            session: sessionId,
            msg_type: "execute_request",
            version: "5.3",
            date: new Date().toISOString(),
          },
          parent_header: {},
          metadata: {},
          content: {
            code,
            silent: false,
            store_history: false,
            user_expressions: {},
            allow_stdin: false,
            stop_on_error: true,
          },
          channel: "shell",
          buffers: [],
        })
      );
    };

    socket.onopen = () => {
      // The kernel may still be "starting"; a fallback timer sends the request
      // even if we never observe a clean idle status first.
      readyTimer = setTimeout(sendExecute, 3_000);
    };
    socket.onerror = (event: Event) => {
      const message =
        (event as unknown as { message?: string }).message ||
        (event as unknown as { type?: string }).type ||
        "unknown";
      finish(new Error(`Jupyter websocket error: ${message}`));
    };
    socket.onmessage = (event: MessageEvent) => {
      let text = "";
      if (typeof event.data === "string") text = event.data;
      else if (event.data instanceof ArrayBuffer)
        text = Buffer.from(event.data).toString("utf8");
      if (!text) return;

      let message: {
        header?: { msg_type?: string };
        parent_header?: { msg_id?: string };
        content?: {
          execution_state?: string;
          text?: string;
          ename?: string;
          evalue?: string;
          status?: string;
        };
      };
      try {
        message = JSON.parse(text);
      } catch {
        return;
      }

      const type = message.header?.msg_type;
      const parentId = message.parent_header?.msg_id;

      // Kernel signalled ready (idle) before we sent — send now.
      if (type === "status" && message.content?.execution_state === "idle") {
        if (!sent) {
          if (readyTimer) clearTimeout(readyTimer);
          sendExecute();
          return;
        }
        if (parentId === msgId) {
          finish(undefined, output.join(""));
          return;
        }
      }

      if (parentId && parentId !== msgId) return;
      if (type === "stream") output.push(String(message.content?.text || ""));
      if (type === "error") {
        output.push(
          "ERROR: " +
            [message.content?.ename, message.content?.evalue]
              .filter(Boolean)
              .join(": ")
        );
      }
    };
  });
}

export async function deployRunpodHelperViaJupyter(pod: RunpodPodSettings) {
  const jupyterUrl = deriveJupyterUrl(pod);
  if (!jupyterUrl) {
    throw new Error("RunPod ComfyUI URL is required to derive the Jupyter endpoint.");
  }
  if (!pod.podId) {
    throw new Error("RunPod pod ID is required for the Jupyter helper deploy.");
  }

  const env = await fetchRunpodPodEnv(pod.podId);
  const password = env.JUPYTER_PASSWORD || "";
  if (!password) {
    throw new Error(
      "This pod does not expose a JUPYTER_PASSWORD, so the helper cannot be installed via Jupyter."
    );
  }

  const tokenQuery = `token=${encodeURIComponent(password)}`;

  // 1) Load a Jupyter page to obtain the _xsrf token + auth cookies.
  const labResponse = await fetch(`${jupyterUrl}/lab?${tokenQuery}`, {
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const jar = cookieJarFrom(labResponse);
  const xsrf = jar["_xsrf"] || "";
  const cookieHeader = Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
  if (!xsrf) {
    throw new Error(
      "Failed to obtain a Jupyter XSRF token (is the pod's JUPYTER_PASSWORD correct?)."
    );
  }

  // 2) Create a throwaway python3 kernel.
  const kernelResponse = await fetch(`${jupyterUrl}/api/kernels?${tokenQuery}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-XSRFToken": xsrf,
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ name: "python3" }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const kernelText = await kernelResponse.text();
  if (!kernelResponse.ok) {
    throw new Error(
      `Jupyter kernel creation failed: HTTP ${kernelResponse.status} ${kernelText}`
    );
  }
  const kernelId = (JSON.parse(kernelText) as { id?: string }).id || "";
  if (!kernelId) {
    throw new Error("Jupyter did not return a kernel id.");
  }

  // 3) Write + launch the helper on port 3000 by executing Python in the kernel.
  const launchCode = [
    "import base64, os, socket, subprocess, time",
    "os.makedirs('/workspace/image-gen-helper', exist_ok=True)",
    "try:",
    "    pid_file = '/workspace/image-gen-helper/helper.pid'",
    "    if os.path.exists(pid_file):",
    "        old = open(pid_file).read().strip()",
    "        if old:",
    "            subprocess.run(['kill', old], capture_output=True)",
    "except Exception:",
    "    pass",
    "try:",
    "    subprocess.run(['fuser', '-k', '3000/tcp'], capture_output=True)",
    "except Exception:",
    "    pass",
    "time.sleep(1)",
    `src = base64.b64decode('${HELPER_SERVER_BASE64}')`,
    "open('/workspace/image-gen-helper/server.py', 'wb').write(src)",
    "log = open('/workspace/image-gen-helper.log', 'ab')",
    "proc = subprocess.Popen(['python3', '-u', '/workspace/image-gen-helper/server.py'], stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, start_new_session=True)",
    "open('/workspace/image-gen-helper/helper.pid', 'w').write(str(proc.pid))",
    "def _up(port):",
    "    with socket.socket() as s:",
    "        s.settimeout(1)",
    "        return s.connect_ex(('127.0.0.1', port)) == 0",
    "ok = False",
    "for _ in range(15):",
    "    time.sleep(1)",
    "    if _up(3000):",
    "        ok = True",
    "        break",
    "print('HELPER_OK' if ok else 'HELPER_FAIL')",
  ].join("\n");

  try {
    const stdout = await runJupyterKernelCode(
      jupyterUrl,
      kernelId,
      password,
      cookieHeader,
      launchCode
    );
    if (!stdout.includes("HELPER_OK")) {
      throw new Error(
        `Helper did not come up on port 3000 via Jupyter. Kernel output: ${stdout.trim().slice(0, 600) || "(no output)"}`
      );
    }
    return { stdout, stderr: "" };
  } finally {
    await fetch(
      `${jupyterUrl}/api/kernels/${encodeURIComponent(kernelId)}?${tokenQuery}`,
      {
        method: "DELETE",
        headers: { "X-XSRFToken": xsrf, Cookie: cookieHeader },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }
    ).catch(() => {
      // The kernel will be culled on idle; ignore cleanup failures.
    });
  }
}

// Install the helper using whichever mechanism the pod supports: prefer Jupyter
// (works without an sshd) and fall back to SSH. Returns which method succeeded.
export async function installRunpodHelper(pod: RunpodPodSettings) {
  const attempts: string[] = [];

  if (pod.podId) {
    const env = await fetchRunpodPodEnv(pod.podId);
    if (env.JUPYTER_PASSWORD) {
      try {
        const result = await deployRunpodHelperViaJupyter(pod);
        return { method: "jupyter" as const, ...result };
      } catch (error) {
        attempts.push(
          `Jupyter: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  if (pod.ssh.trim()) {
    try {
      const result = await setupRunpodPod(pod);
      return { method: "ssh" as const, ...result };
    } catch (error) {
      attempts.push(`SSH: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    attempts.length
      ? `Helper install failed. ${attempts.join(" | ")}`
      : "No helper install method is available. Expose Jupyter (JUPYTER_PASSWORD) or configure SSH for this pod."
  );
}

interface CatalogEntry {
  name?: string;
  version?: string;
  base_model?: string;
  thumbnail_url?: string | null;
  civitai_url?: string | null;
  source_url?: string | null;
  tags?: string[];
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

function catalogEntryFromResource(
  existing: CatalogEntry,
  filename: string,
  resource: ImportedCivitaiResource
): CatalogEntry {
  return {
    ...existing,
    name: resource.name || existing.name || filename,
    version: resource.versionName || existing.version || "",
    base_model: resource.baseModel || existing.base_model || "",
    thumbnail_url: resource.thumbnailUrl || existing.thumbnail_url || null,
    civitai_url: resource.url || existing.civitai_url || null,
    source_url: resource.url || existing.source_url || null,
    tags:
      resource.tags && resource.tags.length > 0
        ? resource.tags
        : existing.tags ?? [],
  };
}

async function upsertCatalogResource(
  catalog: Record<string, CatalogEntry>,
  folder: string,
  filename: string,
  resource: ImportedCivitaiResource
) {
  const key = `${folder}/${filename}`;
  catalog[key] = catalogEntryFromResource(catalog[key] ?? {}, filename, resource);
  await writeModelCatalog(catalog);
}

// The pod stores a shared metadata catalog next to its ComfyUI models so that a
// model one person downloads carries its thumbnail/name for everyone else. It
// lives on the pod's persistent volume; the helper exposes it at
// /api/runpod/helper/catalog. These calls are best-effort: an old helper (no
// such route) or an unreachable pod simply yields an empty/no-op result.
const RUNPOD_MODELS_PREFIX = "/workspace/ComfyUI/models/";

function podCatalogKeyFromTargetFile(targetFile: string) {
  return targetFile.startsWith(RUNPOD_MODELS_PREFIX)
    ? targetFile.slice(RUNPOD_MODELS_PREFIX.length).replace(/^\/+/, "")
    : targetFile.replace(/^\/+/, "");
}

async function fetchRunpodStoredCatalog(
  pod: RunpodPodSettings
): Promise<Record<string, CatalogEntry>> {
  try {
    const data = await fetchRunpodHelper(pod, "/api/runpod/helper/catalog", {
      method: "GET",
    });
    return data && typeof data.catalog === "object" && data.catalog
      ? (data.catalog as Record<string, CatalogEntry>)
      : {};
  } catch {
    return {};
  }
}

async function pushRunpodStoredCatalog(
  pod: RunpodPodSettings,
  entries: Record<string, CatalogEntry>
) {
  if (Object.keys(entries).length === 0) return;
  try {
    await fetchRunpodHelper(pod, "/api/runpod/helper/catalog", {
      method: "POST",
      body: JSON.stringify({ entries }),
    });
  } catch {
    // Best-effort: never fail a download because the catalog write failed.
  }
}

// After a resource lands on the pod, record its metadata in the pod's shared
// catalog so other users see the model (with its thumbnail) in their picker.
async function recordRunpodDownloadInCatalog(
  pod: RunpodPodSettings,
  targetFile: string,
  resource: ImportedCivitaiResource
) {
  const key = podCatalogKeyFromTargetFile(targetFile);
  if (!key) return;
  const entry = catalogEntryFromResource({}, basename(key), resource);
  await pushRunpodStoredCatalog(pod, { [key]: entry });
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
  importedResources: ImportedCivitaiResource[] = [],
  needsAnimaSupport = false,
  checkpointFolder = "checkpoints"
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
    push("checkpoint", checkpointFolder, checkpointName);
    if (isKrea2CheckpointName(checkpointName)) {
      // "generic" and "refined" share the official Krea 2 stack (qwen3vl CLIP + qwen
      // image VAE); only "pornmaster" swaps in its abliterated int8 CLIP + Wan 2.1 VAE.
      // "refined" adds a second stock KSampler pass, so it needs no extra files or nodes.
      const pornmaster = params.krea2_workflow === "pornmaster";
      push("other", "text_encoders", pornmaster ? PORNMASTER_CLIP_NAME : KREA2_CLIP_NAME);
      push("vae", "vae", pornmaster ? PORNMASTER_VAE_NAME : KREA2_VAE_NAME);
    } else if (isZImageCheckpointName(checkpointName)) {
      // Z-Image loads an external Qwen3-4B text encoder + Flux-style 16ch VAE that the
      // diffusion-only weights do not bundle. Same family order as buildDefaultWorkflow.
      push("other", "text_encoders", ZIMAGE_CLIP_NAME);
      push("vae", "vae", ZIMAGE_VAE_NAME);
    } else if (needsAnimaSupport) {
      // Anima loads an external Qwen3-0.6B text encoder + Qwen-Image VAE that the
      // diffusion-only checkpoint does not bundle. The caller gates this on the pod's
      // actual capabilities so SDXL merges whose name merely contains "anima" (e.g.
      // riMix, revAnimated) are not flagged for files they never use.
      push("other", "text_encoders", ANIMA_CLIP_NAME);
      push("vae", "vae", ANIMA_VAE_NAME);
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
  // An Anima checkpoint routes to the dedicated Anima pipeline only when it is
  // Anima-named AND ships no bundled CLIP (diffusion-only) — the same gate
  // buildDefaultWorkflow uses. Only then does the pod need the external Qwen3-0.6B
  // text encoder + Qwen-Image VAE, so probe the pod's capabilities before requiring
  // them (avoids false "missing file" flags for CLIP-bundling SDXL/Anima merges).
  const checkpointName = params.model_name.trim();
  const isKrea2 = isKrea2CheckpointName(checkpointName);
  const isZImage = !isKrea2 && isZImageCheckpointName(checkpointName);
  // Probing costs a helper round-trip, so only do it for the two families whose routing
  // actually depends on it (Anima: dedicated pipeline or not; Z-Image: which folder).
  const capabilities =
    checkpointName.length > 0 &&
    (isZImage || (!isKrea2 && isAnimaCheckpointName(checkpointName)))
      ? await getRunpodCheckpointCapabilities(pod.comfyUrl, checkpointName)
      : null;
  const needsAnimaSupport = !isZImage && capabilities?.clip === false;
  // Non-null capabilities mean the header was read from models/checkpoints on the pod;
  // otherwise a Z-Image checkpoint is in models/diffusion_models, like Krea 2.
  const checkpointFolder =
    isKrea2 || (isZImage && !capabilities) ? "diffusion_models" : "checkpoints";

  const resources = await namesForParams(
    params,
    importedResources,
    needsAnimaSupport,
    checkpointFolder
  );
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

  return enriched.map((item) => ({
    ...item,
    downloadable: canDownloadRunpodResource(item.resource, item.path),
  }));
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

// Folds the pod's shared metadata catalog into this machine's local
// data/model-catalog.json: any model another user downloaded to the pod becomes
// a known catalog entry here (with its thumbnail/name), so /api/models surfaces
// it as a not-locally-present asset. Only fills gaps on entries we already have,
// so a user's own edited metadata is never clobbered. Returns true if it wrote.
async function mergePodCatalogIntoLocal(
  stored: Record<string, CatalogEntry>
): Promise<boolean> {
  const keys = Object.keys(stored);
  if (keys.length === 0) return false;

  const local = await readModelCatalog();
  let changed = false;

  for (const key of keys) {
    const incoming = stored[key];
    if (!incoming || typeof incoming !== "object" || !incoming.name) continue;
    const existing = local[key];
    if (!existing) {
      local[key] = incoming;
      changed = true;
      continue;
    }
    // Fill only empty fields on entries we already track.
    const merged: CatalogEntry = {
      ...existing,
      base_model: existing.base_model || incoming.base_model || "",
      thumbnail_url: existing.thumbnail_url || incoming.thumbnail_url || null,
      civitai_url: existing.civitai_url || incoming.civitai_url || null,
      source_url: existing.source_url || incoming.source_url || null,
      tags:
        existing.tags && existing.tags.length > 0
          ? existing.tags
          : incoming.tags ?? [],
    };
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      local[key] = merged;
      changed = true;
    }
  }

  if (changed) await writeModelCatalog(local);
  return changed;
}

// A model that physically exists on the pod, shaped so the client can drop it
// straight into its picker list. `path` is folder-relative (matches the local
// asset `path`); metadata is resolved from the merged catalog when available.
export interface RunpodModelDescriptor {
  path: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
}

// Physically enumerate every model file under the pod's models dirs (via the
// helper's filesystem scan). This is the source of truth for "what is on the
// pod", independent of ComfyUI's /object_info (stale until restart) and the
// download catalog (app downloads only). Best-effort: an old helper without the
// /models route yields empty lists and callers fall back to the other sources.
async function fetchRunpodPhysicalModels(pod: RunpodPodSettings): Promise<{
  checkpoints: string[];
  loras: string[];
  diffusion_models: string[];
  embeddings: string[];
}> {
  const empty = { checkpoints: [], loras: [], diffusion_models: [], embeddings: [] };
  try {
    const data = await fetchRunpodHelper(pod, "/api/runpod/helper/models", {
      method: "GET",
    });
    const arr = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
    return {
      checkpoints: arr(data.checkpoints),
      loras: arr(data.loras),
      diffusion_models: arr(data.diffusion_models),
      embeddings: arr(data.embeddings),
    };
  } catch {
    return empty;
  }
}

function humanizeModelFilename(path: string) {
  const base = (path.split("/").pop() ?? path).replace(
    /\.(ckpt|pt|pth|safetensors)$/i,
    ""
  );
  const versionMatch = base.match(/(?:^|[-_])v(\d+(?:\.\d+)*)(?:$|[-_])/i);
  const name = base
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { name: name || base, version: versionMatch ? `v${versionMatch[1]}` : "" };
}

// Builds the pod's checkpoint / LoRA / embedding picker lists from every model
// physically present on the pod. Metadata is auto-associated from the merged
// catalog (pod shared catalog folded into the local catalog, plus any local
// catalog entry with the same filename); unknown files fall back to a humanized
// name. /object_info and the shared catalog are unioned in so the list stays
// populated even when the helper's file scan is unavailable (old build).
export async function fetchRunpodModelCatalog(pod: RunpodPodSettings): Promise<{
  checkpoints: RunpodModelDescriptor[];
  loras: RunpodModelDescriptor[];
  embeddings: RunpodModelDescriptor[];
}> {
  const [ckptNames, unetNames, loraNames, stored, physical] = await Promise.all([
    comfyObjectOptions(pod, "CheckpointLoaderSimple", "ckpt_name"),
    comfyObjectOptions(pod, "UNETLoader", "unet_name"),
    comfyObjectOptions(pod, "LoraLoader", "lora_name"),
    fetchRunpodStoredCatalog(pod),
    fetchRunpodPhysicalModels(pod),
  ]);

  await mergePodCatalogIntoLocal(stored);

  // Resolve metadata from the merged local catalog, keyed by exact folder/path or,
  // per the "same filename auto-registers" rule, by basename.
  const local = await readModelCatalog();
  const byBasename = new Map<string, CatalogEntry>();
  for (const [key, entry] of Object.entries(local)) {
    const basenameKey = (key.split("/").pop() ?? key).toLowerCase();
    if (basenameKey && !byBasename.has(basenameKey)) byBasename.set(basenameKey, entry);
  }
  const resolveMeta = (folder: string, path: string) =>
    local[`${folder}/${path}`] ??
    byBasename.get((path.split("/").pop() ?? path).toLowerCase());

  const toDescriptor = (folder: string, path: string): RunpodModelDescriptor => {
    const meta = resolveMeta(folder, path);
    const fallback = humanizeModelFilename(path);
    return {
      path,
      name: meta?.name || fallback.name,
      version: meta?.version || fallback.version,
      base_model: meta?.base_model || "",
      thumbnail_url: meta?.thumbnail_url ?? null,
    };
  };

  const buildGroup = (
    candidates: Array<{ folder: string; path: string }>
  ): RunpodModelDescriptor[] => {
    const seen = new Set<string>();
    const out: RunpodModelDescriptor[] = [];
    for (const { folder, path } of candidates) {
      const norm = path.replaceAll("\\", "/");
      const dedupeKey = norm.toLowerCase();
      if (!norm || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(toDescriptor(folder, norm));
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  };

  const storedCkpt: Array<{ folder: string; path: string }> = [];
  const storedLora: Array<{ folder: string; path: string }> = [];
  const storedEmb: Array<{ folder: string; path: string }> = [];
  for (const key of Object.keys(stored)) {
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    const folder = key.slice(0, slash);
    const filename = key.slice(slash + 1);
    if (!filename) continue;
    if (folder === "checkpoints") storedCkpt.push({ folder, path: filename });
    else if (folder === "diffusion_models" && isDiffusionOnlyImageCheckpointName(filename)) {
      storedCkpt.push({ folder, path: filename });
    } else if (folder === "loras") storedLora.push({ folder, path: filename });
    else if (folder === "embeddings") storedEmb.push({ folder, path: filename });
  }

  const asCandidates = (folder: string, paths: string[]) =>
    paths.map((path) => ({ folder, path }));

  return {
    checkpoints: buildGroup([
      ...asCandidates("checkpoints", physical.checkpoints),
      ...asCandidates(
        "diffusion_models",
        physical.diffusion_models.filter((path) =>
          isDiffusionOnlyImageCheckpointName(path)
        )
      ),
      ...asCandidates("checkpoints", ckptNames),
      ...asCandidates(
        "diffusion_models",
        unetNames.filter((path) => isDiffusionOnlyImageCheckpointName(path))
      ),
      ...storedCkpt,
    ]),
    loras: buildGroup([
      ...asCandidates("loras", physical.loras),
      ...asCandidates("loras", loraNames),
      ...storedLora,
    ]),
    embeddings: buildGroup([
      ...asCandidates("embeddings", physical.embeddings),
      ...storedEmb,
    ]),
  };
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

function isCivitaiHost(url: string) {
  try {
    return /(^|\.)civitai\.(com|red)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

function isHuggingFaceHost(url: string) {
  try {
    return /(^|\.)huggingface\.co$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

// A "direct" URL points straight at a weights file, so the pod helper can fetch
// it without a Civitai modelVersionId. Covers HuggingFace resolve links, any
// /api/download/ endpoint, and plain file URLs. Civitai *model-page* URLs are not
// direct — those still resolve through the modelVersionId path below.
function isDirectDownloadUrl(url: string | undefined) {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  const path = parsed.pathname.toLowerCase();
  if (parsed.hostname.endsWith("huggingface.co") && path.includes("/resolve/")) {
    return true;
  }
  if (path.includes("/api/download/")) return true;
  if (/\.(safetensors|ckpt|pt|pth|gguf|bin)$/i.test(path)) return true;
  return false;
}

// Single source of truth for "can the pod fetch this file automatically?".
// A file is downloadable if it maps to a known base asset, resolves to a direct
// weights URL, or is a Civitai resource with a modelVersionId. getRunpodDownloadPlan
// enforces the same conditions; the file check reports them to the client so the
// UI never has to re-derive download eligibility from a hardcoded list.
export function canDownloadRunpodResource(
  resource: Pick<ImportedCivitaiResource, "type" | "url" | "modelVersionId">,
  targetPath?: string
) {
  const folder = RESOURCE_FOLDERS[resource.type];
  const baseAsset = targetPath ? runpodBaseAssetForPath(targetPath) : undefined;
  const directUrl = !baseAsset && isDirectDownloadUrl(resource.url) ? resource.url : undefined;

  if (!folder && !baseAsset && !(directUrl && targetPath)) return false;
  if (!baseAsset && !directUrl && !resource.modelVersionId) return false;
  return true;
}

async function getRunpodDownloadPlan(
  pod: RunpodPodSettings,
  resource: ImportedCivitaiResource,
  targetPath?: string
) {
  const settings = await readSettings();
  const token = settings.civitaiApiKey || process.env.CIVITAI_API_TOKEN?.trim();
  // Gated HuggingFace repos (e.g. Lightricks/LTX-2.5) return 401 without a token.
  // Public HF files ignore the header, so it is safe to send for any HF URL.
  const hfToken =
    settings.huggingfaceApiKey ||
    process.env.HF_TOKEN?.trim() ||
    process.env.HUGGINGFACE_TOKEN?.trim() ||
    process.env.HUGGING_FACE_HUB_TOKEN?.trim() ||
    "";

  const folder = RESOURCE_FOLDERS[resource.type];
  const baseAsset = targetPath ? runpodBaseAssetForPath(targetPath) : undefined;
  const directUrl =
    !baseAsset && isDirectDownloadUrl(resource.url) ? resource.url : undefined;
  const directIsCivitai = directUrl ? isCivitaiHost(directUrl) : false;

  if (!canDownloadRunpodResource(resource, targetPath)) {
    throw new Error("This resource cannot be downloaded automatically.");
  }

  // HuggingFace (and other non-civitai direct URLs) need no token; civitai
  // downloads — whether by modelVersionId or a direct civitai link — still do.
  const needsToken = !baseAsset && (directUrl ? directIsCivitai : true);
  if (needsToken && !token) throw new Error("Civitai API key is not configured.");

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
  const downloadUrl =
    baseAsset?.url ??
    directUrl ??
    `https://civitai.com/api/download/models/${resource.modelVersionId}`;
  const tokenValue = needsToken
    ? token ?? ""
    : isHuggingFaceHost(downloadUrl)
      ? hfToken
      : "";

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
  await recordRunpodDownloadInCatalog(pod, targetFile, resource);
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

  await recordRunpodDownloadInCatalog(pod, targetFile, resource);

  return targetFile;
}

export interface RunpodNodeRepo {
  name: string;
  url: string;
}

export interface RunpodNodeInstallEvent {
  type: "status" | "repo" | "log" | "complete" | "error";
  name?: string;
  status?: string;
  message?: string;
  total?: number;
  installed?: string[];
  restarted?: boolean;
  pid?: number | null;
}

// Fetch the set of node class_types ComfyUI currently has registered (via its
// /object_info endpoint). Returns null when ComfyUI is unreachable so callers can
// fall back to "install everything the workflow references".
export async function fetchRunpodInstalledNodeTypes(pod: RunpodPodSettings) {
  const base = pod.comfyUrl?.replace(/\/$/, "");
  if (!base) return null;
  try {
    const response = await fetch(`${base}/object_info`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    return new Set(Object.keys(data));
  } catch {
    return null;
  }
}

// Install a list of custom-node git repos onto the pod via the helper, streaming
// per-repo/pip progress back through onEvent. Restarts ComfyUI when anything was
// installed so the new nodes register.
export async function streamRunpodNodeInstall(
  podId: string,
  repos: RunpodNodeRepo[],
  onEvent: (event: RunpodNodeInstallEvent) => void,
  restart = true
) {
  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  const helperUrl = deriveHelperUrl(pod);
  if (!helperUrl) throw new Error("RunPod Image Gen helper URL is not configured.");

  const postInstall = () =>
    fetch(`${helperUrl}/api/runpod/helper/install-nodes/stream`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repos, restart }),
    });

  let response = await postInstall();

  // A pod running an older helper build lacks this route and answers 404
  // ("Not found."). Its /status route still responds, so the status probe
  // reports the helper as healthy and it is never redeployed. Detect the stale
  // helper here, redeploy the current build in place, wait for it to serve, and
  // retry the install once.
  if (response.status === 404) {
    onEvent({
      type: "status",
      message: "Updating the pod helper to a build that supports node install...",
    });
    await installRunpodHelper(pod);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(3_000);
      try {
        await fetchRunpodHelper(pod, "/api/runpod/helper/status", {
          signal: AbortSignal.timeout(5_000),
        });
        break;
      } catch {
        // Keep waiting for the redeployed helper to start serving.
      }
    }
    response = await postInstall();
  }

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `RunPod helper HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let helperError = "";
  let installed: string[] = [];
  const handle = (raw: string) => {
    if (!raw.startsWith("data:")) return;
    const event = JSON.parse(raw.slice(5).trim()) as RunpodNodeInstallEvent;
    if (event.type === "error") helperError = event.message || "Node install failed.";
    if (event.type === "complete") installed = event.installed ?? [];
    onEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);
  if (helperError) throw new Error(helperError);

  return installed;
}

// Install the PuLID node + SDXL weight onto a pod for the Character Reference
// feature: reuse the generic node installer for the custom node, then ask the pod
// helper to fetch the weight into models/pulid/. The node install's own terminal
// "complete" is downgraded to a status so only the final event (after the weight
// lands) signals done.
export async function streamRunpodPulidInstall(
  podId: string,
  onEvent: (event: RunpodNodeInstallEvent) => void
) {
  const relay = (event: RunpodNodeInstallEvent) => {
    if (event.type === "complete") {
      onEvent({ type: "status", message: "Custom node installed — fetching the weight next..." });
    } else {
      onEvent(event);
    }
  };
  await streamRunpodNodeInstall(
    podId,
    [{ name: PULID_NODE_REPO.name, url: PULID_NODE_REPO.url }],
    relay,
    true
  );

  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  onEvent({
    type: "status",
    message: `PuLID 가중치 다운로드 중 (${PULID_WEIGHT.fileName}, ~939MB)... (downloading weight)`,
  });
  await fetchRunpodHelper(pod, "/api/runpod/helper/download", {
    method: "POST",
    body: JSON.stringify({
      targetFile: PULID_WEIGHT.targetFile,
      downloadUrl: PULID_WEIGHT.downloadUrl,
    }),
  });

  // InsightFace antelopev2 face models (PulidInsightFaceLoader needs these, and
  // its own auto-download is unreliable). Fetch each ONNX into models/insightface.
  for (const file of PULID_INSIGHTFACE.files) {
    onEvent({ type: "status", message: `InsightFace 모델 다운로드 중: ${file}` });
    await fetchRunpodHelper(pod, "/api/runpod/helper/download", {
      method: "POST",
      body: JSON.stringify({
        targetFile: `${PULID_INSIGHTFACE.dir}/${file}`,
        downloadUrl: `${PULID_INSIGHTFACE.baseUrl}/${file}?download=true`,
      }),
    });
  }

  onEvent({
    type: "complete",
    installed: [PULID_NODE_REPO.name, PULID_WEIGHT.fileName, "antelopev2"],
    message: "PuLID 설치 완료. 다시 생성하세요. (PuLID installed on the pod — generate again.)",
  });
}

export interface RunpodComfyUpgradeEvent {
  type: "status" | "log" | "complete" | "error";
  message?: string;
  restarted?: boolean;
  pid?: number | null;
  previousVersion?: string;
  version?: string;
}

// The ComfyUI git ref the pod should run, pinned in comfyui-config so setup and
// in-place upgrades agree on one target. Currently a commit at or above 0.27.0,
// which is the first ComfyUI to support int8_tensorwise checkpoints.
export async function getPinnedComfyRef(): Promise<string> {
  try {
    const raw = await readFile("comfyui-config/comfyui-version.txt", "utf8");
    return raw.trim();
  } catch {
    return "";
  }
}

// Update the pod's ComfyUI to the pinned ref (git checkout + pip + restart) via
// the helper, streaming progress back through onEvent. Mirrors the node-install
// path, including the one-shot stale-helper redeploy for pods on an older build
// that lacks this route.
export async function streamRunpodComfyUpgrade(
  podId: string,
  onEvent: (event: RunpodComfyUpgradeEvent) => void,
  ref?: string
) {
  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  const target = (ref || (await getPinnedComfyRef())).trim();
  if (!target) throw new Error("No pinned ComfyUI ref is configured.");

  const helperUrl = deriveHelperUrl(pod);
  if (!helperUrl) throw new Error("RunPod Image Gen helper URL is not configured.");

  // The upgrade's correctness depends on the helper's restart logic, so a stale
  // helper must be redeployed first — not just when the route 404s, but whenever
  // its version lags. (Older builds killed the wrong PID and left the old ComfyUI
  // serving, so the upgrade appeared to succeed while the version never moved.)
  try {
    const status = await fetchRunpodHelper(pod, "/api/runpod/helper/status", {
      signal: AbortSignal.timeout(5_000),
    });
    const version = typeof status.version === "string" ? status.version : "";
    if (version !== RUNPOD_HELPER_VERSION) {
      onEvent({
        type: "status",
        message: "Updating the pod helper to the current build before upgrading...",
      });
      await installRunpodHelper(pod);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await wait(3_000);
        try {
          await fetchRunpodHelper(pod, "/api/runpod/helper/status", {
            signal: AbortSignal.timeout(5_000),
          });
          break;
        } catch {
          // Keep waiting for the redeployed helper to start serving.
        }
      }
    }
  } catch {
    // Status probe failed; the 404 path below still covers a missing route.
  }

  const postUpgrade = () =>
    fetch(`${helperUrl}/api/runpod/helper/comfyui/upgrade/stream`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: target }),
    });

  let response = await postUpgrade();

  // A pod on an older helper build lacks this route (404). Redeploy the current
  // helper in place, wait for it to serve, then retry once.
  if (response.status === 404) {
    onEvent({
      type: "status",
      message: "Updating the pod helper to a build that supports ComfyUI upgrade...",
    });
    await installRunpodHelper(pod);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await wait(3_000);
      try {
        await fetchRunpodHelper(pod, "/api/runpod/helper/status", {
          signal: AbortSignal.timeout(5_000),
        });
        break;
      } catch {
        // Keep waiting for the redeployed helper to start serving.
      }
    }
    response = await postUpgrade();
  }

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `RunPod helper HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let helperError = "";
  const handle = (raw: string) => {
    if (!raw.startsWith("data:")) return;
    const event = JSON.parse(raw.slice(5).trim()) as RunpodComfyUpgradeEvent;
    if (event.type === "error") helperError = event.message || "ComfyUI upgrade failed.";
    onEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handle(line);
  }
  if (buffer) handle(buffer);
  if (helperError) throw new Error(helperError);
}

// Custom-node packs a given image workflow variant needs, keyed by krea2_workflow.
// Each entry maps a representative node class_type to its installable git repo.
// "generic" and "refined" use only stock ComfyUI nodes, so they have no entry here.
const IMAGE_WORKFLOW_NODE_PACKS: Record<
  string,
  Array<{ nodeType: string; repo: RunpodNodeRepo }>
> = {
  pornmaster: [
    {
      nodeType: "ClownsharKSampler_Beta",
      repo: { name: "RES4LYF", url: "https://github.com/ClownsharkBatwing/RES4LYF" },
    },
  ],
};

// Resolve which custom-node repos the given image workflow still needs on this
// pod by reading its live /object_info node list. comfyReachable is false when
// ComfyUI could not be reached (so the caller can avoid a misleading "all good").
export async function collectImageWorkflowNodePacks(
  pod: RunpodPodSettings,
  krea2Workflow: string
): Promise<{ packs: RunpodNodeRepo[]; comfyReachable: boolean }> {
  const required = IMAGE_WORKFLOW_NODE_PACKS[krea2Workflow] ?? [];
  if (required.length === 0) return { packs: [], comfyReachable: true };

  const installed = await fetchRunpodInstalledNodeTypes(pod);
  if (!installed) return { packs: [], comfyReachable: false };

  const packs: RunpodNodeRepo[] = [];
  const seen = new Set<string>();
  for (const { nodeType, repo } of required) {
    if (!installed.has(nodeType) && !seen.has(repo.url)) {
      seen.add(repo.url);
      packs.push(repo);
    }
  }
  return { packs, comfyReachable: true };
}
