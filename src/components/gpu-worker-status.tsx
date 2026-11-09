"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { RunpodMissingFile } from "@/lib/generation-queue-store";
import {
  RUNPOD_DOWNLOAD_FINISHED_EVENT,
  useRunpodDownloadStore,
} from "@/lib/runpod-download-store";
import type { GenerationParams } from "@/lib/types";

interface WorkerStatus {
  id: string;
  label: string;
  url: string;
  role: "primary" | "light";
  maxQueue: number;
  enabled: boolean;
  reserved: number;
  probe: {
    online: boolean;
    queueRunning: number;
    queuePending: number;
    device?: string;
    vramTotal?: number;
    error?: string;
  } | null;
}

const POLL_MS = 5_000;

function shortDevice(device?: string) {
  if (!device) return "";
  const match = device.match(/RTX\s*\d{4}\w*/i);
  return match ? match[0] : device.split(":").pop()?.trim() ?? device;
}

/** Worker whose helper takes file checks/downloads: online primary first. */
function pickCheckWorker(list: WorkerStatus[]) {
  const usable = list.filter((worker) => worker.enabled && worker.probe?.online);
  return (usable.find((worker) => worker.role === "primary") ?? usable[0])?.id ?? "";
}

/**
 * Live GPU worker list for the "workers" generation target, plus the missing
 * model files on the checked worker with a Download button. Downloads go
 * through the same RunPod helper API (the worker kit runs a compatible helper),
 * so Civitai/HuggingFace files land directly on the worker PC.
 */
export function GpuWorkerStatus({
  ko,
  params,
  missing,
  onSlotsChange,
  onCheckWorkerChange,
  onMissingChange,
}: {
  ko: boolean;
  params: GenerationParams;
  missing: RunpodMissingFile[];
  onSlotsChange: (slots: number) => void;
  onCheckWorkerChange: (workerId: string) => void;
  onMissingChange: (missing: RunpodMissingFile[]) => void;
}) {
  const [workers, setWorkers] = useState<WorkerStatus[] | null>(null);
  const [error, setError] = useState("");
  const [checkWorkerId, setCheckWorkerId] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState("");
  const startDownload = useRunpodDownloadStore((state) => state.startDownload);
  const downloading = useRunpodDownloadStore((state) =>
    checkWorkerId ? state.downloadingByPod[checkWorkerId] ?? false : false
  );
  const downloadMessage = useRunpodDownloadStore((state) =>
    checkWorkerId ? state.messageByPod[checkWorkerId] ?? "" : ""
  );

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const res = await fetch("/api/gpu-workers", { cache: "no-store" });
        const data = (await res.json()) as { workers?: WorkerStatus[]; error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (stopped) return;
        const list = data.workers ?? [];
        setWorkers(list);
        setError("");
        const slots = list
          .filter((worker) => worker.enabled && worker.probe?.online)
          .reduce((sum, worker) => sum + Math.max(1, worker.maxQueue), 0);
        onSlotsChange(Math.max(1, slots));
        const nextCheck = pickCheckWorker(list);
        setCheckWorkerId(nextCheck);
        onCheckWorkerChange(nextCheck);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [onSlotsChange, onCheckWorkerChange]);

  const checkFiles = useCallback(async () => {
    if (!checkWorkerId) return;
    setChecking(true);
    setCheckMessage(ko ? "모델 파일 확인 중..." : "Checking model files...");
    try {
      const res = await fetch(`/api/runpod/pods/${checkWorkerId}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params, resources: [] }),
      });
      const data = (await res.json()) as { missing?: RunpodMissingFile[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const list = Array.isArray(data.missing) ? data.missing : [];
      onMissingChange(list);
      setCheckMessage(
        list.length === 0
          ? ko ? "필요한 모델 파일이 모두 있음" : "All required model files are present."
          : ko ? `누락 파일 ${list.length}개` : `${list.length} file(s) missing`
      );
    } catch (err) {
      setCheckMessage(
        (ko ? "파일 확인 실패 (워커 헬퍼 응답 없음?): " : "File check failed (worker helper down?): ") +
          (err instanceof Error ? err.message : String(err))
      );
    } finally {
      setChecking(false);
    }
  }, [checkWorkerId, ko, onMissingChange, params]);

  // Re-check once a download batch for this worker settles.
  useEffect(() => {
    const onFinished = (event: Event) => {
      const podId = (event as CustomEvent<{ podId?: string }>).detail?.podId;
      if (podId && podId === checkWorkerId) void checkFiles();
    };
    window.addEventListener(RUNPOD_DOWNLOAD_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(RUNPOD_DOWNLOAD_FINISHED_EVENT, onFinished);
  }, [checkFiles, checkWorkerId]);

  const downloadable = missing.filter((item) => item.downloadable === true);

  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!workers) {
    return <p className="text-xs text-muted-foreground">{ko ? "워커 확인 중..." : "Checking workers..."}</p>;
  }
  if (workers.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {ko
          ? "등록된 GPU 워커 없음. 설정 > 팟 > GPU 워커에서 추가 (docs/gpu-workers.md)"
          : "No GPU workers. Add them in Settings → Pods → GPU workers (docs/gpu-workers.md)."}
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-border bg-card/60 p-2 text-xs">
      <ul className="space-y-1">
        {workers.map((worker) => {
          const online = worker.enabled && worker.probe?.online;
          const queue = worker.probe ? worker.probe.queueRunning + worker.probe.queuePending : 0;
          return (
            <li key={worker.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    online ? "bg-emerald-500" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="truncate font-medium">{worker.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {worker.role === "light" ? (ko ? "보조" : "light") : ko ? "주력" : "primary"}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground">
                {!worker.enabled
                  ? ko
                    ? "비활성"
                    : "disabled"
                  : online
                    ? `${shortDevice(worker.probe?.device)} · ${ko ? "대기열" : "queue"} ${Math.max(queue, worker.reserved)}`
                    : ko
                      ? "꺼짐"
                      : "offline"}
              </span>
            </li>
          );
        })}
      </ul>

      {checkWorkerId && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {ko ? "모델 파일" : "Model files"}
            </span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                disabled={checking || downloading}
                onClick={() => void checkFiles()}
              >
                {ko ? "확인" : "Check"}
              </Button>
              {downloadable.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  disabled={downloading}
                  onClick={() =>
                    void startDownload(
                      checkWorkerId,
                      downloadable.map((item) => ({ path: item.path, resource: item.resource })),
                      { ko }
                    )
                  }
                >
                  {downloading
                    ? ko ? "다운로드 중..." : "Downloading..."
                    : ko ? `다운로드 ${downloadable.length}개` : `Download ${downloadable.length}`}
                </Button>
              )}
            </div>
          </div>
          {missing.length > 0 && (
            <ul className="space-y-0.5 text-destructive">
              {missing.map((item) => (
                <li key={item.path} className="truncate">
                  {item.path}
                  {item.downloadable !== true && (ko ? " (자동 다운로드 불가)" : " (no download source)")}
                </li>
              ))}
            </ul>
          )}
          {(downloadMessage || checkMessage) && (
            <p className="text-muted-foreground">{downloadMessage || checkMessage}</p>
          )}
        </div>
      )}
    </div>
  );
}
