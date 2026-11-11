"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { importedCivitaiResources, type RunpodMissingFile } from "@/lib/generation-queue-store";
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
    vramFree?: number;
    vramComfy?: number;
    ramTotal?: number;
    ramFree?: number;
    error?: string;
  } | null;
  downloads: WorkerDownload[] | null;
  update?: {
    state: string;
    message?: string;
    at?: string;
    pending?: boolean;
  } | null;
}

interface WorkerDownload {
  path: string;
  downloaded: number;
  total: number | null;
  percent: number | null;
  state: "downloading" | "done" | "error" | "paused";
  bytesPerSec?: number | null;
  error?: string;
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

function DownloadRow({ item, ko }: { item: WorkerDownload; ko: boolean }) {
  const name = item.path.split("/").pop() ?? item.path;
  const size = item.total
    ? `${formatBytes(item.downloaded)} / ${formatBytes(item.total)}`
    : formatBytes(item.downloaded);
  const speed =
    item.state === "downloading" && item.bytesPerSec
      ? ` · ${formatBytes(item.bytesPerSec)}/s`
      : "";
  const label =
    item.state === "done"
      ? ko ? "완료" : "done"
      : item.state === "error"
        ? ko ? "실패" : "failed"
        : item.state === "paused"
          ? ko ? "중단됨 (다시 받으면 이어받기)" : "paused (resumes on next download)"
          : item.percent != null
            ? `${item.percent}%`
            : ko ? "받는 중" : "downloading";
  return (
    <li className="space-y-0.5">
      <div className="flex justify-between gap-2">
        <span className="truncate" title={item.path}>{name}</span>
        <span className="shrink-0 text-muted-foreground">{label}</span>
      </div>
      {item.state !== "done" && (
        <div className="h-1 overflow-hidden rounded bg-muted">
          <div
            className={`h-full ${item.state === "error" ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${item.percent ?? 0}%` }}
          />
        </div>
      )}
      <div className="text-[10px] text-muted-foreground">
        {size}
        {speed}
        {item.error ? ` · ${item.error}` : ""}
      </div>
    </li>
  );
}

const POLL_MS = 5_000;

function gb(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
}

