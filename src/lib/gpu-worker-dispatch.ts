// Pure scheduling logic for the GPU worker pool (no I/O, no Next/"@/" imports so
// `node --test` can load it directly). The server wrapper in gpu-workers.ts
// gathers live status and feeds it here.
//
// One image never spans several GPUs: a job goes to exactly one ComfyUI. The pool
// only raises throughput (more jobs at once) and lets a slow card absorb
// overflow, it does not make a single image faster.

export type GpuWorkerRole = "primary" | "light";
export type GpuWorkload = "full" | "light";

/**
 * The worker kit's helper port. 8189 (next to ComfyUI 8188), not 3000: a
 * colleague's own dev server commonly sits on 3000.
 */
export const GPU_WORKER_HELPER_PORT = 8189;

/** Helper origin for a worker: ComfyUI origin with the port swapped. */
export function gpuWorkerHelperUrl(worker: { url: string }) {
  try {
    const url = new URL(worker.url);
    url.port = String(GPU_WORKER_HELPER_PORT);
    return url.origin;
  } catch {
    return "";
  }
}

export interface GpuWorkerConfig {
  id: string;
  label: string;
  /** ComfyUI origin, e.g. http://10.0.12.34:8188 */
  url: string;
  role: GpuWorkerRole;
  /**
   * Relative throughput, 4080 = 1. Used to estimate when a new job would
   * finish, so a slow card only gets work when waiting on the fast one is
   * worse. Measured with scripts/bench-gpu-workers.mjs.
   */
  speed: number;
  /** Max jobs (running + pending) this worker should hold. */
  maxQueue: number;
  enabled: boolean;
}

export interface GpuWorkerStatus {
  online: boolean;
  /** running + pending jobs reported by ComfyUI /queue */
  queueDepth: number;
  /** model files this request needs that the worker does not have */
  missingFiles: string[];
  error?: string;
}

export interface GpuWorkerCandidate {
  worker: GpuWorkerConfig;
  status: GpuWorkerStatus;
  /** jobs this app has handed the worker that may not be in /queue yet */
  reserved: number;
}

export interface GpuWorkerChoice {
  worker: GpuWorkerConfig;
  load: number;
  expectedSlots: number;
}

export interface GpuWorkerRejection {
  id: string;
  label: string;
  reason: "disabled" | "offline" | "missing-files" | "full";
  detail?: string;
}

export const DEFAULT_WORKER_SPEED = 1;
export const DEFAULT_WORKER_MAX_QUEUE = 4;

/** Effective load: the probe lags behind our own submissions, so take the max. */
export function workerLoad(candidate: GpuWorkerCandidate) {
  return Math.max(candidate.status.queueDepth, candidate.reserved);
}

/**
 * How many "fast-card job lengths" until a new job on this worker finishes.
 * (load + 1) jobs must run, each taking 1/speed.
 */
export function expectedSlots(candidate: GpuWorkerCandidate) {
  const speed = candidate.worker.speed > 0 ? candidate.worker.speed : DEFAULT_WORKER_SPEED;
  return (workerLoad(candidate) + 1) / speed;
}

export function rejectionFor(candidate: GpuWorkerCandidate): GpuWorkerRejection | null {
  const { worker, status } = candidate;
  const base = { id: worker.id, label: worker.label };
  if (!worker.enabled) return { ...base, reason: "disabled" };
  if (!status.online) return { ...base, reason: "offline", detail: status.error };
  if (status.missingFiles.length > 0) {
    return { ...base, reason: "missing-files", detail: status.missingFiles.join(", ") };
  }
  const maxQueue = worker.maxQueue > 0 ? worker.maxQueue : DEFAULT_WORKER_MAX_QUEUE;
  if (workerLoad(candidate) >= maxQueue) return { ...base, reason: "full" };
  return null;
}

function rolePenalty(role: GpuWorkerRole, workload: GpuWorkload) {
  // Prefer the role that matches the workload when finish times tie.
  if (workload === "light") return role === "light" ? 0 : 1;
  return role === "primary" ? 0 : 1;
}

/**
 * Picks the worker that should run the next job.
 *
 * - full jobs (normal 1024px SDXL renders): lowest expected finish time. With a
 *   4080 (speed 1) and a 3060 (speed ~0.4) the 4080 wins until it holds ~2 jobs,
 *   then the 3060 takes the overflow.
 * - light jobs (preview, upscale): any idle light-role worker first, so the fast
 *   card stays free for full renders; otherwise fall back to the full rule.
 *
 * Returns null with the reasons when nothing can take the job.
 */
