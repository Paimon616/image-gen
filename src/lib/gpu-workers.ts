import "server-only";

import {
  chooseGpuWorker,
  classifyWorkload,
  missingModelFiles,
  requiredModelFiles,
  type GpuWorkerCandidate,
  type GpuWorkerConfig,
  type GpuWorkerRejection,
  type GpuWorkload,
} from "@/lib/gpu-worker-dispatch";
import { readSettings } from "@/lib/settings";
import type { GenerationParams } from "@/lib/types";

// Server side of the GPU worker pool: live probes of each remote ComfyUI,
// in-flight reservations, and prompt → worker bookkeeping for cancel. The
// scheduling rule itself is the pure chooseGpuWorker().

const PROBE_TIMEOUT_MS = Number(process.env.GPU_WORKER_PROBE_TIMEOUT_MS ?? 2_000);
const PROBE_CACHE_MS = 2_000;
const MODEL_LIST_CACHE_MS = 30_000;

export interface GpuWorkerProbe {
  online: boolean;
  queueRunning: number;
  queuePending: number;
  device?: string;
  vramTotal?: number;
  vramFree?: number;
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
        system?: { comfyui_version?: string };
        devices?: { name?: string; vram_total?: number; vram_free?: number }[];
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
    .catch(() => undefined);
  pool.modelLists.set(key, { at: Date.now(), value });
  return value;
}

/** Drop cached model lists, e.g. after the worker synced new files. */
export function invalidateGpuWorkerModels(workerId?: string) {
  for (const key of pool.modelLists.keys()) {
    if (!workerId || key.startsWith(`${workerId}:`)) pool.modelLists.delete(key);
  }
}

async function workerMissingFiles(worker: GpuWorkerConfig, required: string[]) {
  if (required.length === 0) return [];
  const folders = [...new Set(required.map((file) => file.slice(0, file.indexOf("/"))))];
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

export async function getGpuWorkerStatuses() {
  const workers = await getGpuWorkers();
  return Promise.all(
    workers.map(async (worker) => ({
      ...worker,
      reserved: pool.reserved.get(worker.id) ?? 0,
      probe: worker.enabled ? await probeGpuWorker(worker, { fresh: true }) : null,
    }))
  );
}
