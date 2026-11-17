"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Power, PowerOff, RotateCw, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type ServiceId = "comfyui" | "a1111" | "forge";

interface ServiceStatus {
  id: ServiceId;
  label: string;
  url: string;
  port: number;
  installed: boolean;
  running: boolean;
  starting: boolean;
  startedAt: number | null;
  startedBy: "launcher" | "app" | null;
  autoStart: boolean;
  progress: {
    percent: number;
    stage: string;
    lastLine: string;
    expectedMs: number | null;
  } | null;
}

interface LauncherStatus {
  launcher: { running: boolean; startedAt: number | null };
  services: ServiceStatus[];
}

const COLLAPSE_KEY = "launcher-panel-collapsed";

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// "실행 관리" group shown at the top of the image page's Local tab: status of
// the local backends plus start/stop/restart and launcher auto-start toggles.
export function LauncherPanel({ ko }: { ko: boolean }) {
  const [status, setStatus] = useState<LauncherStatus | null>(null);
  const [busy, setBusy] = useState<Partial<Record<ServiceId, string>>>({});
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Read after mount (not in the initializer) so SSR and hydration agree.
    const t = setTimeout(() => {
      try {
        setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/launcher", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as LauncherStatus);
    } catch {
      // Transient; keep the last known status.
    }
  }, []);

  const anyBooting = Boolean(
    status?.services.some((s) => s.starting) || Object.keys(busy).length > 0
  );

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const interval = setInterval(() => void refresh(), anyBooting ? 2_000 : 10_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [refresh, anyBooting]);

  // Tick the boot timers only while something is starting.
  useEffect(() => {
    if (!anyBooting) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [anyBooting]);

  const act = async (service: ServiceId, action: "start" | "stop" | "restart") => {
    setError("");
    setBusy((prev) => ({ ...prev, [service]: action }));
    try {
      const res = await fetch("/api/launcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError((data as { error?: string }).error || "Failed.");
      else setStatus(data as LauncherStatus);
    } catch {
      setError(ko ? "요청에 실패했습니다." : "Request failed.");
    } finally {
      setBusy((prev) => {
        const next = { ...prev };
        delete next[service];
        return next;
      });
    }
  };

  const toggleAutoStart = async (service: ServiceId, value: boolean) => {
    setStatus((prev) =>
      prev
        ? {
            ...prev,
            services: prev.services.map((s) => (s.id === service ? { ...s, autoStart: value } : s)),
          }
        : prev
    );
    try {
      const res = await fetch("/api/launcher", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoStart: { [service]: value } }),
      });
      if (res.ok) setStatus((await res.json()) as LauncherStatus);
    } catch {}
  };

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const services = status?.services ?? [];
  const comfy = services.find((s) => s.id === "comfyui");
  const needsAttention = Boolean(comfy && !comfy.running);

  const summary = services
    .map((s) =>
      `${s.label} ${
        s.running ? (ko ? "켜짐" : "on") : s.starting ? (ko ? "시작 중" : "starting") : ko ? "꺼짐" : "off"
      }`
    )
    .join(" · ");

  return (
    <div
      className={`rounded-md border p-3 ${
        needsAttention ? "border-sky-500/40 bg-sky-500/10" : "border-border bg-card/60"
      }`}
    >
      <button
        type="button"
        onClick={toggleCollapsed}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={!collapsed}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <Server className="h-4 w-4 shrink-0 text-sky-600" />
        <span className="text-sm font-semibold">{ko ? "실행 관리" : "Launcher"}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">
          {status ? summary : ko ? "확인 중..." : "Checking..."}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2">
          {services.map((s) => {
            const action = busy[s.id];
            const dot = s.running
              ? "bg-[var(--success)]"
              : s.starting || action
                ? "bg-primary animate-pulse"
                : "bg-muted-foreground/40";
            const stateText = s.running
              ? ko
                ? "실행 중"
                : "Running"
              : s.starting
                ? `${ko ? "시작 중" : "Starting"}${s.startedAt ? " " + formatElapsed(now - s.startedAt) : ""}`
                : !s.installed
                  ? ko
                    ? "설치 안 됨"
                    : "Not installed"
                  : ko
                    ? "꺼짐"
                    : "Stopped";
            const live = s.running || s.starting;
            return (
              <div key={s.id} className="rounded-md border border-border/60 bg-background/60 px-2.5 py-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-[11px] text-muted-foreground">:{s.port}</span>
                  <span className="text-xs text-muted-foreground">{stateText}</span>
                  <div className="ml-auto flex items-center gap-1">
                    {!live && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 gap-1 px-2.5 text-xs"
                        disabled={Boolean(action) || !s.installed}
                        onClick={() => void act(s.id, "start")}
                      >
                        {action === "start" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Power className="h-3.5 w-3.5" />
                        )}
                        {ko ? "켜기" : "Start"}
                      </Button>
                    )}
                    {live && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={Boolean(action)}
                          onClick={() => void act(s.id, "restart")}
                          title={ko ? "재시작" : "Restart"}
                        >
                          {action === "restart" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCw className="h-3.5 w-3.5" />
                          )}
                          {ko ? "재시작" : "Restart"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={Boolean(action)}
                          onClick={() => void act(s.id, "stop")}
                          title={ko ? "끄기 (VRAM 반환)" : "Stop (frees VRAM)"}
                        >
                          {action === "stop" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <PowerOff className="h-3.5 w-3.5" />
                          )}
                          {ko ? "끄기" : "Stop"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {s.starting && s.progress && (
                  <BootProgressBar
                    ko={ko}
                    progress={s.progress}
                    now={now}
                    elapsedMs={s.startedAt ? now - s.startedAt : null}
                  />
                )}
                <label className="mt-1.5 flex cursor-pointer items-center gap-2 pl-4 text-[11px] text-muted-foreground">
                  <Switch
                    size="sm"
                    checked={s.autoStart}
                    disabled={!s.installed}
                    onCheckedChange={(value) => void toggleAutoStart(s.id, value)}
                  />
                  {ko ? "런처 실행 시 자동 시작" : "Auto-start with launcher"}
                </label>
              </div>
            );
          })}

          {error && <p className="text-xs text-red-600 whitespace-pre-wrap">{error}</p>}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {ko
              ? "자동 시작을 끈 엔진은 필요할 때 켜면 됩니다. A1111/Forge는 해당 백엔드로 생성하면 자동으로 켜집니다."
              : "Engines without auto-start can be started here when needed. A1111/Forge also start automatically when you generate with them."}
          </p>
        </div>
      )}
    </div>
  );
}