export function chooseGpuWorker(
  candidates: GpuWorkerCandidate[],
  workload: GpuWorkload = "full"
): { choice: GpuWorkerChoice | null; rejected: GpuWorkerRejection[] } {
  const rejected: GpuWorkerRejection[] = [];
  const eligible: GpuWorkerCandidate[] = [];
  for (const candidate of candidates) {
    const rejection = rejectionFor(candidate);
    if (rejection) rejected.push(rejection);
    else eligible.push(candidate);
  }
  if (eligible.length === 0) return { choice: null, rejected };

  if (workload === "light") {
    const idleLight = eligible
      .filter((c) => c.worker.role === "light" && workerLoad(c) === 0)
      .sort((a, b) => expectedSlots(a) - expectedSlots(b))[0];
    if (idleLight) return { choice: toChoice(idleLight), rejected };
  }

  const best = [...eligible].sort((a, b) => {
    const diff = expectedSlots(a) - expectedSlots(b);
    if (Math.abs(diff) > 1e-9) return diff;
    const role = rolePenalty(a.worker.role, workload) - rolePenalty(b.worker.role, workload);
    if (role !== 0) return role;
    return a.worker.label.localeCompare(b.worker.label);
  })[0];
  return { choice: toChoice(best), rejected };
}

function toChoice(candidate: GpuWorkerCandidate): GpuWorkerChoice {
  return {
    worker: candidate.worker,
    load: workerLoad(candidate),
    expectedSlots: expectedSlots(candidate),
  };
}

/**
 * Classifies a request. Callers can force it; otherwise small, few-step renders
 * (previews) and upscale-only passes count as light.
 */
export function classifyWorkload(params: {
  workload?: string;
  width?: number;
  height?: number;
  num_inference_steps?: number;
  hires_upscale?: number;
}): GpuWorkload {
  if (params.workload === "light" || params.workload === "full") return params.workload;
  const pixels = Number(params.width ?? 0) * Number(params.height ?? 0);
  const steps = Number(params.num_inference_steps ?? 0);
  const hires = Number(params.hires_upscale ?? 0);
  if (hires > 1) return "full";
  if (pixels > 0 && pixels <= 768 * 768) return "light";
  if (steps > 0 && steps <= 8 && pixels <= 1024 * 1024) return "light";
  return "full";
}

/** Model files a request needs, as "<folder>/<name>" (ComfyUI /models/<folder> names). */
export function requiredModelFiles(params: {
  model_name?: string;
  vae_name?: string;
  upscale_model_name?: string;
  hires_upscale?: number;
  loras?: { path?: string }[];
}): string[] {
  const files = new Set<string>();
  const checkpoint = params.model_name?.trim();
  if (checkpoint) files.add(`checkpoints/${checkpoint}`);
  for (const lora of params.loras ?? []) {
    const path = lora.path?.trim();
    if (path) files.add(`loras/${path}`);
  }
  const vae = params.vae_name?.trim();
  if (vae && vae.toLowerCase() !== "automatic" && vae.toLowerCase() !== "none") {
    files.add(`vae/${vae}`);
  }
  const upscaler = params.upscale_model_name?.trim();
  if (upscaler && Number(params.hires_upscale ?? 0) > 1) {
    files.add(`upscale_models/${upscaler}`);
  }
  return [...files];
}

/**
 * Folders a "checkpoints/<name>" requirement may be satisfied from: diffusion-only
 * families (Krea 2, Z-Image, Anima) ship as diffusion_models / unet files, and
 * GGUF builds show up under ComfyUI-GGUF's unet_gguf listing.
 */
export const CHECKPOINT_FOLDERS = ["checkpoints", "diffusion_models", "unet", "unet_gguf"] as const;

/** Given ComfyUI's per-folder file lists, the required files that are absent. */
export function missingModelFiles(
  required: string[],
  available: Record<string, string[] | undefined>
): string[] {
  return required.filter((file) => {
    const slash = file.indexOf("/");
    const folder = file.slice(0, slash);
    const name = file.slice(slash + 1);
    const normalized = name.replace(/\\/g, "/");
    const folders = folder === "checkpoints" ? CHECKPOINT_FOLDERS : [folder];
    const lists = folders.map((f) => available[f]);
    if (lists.some((list) => list?.some((entry) => entry.replace(/\\/g, "/") === normalized))) {
      return false;
    }
    // Unknown folder list (probe failed for that folder) → don't block on it;
    // ComfyUI will report a real missing file when the prompt is validated.
    return lists.every((list) => Array.isArray(list));
  });
}

export function normalizeGpuWorkers(value: unknown): GpuWorkerConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw): GpuWorkerConfig | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Record<string, unknown>;
      const url = String(item.url ?? "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(url)) return null;
      const speed = Number(item.speed);
      const maxQueue = Number(item.maxQueue);
      return {
        id: String(item.id || url),
        label: String(item.label ?? "").trim() || url,
        url,
        role: item.role === "light" ? "light" : "primary",
        speed: Number.isFinite(speed) && speed > 0 ? speed : DEFAULT_WORKER_SPEED,
        maxQueue:
          Number.isFinite(maxQueue) && maxQueue > 0
            ? Math.floor(maxQueue)
            : DEFAULT_WORKER_MAX_QUEUE,
        enabled: item.enabled !== false,
      };
    })
    .filter((worker): worker is GpuWorkerConfig => worker !== null);
}