// Live memory of a worker PC (refreshes with the list, every 5s). While a model
// loads, VRAM/RAM climb here — ComfyUI itself reports no load percentage.
function MemoryMeters({ probe, ko }: { probe: NonNullable<WorkerStatus["probe"]>; ko: boolean }) {
  const meters: { label: string; used: number; total: number; note?: string }[] = [];
  if (probe.vramTotal && probe.vramFree !== undefined) {
    meters.push({
      label: "VRAM",
      used: probe.vramTotal - probe.vramFree,
      total: probe.vramTotal,
    });
  }
  if (probe.ramTotal && probe.ramFree !== undefined) {
    meters.push({ label: "RAM", used: probe.ramTotal - probe.ramFree, total: probe.ramTotal });
  }
  if (meters.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 pl-3.5" title={ko ? "워커 PC 메모리 사용량 (5초마다 갱신)" : "Worker PC memory (refreshes every 5s)"}>
      {meters.map((meter) => {
        const percent = Math.min(100, Math.max(0, Math.round((meter.used / meter.total) * 100)));
        return (
          <div key={meter.label} className="min-w-0 space-y-0.5">
            <div className="flex justify-between gap-1 text-[11px] text-muted-foreground">
              <span>
                {meter.label} {percent}%
              </span>
              <span className="truncate">
                {gb(meter.used)} / {gb(meter.total)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${percent >= 90 ? "bg-amber-500" : "bg-primary"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            {meter.note && <div className="truncate text-[10px] text-muted-foreground">{meter.note}</div>}
          </div>
        );
      })}
    </div>
  );
}

function shortDevice(device?: string) {
  if (!device) return "";
  const match = device.match(/RTX\s*\d{4}\w*/i);
  return match ? match[0] : device.split(":").pop()?.trim() ?? device;
}

const UPDATE_STATE_KO: Record<string, string> = {
  checking: "업데이트 확인 중",
  models: "새 모델 받는 중",
  waiting: "업데이트 준비됨, 대기열 비면 재시작",
  restarting: "재시작 중",
  "up-to-date": "최신 상태",
  applied: "최신 적용됨",
  error: "업데이트 실패",
};

function updateLabel(update: WorkerStatus["update"], ko: boolean) {
  if (!update) return "";
  if (update.pending) return ko ? "업데이트 요청됨" : "update requested";
  if (update.state === "unknown") return "";
  const label = ko ? UPDATE_STATE_KO[update.state] ?? update.state : update.state;
  return update.state === "error" && update.message ? `${label}: ${update.message}` : label;
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
  const [updateNote, setUpdateNote] = useState<Record<string, string>>({});
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
        // Civitai-imported resources make a missing checkpoint/LoRA downloadable
        // on the worker itself (it fetches from Civitai with the app's key).
        body: JSON.stringify({ params, resources: importedCivitaiResources() }),
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

  const requestUpdate = useCallback(
    async (workerId: string) => {
      setUpdateNote((prev) => ({ ...prev, [workerId]: ko ? "업데이트 요청 중..." : "Requesting update..." }));
      try {
        const res = await fetch("/api/gpu-workers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update", workerId }),
        });
        const data = (await res.json()) as {
          results?: { ok: boolean; error?: string }[];
          error?: string;
        };
        const result = data.results?.[0];
        const note = !res.ok
          ? data.error || `HTTP ${res.status}`
          : result?.ok
            ? ""
            : (ko ? "요청 실패: " : "Request failed: ") + (result?.error ?? "unknown");
        setUpdateNote((prev) => ({ ...prev, [workerId]: note }));
      } catch (err) {
        setUpdateNote((prev) => ({
          ...prev,
          [workerId]: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [ko]
  );

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
          const updateText = updateNote[worker.id] || updateLabel(worker.update, ko);
          return (
            <li key={worker.id} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2">
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
                {online && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ml-1.5 h-5 px-1.5 text-[11px]"
                    title={
                      ko
                        ? "맥의 depot에서 노드, 모델, 키트를 지금 가져오게 함 (depot 실행 필요)"
                        : "Pull nodes, models and kit from this Mac's depot now (depot must be running)"
                    }
                    onClick={() => void requestUpdate(worker.id)}
                  >
                    {ko ? "업데이트" : "Update"}
                  </Button>
                )}
                {online && (
                  <a
                    href={`/api/gpu-workers/logs?workerId=${encodeURIComponent(worker.id)}&name=watch`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1 text-[11px] underline-offset-2 hover:underline"
                    title={ko ? "워커 로그 보기 (새 탭)" : "Worker logs (new tab)"}
                  >
                    {ko ? "로그" : "Logs"}
                  </a>
                )}
              </span>
            </div>
            {online && worker.probe && <MemoryMeters probe={worker.probe} ko={ko} />}
            {updateText && <p className="pl-3.5 text-muted-foreground">{updateText}</p>}
            </li>
          );
        })}
      </ul>

      {workers.some((worker) => worker.downloads && worker.downloads.length > 0) && (
        <div className="space-y-1.5 border-t border-border pt-2">
          <span className="text-muted-foreground">
            {ko ? "워커 다운로드 (5초마다 갱신)" : "Worker downloads (refreshes every 5s)"}
          </span>
          {workers
            .filter((worker) => worker.downloads && worker.downloads.length > 0)
            .map((worker) => (
              <ul key={worker.id} className="space-y-1.5">
                {workers.length > 1 && <li className="font-medium">{worker.label}</li>}
                {worker.downloads!.map((item) => (
                  <DownloadRow key={item.path} item={item} ko={ko} />
                ))}
              </ul>
            ))}
        </div>
      )}

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