function BootProgressBar({
  ko,
  progress,
  now,
  elapsedMs,
}: {
  ko: boolean;
  progress: NonNullable<ServiceStatus["progress"]>;
  now: number;
  elapsedMs: number | null;
}) {
  // Between server updates, creep forward a little (asymptotically, max +6%)
  // so a long stage never looks frozen. Resets whenever the server moves on.
  const [anchor, setAnchor] = useState({ percent: progress.percent, at: now });
  if (anchor.percent !== progress.percent) {
    setAnchor({ percent: progress.percent, at: now });
  }
  const creep = 6 * (1 - Math.exp(-Math.max(0, now - anchor.at) / 20_000));
  const shown = Math.min(97, progress.percent + creep);

  const remainingMs =
    progress.expectedMs && elapsedMs !== null ? progress.expectedMs - elapsedMs : null;
  const eta =
    remainingMs === null
      ? ko
        ? "첫 측정 중"
        : "first run, measuring"
      : remainingMs > 1_000
        ? `${ko ? "약" : "~"} ${Math.ceil(remainingMs / 1000)}${ko ? "초 남음" : "s left"}`
        : ko
          ? "거의 완료"
          : "almost done";
  return (
    <div className="mt-2 space-y-1.5 pl-4">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex min-w-0 items-center gap-1.5 font-medium text-primary">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          <span className="truncate">{progress.stage}</span>
        </span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {Math.floor(shown)}% · {eta}
        </span>
      </div>
      <div
        className="relative h-2 rounded-full bg-secondary ring-1 ring-inset ring-primary/10"
        role="progressbar"
        aria-valuenow={Math.floor(shown)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="boot-progress-fill relative h-full overflow-hidden rounded-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${shown}%` }}
        >
          <div className="boot-progress-sweep absolute inset-y-0 left-0 w-1/2" />
        </div>
        <span
          className="boot-progress-head pointer-events-none absolute top-1/2 h-2.5 w-2.5 rounded-full transition-[left] duration-1000 ease-linear"
          style={{ left: `${shown}%` }}
        />
      </div>
      {progress.lastLine && (
        <p className="truncate font-mono text-[10px] text-muted-foreground" title={progress.lastLine}>
          {progress.lastLine}
        </p>
      )}
    </div>
  );
}
