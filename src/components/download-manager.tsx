"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  DownloadCloud,
  HardDrive,
  Loader2,
  Server,
  Trash2,
  XCircle,
} from "lucide-react";
import { useStore } from "@/lib/store";
import {
  useDownloadManagerStore,
  type DownloadManagerEntry,
} from "@/lib/download-manager-store";
import { Button } from "@/components/ui/button";

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function targetLabel(entry: DownloadManagerEntry, ko: boolean) {
  if (entry.kind === "runpod") {
    return entry.target ? `RunPod · ${entry.target}` : "RunPod";
  }
  return ko ? "로컬 ComfyUI" : "Local ComfyUI";
}

function bytesText(entry: DownloadManagerEntry) {
  if (entry.totalBytes && entry.totalBytes > 0) {
    return `${formatBytes(entry.downloadedBytes)} / ${formatBytes(entry.totalBytes)}`;
  }
  if (entry.downloadedBytes > 0) return formatBytes(entry.downloadedBytes);
  return "";
}

function EntryCard({
  entry,
  ko,
  onRemove,
}: {
  entry: DownloadManagerEntry;
  ko: boolean;
  onRemove: (id: string) => void;
}) {
  const percent = Math.max(0, Math.min(100, entry.percent ?? 0));
  const indeterminate = entry.status === "downloading" && entry.percent === null;
  const TargetIcon = entry.kind === "runpod" ? Server : HardDrive;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {entry.status === "downloading" && (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            )}
            {entry.status === "complete" && (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            )}
            {entry.status === "error" && (
              <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            )}
            <span className="min-w-0 truncate text-sm font-semibold">
              {entry.label || (ko ? "(이름 없음)" : "(unnamed)")}
            </span>
          </div>
          {entry.sublabel && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {entry.sublabel}
            </div>
          )}
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <TargetIcon className="h-3.5 w-3.5" />
            {targetLabel(entry, ko)}
          </div>
        </div>
        {entry.status !== "downloading" && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => onRemove(entry.id)}
            aria-label={ko ? "목록에서 제거" : "Remove from list"}
            title={ko ? "목록에서 제거" : "Remove from list"}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {entry.status === "downloading" && (
        <div className="mt-2.5 grid gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full rounded-full bg-primary transition-all ${
                indeterminate ? "w-1/3 animate-pulse" : ""
              }`}
              style={indeterminate ? undefined : { width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span className="min-w-0 truncate">{entry.message}</span>
            <span className="shrink-0 tabular-nums">
              {bytesText(entry)}
              {entry.percent !== null ? `${bytesText(entry) ? " · " : ""}${Math.round(percent)}%` : ""}
            </span>
          </div>
        </div>
      )}

      {entry.status !== "downloading" && entry.message && (
        <div
          className={`mt-2 truncate text-[11px] ${
            entry.status === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {entry.message}
        </div>
      )}
    </div>
  );
}

export function DownloadManager() {
  const language = useStore((state) => state.language);
  const ko = language === "ko";
  const entries = useDownloadManagerStore((state) => state.entries);
  const remove = useDownloadManagerStore((state) => state.remove);
  const clearFinished = useDownloadManagerStore((state) => state.clearFinished);

  const { active, finished } = useMemo(() => {
    const all = Object.values(entries);
    return {
      // Keep active downloads in a stable start order. Sorting by updatedAt
      // would make whichever entry just received a progress tick jump around
      // the list on every frame.
      active: all
        .filter((entry) => entry.status === "downloading")
        .sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id)),
      // Finished entries no longer update, so updatedAt is frozen — most
      // recently finished first is stable here.
      finished: all
        .filter((entry) => entry.status !== "downloading")
        .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
    };
  }, [entries]);

  return (
    <main className="flex h-screen flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <DownloadCloud className="h-5 w-5" />
              {ko ? "다운로드 매니저" : "Download Manager"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {ko
                ? "모델·리소스 다운로드 현황을 여기서 확인하세요. 다운로드 중에도 이미지·비디오 생성 화면에서 계속 작업할 수 있습니다."
                : "Track all model and resource downloads here. You can keep working on the Image and Video pages while downloads run."}
            </p>
          </div>
          {finished.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              onClick={clearFinished}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {ko ? "완료 항목 지우기" : "Clear finished"}
            </Button>
          )}
        </header>

        {active.length === 0 && finished.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <DownloadCloud className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">
              {ko ? "진행 중인 다운로드가 없습니다." : "No downloads yet."}
            </p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground/80">
              {ko
                ? "이미지·비디오 생성 화면에서 누락된 모델을 다운로드하면 여기에 표시됩니다."
                : "Downloads started from the Image or Video pages will appear here."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {active.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {ko ? `진행 중 (${active.length})` : `In progress (${active.length})`}
                </h2>
                <div className="space-y-2">
                  {active.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} ko={ko} onRemove={remove} />
                  ))}
                </div>
              </section>
            )}

            {finished.length > 0 && (
              <section>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {ko ? `완료됨 (${finished.length})` : `Finished (${finished.length})`}
                </h2>
                <div className="space-y-2">
                  {finished.map((entry) => (
                    <EntryCard key={entry.id} entry={entry} ko={ko} onRemove={remove} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
