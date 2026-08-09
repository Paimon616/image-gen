import { create } from "zustand";

// Progress for a single file being downloaded onto a RunPod pod.
export interface RunpodDownloadFileProgress {
  downloadedBytes: number;
  totalBytes: number;
  filePercent: number;
  done: boolean;
}

// Aggregate progress for a whole download batch (one entry per pod).
export interface RunpodDownloadProgress {
  total: number;
  completed: number;
  currentPath: string;
  downloadedBytes: number;
  totalBytes: number;
  filePercent: number;
  files: Record<string, RunpodDownloadFileProgress>;
}

export interface RunpodConnectionStatus {
  checked: boolean;
  comfyReachable: boolean;
  comfyInitializing: boolean;
  helperReachable: boolean;
  helperInitializing: boolean;
  comfyError: string;
  helperError: string;
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

// Fired on the window when a pod's download batch settles (success or error),
// so pages can re-run their file check even if they were unmounted while the
// download ran in the background.
export const RUNPOD_DOWNLOAD_FINISHED_EVENT = "runpod:download-finished";

interface RunpodDownloadState {
  // All maps are keyed by podId so switching pods never cross-contaminates.
  progressByPod: Record<string, RunpodDownloadProgress | null>;
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

function emptyFileProgress(): RunpodDownloadFileProgress {
  return { downloadedBytes: 0, totalBytes: 0, filePercent: 0, done: false };
}

export const useRunpodDownloadStore = create<RunpodDownloadState>((set, get) => ({
  progressByPod: {},
  downloadingByPod: {},
  messageByPod: {},
  pendingRecheckByPod: {},
  connectionByPod: {},

  setMessage: (podId, message) =>
    set((state) => ({
      messageByPod: { ...state.messageByPod, [podId]: message },
    })),

  clearPendingRecheck: (podId) =>
    set((state) => ({
      pendingRecheckByPod: { ...state.pendingRecheckByPod, [podId]: false },
    })),

  setConnection: (podId, status) =>
    set((state) => ({
      connectionByPod: { ...state.connectionByPod, [podId]: status },
    })),

  // Runs the whole download batch at module scope so it survives page
  // navigation: unmounting the page no longer aborts the transfer or discards
  // its progress. Up to 3 files download concurrently, mirroring the previous
  // in-component implementation.
  startDownload: async (podId, items, { ko }) => {
    if (!podId || items.length === 0) return;
    // Guard against a second start (e.g. the user navigates back and clicks
    // Download again) while a batch for this pod is still running.
    if (get().downloadingByPod[podId]) return;

    const initialFileProgress: Record<string, RunpodDownloadFileProgress> =
      Object.fromEntries(items.map((item) => [item.path, emptyFileProgress()]));

    set((state) => ({
      downloadingByPod: { ...state.downloadingByPod, [podId]: true },
      pendingRecheckByPod: { ...state.pendingRecheckByPod, [podId]: false },
      messageByPod: {
        ...state.messageByPod,
        [podId]: ko ? "RunPod 다운로드를 시작합니다..." : "Starting RunPod download...",
      },
      progressByPod: {
        ...state.progressByPod,
        [podId]: {
          total: items.length,
          completed: 0,
          currentPath: items[0]?.path ?? "",
          downloadedBytes: 0,
          totalBytes: 0,
          filePercent: 0,
          files: initialFileProgress,
        },
      },
    }));

    const setMsg = (message: string) =>
      set((state) => ({
        messageByPod: { ...state.messageByPod, [podId]: message },
      }));

    const updateFileProgress = (
      path: string,
      patch: Partial<RunpodDownloadFileProgress>
    ) => {
      set((state) => {
        const current = state.progressByPod[podId];
        const files = {
          ...(current?.files ?? initialFileProgress),
          [path]: {
            ...(current?.files[path] ?? emptyFileProgress()),
            ...patch,
          },
        };
        const values = Object.values(files);
        const downloadedBytes = values.reduce(
          (sum, file) => sum + file.downloadedBytes,
          0
        );
        const totalBytes = values.reduce((sum, file) => sum + file.totalBytes, 0);
        const completed = values.filter((file) => file.done).length;
        return {
          progressByPod: {
            ...state.progressByPod,
            [podId]: {
              total: items.length,
              completed,
              currentPath: path,
              downloadedBytes,
              totalBytes,
              filePercent:
                totalBytes > 0
                  ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                  : Math.max(...values.map((file) => file.filePercent), 0),
              files,
            },
          },
        };
      });
    };

    const downloadOne = async (index: number) => {
      const item = items[index];
      updateFileProgress(item.path, emptyFileProgress());
      setMsg(
        ko
          ? `RunPod 다운로드 중 ${index + 1}/${items.length}: ${item.path}`
          : `Downloading to RunPod ${index + 1}/${items.length}: ${item.path}`
      );
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
            updateFileProgress(item.path, {
              downloadedBytes: Number(payload.downloaded ?? 0),
              totalBytes: Number(payload.total ?? 0),
              filePercent: Number(payload.percent ?? 0),
            });
          }
          if (payload.type === "complete") {
            updateFileProgress(item.path, { filePercent: 100 });
          }
        }
      }
      if (streamError) throw new Error(streamError);
      updateFileProgress(item.path, { filePercent: 100, done: true });
    };

    try {
      let nextDownloadIndex = 0;
      const workerCount = Math.min(3, items.length);
      await Promise.all(
        Array.from({ length: workerCount }, async () => {
          while (nextDownloadIndex < items.length) {
            const index = nextDownloadIndex;
            nextDownloadIndex += 1;
            await downloadOne(index);
          }
        })
      );
      setMsg(
        ko
          ? `${items.length}개 파일을 RunPod에 다운로드했습니다.`
          : `Downloaded ${items.length} file(s) to RunPod.`
      );
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "RunPod download failed");
    } finally {
      set((state) => ({
        downloadingByPod: { ...state.downloadingByPod, [podId]: false },
        progressByPod: { ...state.progressByPod, [podId]: null },
        pendingRecheckByPod: { ...state.pendingRecheckByPod, [podId]: true },
      }));
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(RUNPOD_DOWNLOAD_FINISHED_EVENT, { detail: { podId } })
        );
      }
    }
  },
}));
