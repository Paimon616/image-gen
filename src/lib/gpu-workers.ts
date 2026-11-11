import "server-only";

import {
  chooseGpuWorker,
  CHECKPOINT_FOLDERS,
  classifyWorkload,
  gpuWorkerHelperUrl,
  missingModelFiles,
  requiredModelFiles,
  type GpuWorkerCandidate,
  type GpuWorkerConfig,
  type GpuWorkerRejection,
  type GpuWorkload,
} from "@/lib/gpu-worker-dispatch";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readSettings } from "@/lib/settings";
import type { GenerationParams } from "@/lib/types";

// Server side of the GPU worker pool: live probes of each remote ComfyUI,
// in-flight reservations, and prompt → worker bookkeeping for cancel. The
// scheduling rule itself is the pure chooseGpuWorker().

// 5s, not 2s: a worker busy downloading a model (its uplink saturated) answers
// /system_stats in 1–3s and was shown as offline.
const PROBE_TIMEOUT_MS = Number(process.env.GPU_WORKER_PROBE_TIMEOUT_MS ?? 5_000);
const PROBE_CACHE_MS = 2_000;
const MODEL_LIST_CACHE_MS = 30_000;

export interface GpuWorkerProbe {
  online: boolean;
  queueRunning: number;
  queuePending: number;
  device?: string;
  vramTotal?: number;
  vramFree?: number;
  /** VRAM held by ComfyUI's torch allocator (≈ loaded models + working memory). */
  vramComfy?: number;
  ramTotal?: number;
  ramFree?: number;
  comfyuiVersion?: string;
  error?: string;
  checkedAt: number;
}

interface PoolState {
  reserved: Map<string, number>;
  promptWorker: Map<string, string>;
  probes: Map<string, { at: number; value: Promise<GpuWorkerProbe> }>;
  modelLists: Map<string, { at: number; value: Promise<string[] | undefined> }>;
}

// Survive Next dev hot reloads so reservations aren't lost mid-render.
const globalPool = globalThis as typeof globalThis & { __gpuWorkerPool?: PoolState };
const pool: PoolState = (globalPool.__gpuWorkerPool ??= {
  reserved: new Map(),
  promptWorker: new Map(),
  probes: new Map(),
  modelLists: new Map(),
});

async function fetchJson<T>(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
    if (error.name === "TimeoutError") return "timeout";
    return error.message;
  }
  return String(error);
}

async function probeUncached(worker: GpuWorkerConfig): Promise<GpuWorkerProbe> {
  const checkedAt = Date.now();
  try {
    const [stats, queue] = await Promise.all([
      fetchJson<{
        system?: { comfyui_version?: string; ram_total?: number; ram_free?: number };
        devices?: {
          name?: string;
          vram_total?: number;
          vram_free?: number;
          torch_vram_total?: number;
        }[];
      }>(`${worker.url}/system_stats`),
      fetchJson<{ queue_running?: unknown[]; queue_pending?: unknown[] }>(`${worker.url}/queue`),
    ]);
    const device = stats.devices?.[0];
    return {
      online: true,
      queueRunning: queue.queue_running?.length ?? 0,
      queuePending: queue.queue_pending?.length ?? 0,
      device: device?.name,
      vramTotal: device?.vram_total,
      vramFree: device?.vram_free,
      vramComfy: device?.torch_vram_total,
      ramTotal: stats.system?.ram_total,
      ramFree: stats.system?.ram_free,
      comfyuiVersion: stats.system?.comfyui_version,
      checkedAt,
    };
  } catch (error) {
    return {
      online: false,
      queueRunning: 0,
      queuePending: 0,
      error: errorMessage(error),
      checkedAt,
    };
  }
}

export function probeGpuWorker(worker: GpuWorkerConfig, { fresh = false } = {}) {
  const cached = pool.probes.get(worker.id);
  if (!fresh && cached && Date.now() - cached.at < PROBE_CACHE_MS) return cached.value;
  const value = probeUncached(worker);
  pool.probes.set(worker.id, { at: Date.now(), value });
  return value;
}

