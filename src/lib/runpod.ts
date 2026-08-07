import "server-only";

import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { basename } from "path";
import { promisify } from "util";
import type { GenerationParams, ImportedCivitaiResource } from "@/lib/types";
import { getRunpodPod, readSettings, type RunpodPodSettings } from "@/lib/settings";
import { parseCivitaiUrlIds } from "@/lib/civitai-url";

const execFileAsync = promisify(execFile);

const RESOURCE_FOLDERS: Partial<Record<ImportedCivitaiResource["type"], string>> = {
  checkpoint: "checkpoints",
  lora: "loras",
  embedding: "embeddings",
  vae: "vae",
  upscaler: "upscale_models",
};

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function extractSshCommand(value: string) {
  const normalized = value
    .trim()
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim().replace(/^\$\s*/, ""))
    .find((line) => line.includes("@ssh.runpod.io") || line.startsWith("ssh "));

  if (!normalized) return "";

  const sshIndex = normalized.indexOf("ssh ");
  if (sshIndex >= 0) return normalized.slice(sshIndex).trim();

  if (normalized.includes("@ssh.runpod.io")) {
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

function normalizedSshCommand(value: string) {
  const words = splitShellWords(value);
  const args = words[0] === "ssh" ? words.slice(1) : words;
  const destinationIndex = args.findIndex((arg) => /@ssh\.runpod\.io$/i.test(arg));

  if (destinationIndex < 0) return "";

  const destination = args[destinationIndex];
  const beforeDestination = args.slice(0, destinationIndex);
  const afterDestination = args.slice(destinationIndex + 1);
  const optionArgs = [...beforeDestination, ...afterDestination];

  return [
    "ssh",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    ...optionArgs,
    destination,
  ]
    .map(shellQuote)
    .join(" ");
}

function remoteCommand(ssh: string, command: string) {
  const extracted = extractSshCommand(ssh);
  if (!extracted) {
    throw new Error(
      "RunPod SSH command was not recognized. Paste the SSH line from RunPod Connect."
    );
  }

  const safeSsh = normalizedSshCommand(extracted);
  if (!safeSsh) {
    throw new Error("RunPod SSH command must include a user@ssh.runpod.io address.");
  }

  return `${safeSsh} ${shellQuote(command)}`;
}

export async function runSsh(
  pod: RunpodPodSettings,
  command: string,
  options: { timeoutMs?: number } = {}
) {
  if (!pod.ssh.trim()) {
    throw new Error("RunPod SSH command is not configured.");
  }

  const { stdout, stderr } = await execFileAsync(
    "bash",
    ["-lc", remoteCommand(pod.ssh, command)],
    {
      timeout: options.timeoutMs ?? 30 * 60 * 1000,
      maxBuffer: 20 * 1024 * 1024,
    }
  );

  return { stdout, stderr };
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

  let sshReachable = false;
  let sshError = "";
  try {
    await runSsh(pod, "printf ok", { timeoutMs: 15_000 });
    sshReachable = true;
  } catch (error) {
    sshError = error instanceof Error ? error.message : "SSH failed.";
  }

  return { comfyReachable, comfyError, sshReachable, sshError };
}

export async function setupRunpodPod(pod: RunpodPodSettings) {
  const script = [
    "set -euo pipefail",
    'COMFYUI_DIR="${COMFYUI_DIR:-/workspace/ComfyUI}"',
    'COMFYUI_PORT="${COMFYUI_PORT:-8188}"',
    "mkdir -p /workspace",
    'if [ ! -d "$COMFYUI_DIR/.git" ]; then',
    '  rm -rf "$COMFYUI_DIR"',
    '  git clone https://github.com/comfyanonymous/ComfyUI.git "$COMFYUI_DIR"',
    "fi",
    'cd "$COMFYUI_DIR"',
    "python3 -m pip install -r requirements.txt",
    "mkdir -p models/checkpoints models/loras models/embeddings models/vae models/upscale_models models/controlnet models/clip_vision models/ipadapter",
    'if ! curl -fsS --max-time 5 "http://127.0.0.1:$COMFYUI_PORT/system_stats" >/dev/null 2>&1; then',
    '  nohup python3 main.py --listen 0.0.0.0 --port "$COMFYUI_PORT" --enable-cors-header > /workspace/comfyui.log 2>&1 &',
    "fi",
    "for _ in $(seq 1 90); do",
    '  if curl -fsS --max-time 5 "http://127.0.0.1:$COMFYUI_PORT/system_stats" >/dev/null 2>&1; then',
    '    echo "ComfyUI ready"',
    "    exit 0",
    "  fi",
    "  sleep 2",
    "done",
    'echo "ComfyUI did not become ready. See /workspace/comfyui.log" >&2',
    "exit 1",
  ].join("\n");

  return runSsh(pod, script);
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

function resourceFromCatalog(
  catalog: Record<string, CatalogEntry>,
  type: ImportedCivitaiResource["type"],
  folder: string,
  filename: string
) {
  const metadata = catalog[`${folder}/${filename}`] ?? catalog[filename];
  const url = metadata?.civitai_url || metadata?.source_url || "";
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

async function namesForParams(params: GenerationParams) {
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
      resource: resourceFromCatalog(catalog, type, folder, name),
    });
  };
  if (params.model_name.trim()) {
    push("checkpoint", "checkpoints", params.model_name.trim());
  }
  params.loras.forEach((lora) => {
    if (lora.path.trim()) push("lora", "loras", lora.path.trim());
  });
  params.embeddings.forEach((embedding) => {
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
  return names;
}

export async function checkRunpodGenerationFiles(
  pod: RunpodPodSettings,
  params: GenerationParams
) {
  const resources = await namesForParams(params);
  if (resources.length === 0) return [];

  const checks = resources
    .map((resource, index) => {
      const path = `/workspace/ComfyUI/models/${resource.folder}/${resource.name}`;
      return `if [ -f ${shellQuote(path)} ]; then echo ${index}:ok; else echo ${index}:missing; fi`;
    })
    .join("\n");
  const { stdout } = await runSsh(pod, checks);
  const statuses = new Map(
    stdout
      .trim()
      .split(/\n+/)
      .map((line) => line.split(":"))
      .filter((parts) => parts.length === 2)
      .map(([index, status]) => [Number(index), status])
  );

  return resources
    .filter((_, index) => statuses.get(index) !== "ok")
    .map(({ folder, name, resource }) => ({ folder, path: `${folder}/${name}`, resource }));
}

function fallbackFilename(resource: ImportedCivitaiResource) {
  const base = [resource.name, resource.versionName].filter(Boolean).join(" ") ||
    `civitai-${resource.modelVersionId}`;
  const safe = base.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_").trim();
  return /\.(ckpt|pt|pth|safetensors)$/i.test(safe) ? safe : `${safe}.safetensors`;
}

export async function downloadRunpodResource(
  podId: string,
  resource: ImportedCivitaiResource,
  targetPath?: string
) {
  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  const settings = await readSettings();
  const token = settings.civitaiApiKey || process.env.CIVITAI_API_TOKEN?.trim();
  if (!token) throw new Error("Civitai API key is not configured.");

  const folder = RESOURCE_FOLDERS[resource.type];
  if (!folder || !resource.modelVersionId) {
    throw new Error("This resource cannot be downloaded automatically.");
  }

  const filename = targetPath ? basename(targetPath) : fallbackFilename(resource);
  const targetDir = `/workspace/ComfyUI/models/${folder}`;
  const targetFile = `${targetDir}/${filename}`;
  const script = `
set -euo pipefail
TARGET_DIR=${shellQuote(targetDir)}
TARGET_FILE=${shellQuote(targetFile)}
mkdir -p "$TARGET_DIR"
if [ -f "$TARGET_FILE" ]; then
  echo "$TARGET_FILE"
  exit 0
fi
curl -L --fail --retry 3 --continue-at - \
  -H ${shellQuote(`Authorization: Bearer ${token}`)} \
  -H ${shellQuote("User-Agent: image-gen-runpod-download/1.0")} \
  -o "$TARGET_FILE.download" \
  ${shellQuote(`https://civitai.com/api/download/models/${resource.modelVersionId}`)}
mv "$TARGET_FILE.download" "$TARGET_FILE"
echo "$TARGET_FILE"
`;
  const { stdout } = await runSsh(pod, script);
  return stdout.trim().split(/\n/).pop() ?? "";
}
