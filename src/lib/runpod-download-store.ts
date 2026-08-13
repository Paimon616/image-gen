import { create } from "zustand";
import {
  reportDownload,
  runpodDownloadEntryId,
} from "@/lib/download-manager-store";

export interface RunpodConnectionStatus {
  checked: boolean;
  comfyReachable: boolean;
  comfyInitializing: boolean;
  helperReachable: boolean;
  helperInitializing: boolean;
  helperOutdated: boolean;
  comfyError: string;
  helperError: string;
  comfyVersion: string;
  podDesiredStatus: string;
}

export interface RunpodDownloadResource {
  type: "checkpoint" | "lora" | "embedding" | "vae" | "upscaler" | "other";
  name: string;
  versionName?: string;
  baseModel?: string;
  url: string;
  modelId?: number;
  modelVersionId?: number;
}

export interface RunpodDownloadItem {
  path: string;
  resource: RunpodDownloadResource;
}

// Fired on the window when a pod's download queue drains (success or error),
// so pages can re-run their file check even if they were unmounted while the
// download ran in the background.
export const RUNPOD_DOWNLOAD_FINISHED_EVENT = "runpod:download-finished";

interface RunpodDownloadState {
  // All maps are keyed by podId so switching pods never cross-contaminates.
  // `downloadingByPod` is true while a pod's queue is draining; `messageByPod`
  // holds a short status line. Per-file progress lives in the Download Manager
  // store, not here.
  downloadingByPod: Record<string, boolean>;
  messageByPod: Record<string, string>;
  pendingRecheckByPod: Record<string, boolean>;
  connectionByPod: Record<string, RunpodConnectionStatus>;

  startDownload: (
    podId: string,
    items: RunpodDownloadItem[],
    opts: { ko: boolean }
  ) => Promise<void>;
  setMessage: (podId: string, message: string) => void;
  clearPendingRecheck: (podId: string) => void;
  setConnection: (podId: string, status: RunpodConnectionStatus) => void;
}

// Per-pod runtime for the appendable download queue. Kept at module scope
// (outside zustand) so it survives page navigation and never triggers a render
// on its own — the store's `downloadingByPod`/`messageByPod` drive the UI.
interface PodRuntime {
  queue: RunpodDownloadItem[];
  inFlight: Set<string>;
  running: boolean;
  activeWorkers: number;
  ko: boolean;
  completed: number;
  failed: number;
  lastError: string;
}

const podRuntimes: Record<string, PodRuntime> = {};
// How many files transfer to a single pod at once. Downloads are network-bound
// (Civitai/HF → pod), so a handful in parallel is a clear win over sequential
// without thrashing the pod's bandwidth.
const MAX_CONCURRENT = 4;

