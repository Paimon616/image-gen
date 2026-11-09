"use client";

import { useEffect, useState } from "react";

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

/**
 * Live GPU worker list for the "workers" generation target. Reports how many
 * jobs the pool can take at once so the client queue can run that many in
 * parallel (the server still picks the worker per job).
 */
export function GpuWorkerStatus({
  ko,
  onSlotsChange,
}: {
  ko: boolean;
  onSlotsChange: (slots: number) => void;
}) {
  const [workers, setWorkers] = useState<WorkerStatus[] | null>(null);
  const [error, setError] = useState("");

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
  }, [onSlotsChange]);

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
          ? "등록된 GPU 워커 없음. 설정 > GPU 워커에서 추가 (docs/gpu-workers.md)"
          : "No GPU workers. Add them in Settings → GPU workers (docs/gpu-workers.md)."}
      </p>
    );
  }

  return (
    <ul className="space-y-1 rounded-md border border-border bg-card/60 p-2 text-xs">
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
  );
}