/** ComfyUI GET /models/<folder>; undefined when the worker can't answer. */
function listWorkerModels(worker: GpuWorkerConfig, folder: string) {
  const key = `${worker.id}:${folder}`;
  const cached = pool.modelLists.get(key);
  if (cached && Date.now() - cached.at < MODEL_LIST_CACHE_MS) return cached.value;
  const value = fetchJson<unknown>(`${worker.url}/models/${encodeURIComponent(folder)}`, 5_000)
    .then((list) => (Array.isArray(list) ? list.map(String) : undefined))
    // 404 = ComfyUI has no such folder (e.g. unet_gguf without ComfyUI-GGUF):
    // an empty list, not an unknown one, so it doesn't mask a missing file.
    .catch((error: unknown) => (error instanceof Error && error.message === "HTTP 404" ? [] : undefined));
  pool.modelLists.set(key, { at: Date.now(), value });
  return value;
}

/** Model files in a folder across every enabled GPU worker (union, de-duplicated). */
export async function listGpuWorkerModelFiles(folder: string) {
  const workers = (await getGpuWorkers()).filter((worker) => worker.enabled);
  const lists = await Promise.all(workers.map((worker) => listWorkerModels(worker, folder)));
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** Drop cached model lists, e.g. after the worker synced new files. */
export function invalidateGpuWorkerModels(workerId?: string) {
  for (const key of pool.modelLists.keys()) {
    if (!workerId || key.startsWith(`${workerId}:`)) pool.modelLists.delete(key);
  }
}

async function workerMissingFiles(worker: GpuWorkerConfig, required: string[]) {
  if (required.length === 0) return [];
  const folders = [
    ...new Set(
      required.flatMap((file) => {
        const folder = file.slice(0, file.indexOf("/"));
        return folder === "checkpoints" ? [...CHECKPOINT_FOLDERS] : [folder];
      })
    ),
  ];
  const lists = await Promise.all(folders.map((folder) => listWorkerModels(worker, folder)));
  return missingModelFiles(
    required,
    Object.fromEntries(folders.map((folder, i) => [folder, lists[i]]))
  );
}

export async function getGpuWorkers() {
  return (await readSettings()).gpuWorkers;
}

async function buildCandidates(
  workers: GpuWorkerConfig[],
  required: string[],
  exclude: Set<string>
): Promise<GpuWorkerCandidate[]> {
  return Promise.all(
    workers
      .filter((worker) => !exclude.has(worker.id))
      .map(async (worker) => {
        const probe = worker.enabled
          ? await probeGpuWorker(worker)
          : ({ online: false, queueRunning: 0, queuePending: 0, checkedAt: 0 } as GpuWorkerProbe);
        const missingFiles =
          worker.enabled && probe.online ? await workerMissingFiles(worker, required) : [];
        return {
          worker,
          reserved: pool.reserved.get(worker.id) ?? 0,
          status: {
            online: probe.online,
            queueDepth: probe.queueRunning + probe.queuePending,
            missingFiles,
            error: probe.error,
          },
        };
      })
  );
}

export class NoGpuWorkerError extends Error {
  constructor(public rejected: GpuWorkerRejection[]) {
    super(
      rejected.length === 0
        ? "No GPU workers are registered. Add one in Settings → GPU workers."
        : "No GPU worker can take this job: " +
            rejected
              .map((r) => `${r.label} ${r.reason}${r.detail ? ` (${r.detail})` : ""}`)
              .join("; ")
    );
    this.name = "NoGpuWorkerError";
  }
}

export interface GpuWorkerLease {
  worker: GpuWorkerConfig;
  workload: GpuWorkload;
  rejected: GpuWorkerRejection[];
  /** Remember which worker owns a ComfyUI prompt so cancel can reach it. */
  bindPrompt: (promptId: string) => void;
  /** Must be called once the job finished, failed or was canceled. */
  release: () => void;
}

/**
 * Reserves the best worker for these params. The reservation counts toward the
 * worker's load immediately, so N parallel requests spread across the pool
 * instead of all reading the same idle /queue and piling onto one card.
 */
const SATURATED_POLL_MS = 1_000;
const SATURATED_MAX_WAIT_MS = Number(process.env.GPU_WORKER_MAX_WAIT_MS ?? 30 * 60_000);

export async function acquireGpuWorker(
  params: GenerationParams & { workload?: string },
  {
    exclude = new Set<string>(),
    signal,
    onWait,
  }: {
    exclude?: Set<string>;
    signal?: AbortSignal;
    /** Called while every usable worker is at maxQueue and the job waits. */
    onWait?: (waitedMs: number) => void;
  } = {}
): Promise<GpuWorkerLease> {
  const workers = await getGpuWorkers();
  const required = requiredModelFiles(params);
  const workload = classifyWorkload(params);
  const waitStart = Date.now();
  let choice: ReturnType<typeof chooseGpuWorker>["choice"] = null;
  let rejected: GpuWorkerRejection[] = [];
  for (;;) {
    const candidates = await buildCandidates(workers, required, exclude);
    // Re-read reservations right before choosing: other requests may have
    // reserved while this one was awaiting probes.
    for (const candidate of candidates) {
      candidate.reserved = pool.reserved.get(candidate.worker.id) ?? 0;
    }
    ({ choice, rejected } = chooseGpuWorker(candidates, workload));
    if (choice) break;
    // Every usable worker is merely busy: wait in line here instead of
    // failing. Offline / missing-model / disabled-only pools fail right away.
    const saturated = rejected.some((r) => r.reason === "full");
    const waited = Date.now() - waitStart;
    if (!saturated || waited > SATURATED_MAX_WAIT_MS || signal?.aborted) {
      throw new NoGpuWorkerError(rejected);
    }
    onWait?.(waited);
    await new Promise((resolve) => setTimeout(resolve, SATURATED_POLL_MS));
    for (const r of rejected) if (r.reason === "full") pool.probes.delete(r.id);
  }

  const { worker } = choice;
  pool.reserved.set(worker.id, (pool.reserved.get(worker.id) ?? 0) + 1);
  let promptId = "";
  let released = false;
  return {
    worker,
    workload,
    rejected,
    bindPrompt: (id) => {
      promptId = id;
      pool.promptWorker.set(id, worker.url);
    },
    release: () => {
      if (released) return;
      released = true;
      pool.reserved.set(worker.id, Math.max(0, (pool.reserved.get(worker.id) ?? 1) - 1));
      if (promptId) pool.promptWorker.delete(promptId);
      // The next acquire should see the worker's real queue, not a 2s-old one.
      pool.probes.delete(worker.id);
    },
  };
}

/** ComfyUI origin that owns a prompt dispatched through the pool, if any. */
export function gpuWorkerUrlForPrompt(promptId: string) {
  return pool.promptWorker.get(promptId);
}

/** Marks a worker unreachable so the next acquire probes it again. */
export function forgetGpuWorkerProbe(workerId: string) {
  pool.probes.delete(workerId);
}

export interface GpuWorkerDownload {
  path: string;
  downloaded: number;
  total: number | null;
  percent: number | null;
  state: "downloading" | "done" | "error" | "paused";
  bytesPerSec?: number | null;
  error?: string;
}

/** The worker kit's model helper runs on GPU_WORKER_HELPER_PORT next to ComfyUI. */
function helperUrlForWorker(worker: GpuWorkerConfig) {
  return gpuWorkerHelperUrl(worker);
}

/** Model downloads on the worker, including ones started elsewhere. */
async function fetchWorkerDownloads(worker: GpuWorkerConfig): Promise<GpuWorkerDownload[] | null> {
  try {
    const data = await fetchJson<{ downloads?: GpuWorkerDownload[] }>(
      `${helperUrlForWorker(worker)}/api/runpod/helper/downloads`
    );
    return Array.isArray(data.downloads) ? data.downloads : [];
  } catch {
    // Helper down, or an older kit without /downloads.
    return null;
  }
}

export interface GpuWorkerUpdateState {
  state: string;
  message?: string;
  at?: string;
  version?: string;
  pending?: boolean;
}

/**
 * Shared worker token (same as the depot's GPU_WORKER_TOKEN). From the env, or
 * .local/gpu-worker-depot.env (gitignored) where the depot setup keeps it.
 */
function gpuWorkerToken() {
  if (process.env.GPU_WORKER_TOKEN?.trim()) return process.env.GPU_WORKER_TOKEN.trim();
  try {
    const env = readFileSync(join(process.cwd(), ".local", "gpu-worker-depot.env"), "utf8");
    return /^GPU_WORKER_TOKEN=(.+)$/m.exec(env)?.[1]?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Update watcher state on the worker (older kits without it: null). */
async function fetchWorkerUpdateState(worker: GpuWorkerConfig): Promise<GpuWorkerUpdateState | null> {
  try {
    return await fetchJson<GpuWorkerUpdateState>(`${helperUrlForWorker(worker)}/api/worker/update`);
  } catch {
    return null;
  }
}

/**
 * Ask a worker to pull marc's depot now. The request carries no content; the
 * worker installs only what the depot manifest lists and restarts itself only
 * when code changed and its queue is empty.
 */
export async function requestGpuWorkerUpdate(worker: GpuWorkerConfig) {
  const token = gpuWorkerToken();
  if (!token) {
    return { id: worker.id, ok: false, error: "GPU_WORKER_TOKEN not set (.local/gpu-worker-depot.env)" };
  }
  try {
    const res = await fetch(`${helperUrlForWorker(worker)}/api/worker/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as GpuWorkerUpdateState & { error?: string };
    if (res.status === 404) {
      return { id: worker.id, ok: false, error: "worker kit too old (no update endpoint)" };
    }
    if (!res.ok) return { id: worker.id, ok: false, error: data.error || `HTTP ${res.status}` };
    return { id: worker.id, ok: true, update: data };
  } catch (error) {
    return { id: worker.id, ok: false, error: errorMessage(error) };
  }
}

export const GPU_WORKER_LOG_KINDS = ["watch", "comfyui", "comfyui-err", "helper", "helper-err"] as const;
export type GpuWorkerLogKind = (typeof GPU_WORKER_LOG_KINDS)[number];

export interface GpuWorkerLogTail {
  name: string;
  file: string | null;
  size?: number;
  lines: string[];
}

/** Tail of one kit log on the worker (read-only, worker token). */
export async function fetchGpuWorkerLog(
  worker: GpuWorkerConfig,
  name: GpuWorkerLogKind,
  lines = 300
): Promise<GpuWorkerLogTail> {
  const token = gpuWorkerToken();
  if (!token) throw new Error("GPU_WORKER_TOKEN not set (.local/gpu-worker-depot.env)");
  const url = `${helperUrlForWorker(worker)}/api/worker/logs?name=${encodeURIComponent(name)}&lines=${lines}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch((error: unknown) => {
    throw new Error(errorMessage(error));
  });
  if (res.status === 404) throw new Error("worker kit too old (no log endpoint)");
  const data = (await res.json().catch(() => ({}))) as GpuWorkerLogTail & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function getGpuWorkerStatuses() {
  const workers = await getGpuWorkers();
  return Promise.all(
    workers.map(async (worker) => {
      const probe = worker.enabled ? await probeGpuWorker(worker, { fresh: true }) : null;
      return {
        ...worker,
        reserved: pool.reserved.get(worker.id) ?? 0,
        probe,
        downloads: probe?.online ? await fetchWorkerDownloads(worker) : null,
        update: probe?.online ? await fetchWorkerUpdateState(worker) : null,
      };
    })
  );
}