export const useRunpodDownloadStore = create<RunpodDownloadState>((set) => {
  const setMsg = (podId: string, message: string) =>
    set((state) => ({
      messageByPod: { ...state.messageByPod, [podId]: message },
    }));

  const runningMsg = (podId: string) => {
    const rt = podRuntimes[podId];
    if (!rt) return;
    const left = rt.queue.length + rt.inFlight.size;
    setMsg(
      podId,
      rt.ko
        ? `RunPod 다운로드 중 · 남은 ${left}개`
        : `Downloading to RunPod · ${left} left`
    );
  };

  // Transfer a single file to the pod, mirroring progress into the Download
  // Manager. Throws on failure so the worker can mark it errored.
  const downloadOne = async (podId: string, item: RunpodDownloadItem) => {
    const ko = podRuntimes[podId]?.ko ?? false;
    const entryId = runpodDownloadEntryId(podId, item.path);
    reportDownload(entryId, {
      status: "downloading",
      message: ko ? "다운로드 중..." : "Downloading...",
      downloadedBytes: 0,
      totalBytes: null,
      percent: 0,
    });

    const response = await fetch(`/api/runpod/pods/${podId}/download/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: item.resource, targetPath: item.path }),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "RunPod download failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamError = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        const dataLine = event
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const payload = JSON.parse(dataLine.slice(6)) as {
          type?: string;
          path?: string;
          downloaded?: number;
          total?: number;
          percent?: number;
          message?: string;
        };
        if (payload.type === "error") {
          streamError = payload.message || "RunPod download failed";
        }
        if (payload.type === "progress" || payload.type === "status") {
          const total = Number(payload.total ?? 0);
          reportDownload(entryId, {
            downloadedBytes: Number(payload.downloaded ?? 0),
            totalBytes: total > 0 ? total : null,
            percent: Number(payload.percent ?? 0),
            status: "downloading",
          });
        }
      }
    }
    if (streamError) throw new Error(streamError);
    reportDownload(entryId, {
      percent: 100,
      status: "complete",
      message: ko ? "완료" : "Complete",
    });
  };

  // Announce that a pod's queue has fully drained: flip the flags, publish a
  // summary line, and fire the finished event so pages re-check their files.
  const finalize = (podId: string) => {
    const rt = podRuntimes[podId];
    if (!rt) return;
    rt.running = false;

    const summary =
      rt.failed > 0
        ? rt.ko
          ? `${rt.completed}개 완료, ${rt.failed}개 실패${
              rt.lastError ? ` · ${rt.lastError}` : ""
            }`
          : `${rt.completed} done, ${rt.failed} failed${
              rt.lastError ? ` · ${rt.lastError}` : ""
            }`
        : rt.ko
          ? `${rt.completed}개 파일을 RunPod에 다운로드했습니다.`
          : `Downloaded ${rt.completed} file(s) to RunPod.`;

    set((state) => ({
      downloadingByPod: { ...state.downloadingByPod, [podId]: false },
      pendingRecheckByPod: { ...state.pendingRecheckByPod, [podId]: true },
      messageByPod: { ...state.messageByPod, [podId]: summary },
    }));

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(RUNPOD_DOWNLOAD_FINISHED_EVENT, { detail: { podId } })
      );
    }
  };

  // A single worker pulls files off the shared queue until it is empty, then
  // retires. The last worker to retire finalizes the batch.
  const runWorker = async (podId: string) => {
    const rt = podRuntimes[podId];
    if (!rt) return;
    try {
      while (rt.queue.length > 0) {
        const item = rt.queue.shift();
        if (!item) break;
        rt.inFlight.add(item.path);
        runningMsg(podId);
        try {
          await downloadOne(podId, item);
          rt.completed += 1;
        } catch (error) {
          rt.failed += 1;
          rt.lastError =
            error instanceof Error ? error.message : "RunPod download failed";
          reportDownload(runpodDownloadEntryId(podId, item.path), {
            status: "error",
            message: rt.lastError,
          });
        } finally {
          rt.inFlight.delete(item.path);
          runningMsg(podId);
        }
      }
    } finally {
      rt.activeWorkers -= 1;
      if (rt.activeWorkers === 0 && rt.queue.length === 0) {
        finalize(podId);
      }
    }
  };

  // Top the worker pool up to MAX_CONCURRENT (or the number of queued files,
  // whichever is smaller). Safe to call on every enqueue: it spins up more
  // workers when new files arrive but never exceeds the concurrency cap, so
  // downloads run in parallel regardless of whether files were queued all at
  // once or one at a time.
  const spawnWorkers = (podId: string) => {
    const rt = podRuntimes[podId];
    if (!rt) return;
    // Spawn one worker per queued file, capped by remaining concurrency. Newly
    // spawned workers don't shift off the queue synchronously, so compute the
    // count up front rather than re-reading queue.length inside a loop (which
    // would over-spawn). A worker that races to an empty queue simply retires.
    const want = Math.min(MAX_CONCURRENT - rt.activeWorkers, rt.queue.length);
    for (let i = 0; i < want; i += 1) {
      rt.activeWorkers += 1;
      void runWorker(podId);
    }
  };

  return {
    downloadingByPod: {},
    messageByPod: {},
    pendingRecheckByPod: {},
    connectionByPod: {},

    setMessage: (podId, message) => setMsg(podId, message),

    clearPendingRecheck: (podId) =>
      set((state) => ({
        pendingRecheckByPod: { ...state.pendingRecheckByPod, [podId]: false },
      })),

    setConnection: (podId, status) =>
      set((state) => ({
        connectionByPod: { ...state.connectionByPod, [podId]: status },
      })),

    // Enqueue files for download onto a pod. If a batch is already running for
    // this pod the fresh files are appended to the live queue instead of being
    // rejected — so the user can keep checking files and adding downloads while
    // earlier ones are still transferring. Returns as soon as the queue is
    // updated; the transfer itself runs in the background and survives leaving
    // the page.
    startDownload: async (podId, items, { ko }) => {
      if (!podId || items.length === 0) return;

      const rt = (podRuntimes[podId] ??= {
        queue: [],
        inFlight: new Set<string>(),
        running: false,
        activeWorkers: 0,
        ko,
        completed: 0,
        failed: 0,
        lastError: "",
      });
      rt.ko = ko;

      // Skip files already queued or currently transferring on this pod so a
      // repeated Download click never duplicates an in-flight file.
      const known = new Set<string>([
        ...rt.queue.map((item) => item.path),
        ...rt.inFlight,
      ]);
      const fresh = items.filter((item) => !known.has(item.path));
      if (fresh.length === 0) return;

      for (const item of fresh) {
        reportDownload(runpodDownloadEntryId(podId, item.path), {
          label: item.resource.name,
          sublabel: item.path,
          target: podId,
          kind: "runpod",
          downloadedBytes: 0,
          totalBytes: null,
          percent: 0,
          status: "downloading",
          message: ko ? "대기 중" : "Queued",
        });
      }
      rt.queue.push(...fresh);

      set((state) => ({
        downloadingByPod: { ...state.downloadingByPod, [podId]: true },
        pendingRecheckByPod: { ...state.pendingRecheckByPod, [podId]: false },
        messageByPod: {
          ...state.messageByPod,
          [podId]: ko
            ? "RunPod 다운로드를 시작합니다..."
            : "Starting RunPod download...",
        },
      }));

      // Starting fresh (no workers running): reset the batch counters. If a
      // batch is already draining, the newly appended files just join it.
      if (!rt.running) {
        rt.running = true;
        rt.completed = 0;
        rt.failed = 0;
        rt.lastError = "";
      }
      // Fire-and-forget: spawn/top-up workers and return immediately so callers
      // never stay "busy" for the whole transfer and the UI stays usable.
      spawnWorkers(podId);
    },
  };
});
