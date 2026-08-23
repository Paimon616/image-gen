"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudDownload, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkspaceMedia } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ShareKind = "workspaces" | "characters";

// The subset of the pod-side manifest the picker renders. The manifest carries
// more (the images, the clips and, for a character, its full record), but
// pulling that is the download's job — the list stays light.
interface RemoteShare {
  id: string;
  name: string;
  updatedAt: number;
  sharedBy: string;
  imageCount: number;
  /** Absent on shares pushed before workspaces could hold videos. */
  videoCount?: number;
}

interface SharePod {
  id: string;
  label: string;
  podId: string;
}

interface ShareListResponse {
  pods?: SharePod[];
  podId?: string;
  items?: RemoteShare[];
  error?: string;
}

function formatWhen(value: number) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// The picker for "공유 이미지 다운로드": lists what teammates have pushed to the
// pod and pulls one down into this machine. Shared by the image workspace bar
// and the character studio — only the wording differs.
export function RunpodShareDownloadDialog({
  kind,
  media = "images",
  open,
  onOpenChange,
  onDownloaded,
}: {
  kind: ShareKind;
  /** Which screen opened the dialog. Only the wording depends on it — a
   *  workspace is downloaded whole, images and clips together. */
  media?: WorkspaceMedia;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDownloaded: (id: string) => void;
}) {
  const [pods, setPods] = useState<SharePod[]>([]);
  const [podId, setPodId] = useState("");
  // Read inside the open-effect so re-opening reuses the last chosen pod without
  // making podId a dependency (which would re-list on every selection change).
  const podIdRef = useRef(podId);
  const [items, setItems] = useState<RemoteShare[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");
  // The item awaiting removal confirmation; the nested dialog renders while set.
  const [confirmTarget, setConfirmTarget] = useState<RemoteShare | null>(null);
  const [removing, setRemoving] = useState(false);

  const label = kind === "workspaces" ? "워크스페이스" : "캐릭터";

  const load = useCallback(
    async (targetPodId: string) => {
      setLoading(true);
      setError("");
      try {
        const query = new URLSearchParams({ kind });
        if (targetPodId) query.set("podId", targetPodId);
        const res = await fetch(`/api/runpod/share?${query}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as ShareListResponse;
        setPods(data.pods ?? []);
        if (data.podId) {
          setPodId(data.podId);
          podIdRef.current = data.podId;
        }
        setItems(data.items ?? []);
        setError(data.error ?? "");
      } catch {
        setItems([]);
        setError("RunPod 공유 목록을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [kind]
  );

  // Opening the dialog (re)loads the list. Changing the pod is handled by the
  // selector's own onChange, so podId is deliberately not a dependency here.
  useEffect(() => {
    if (!open) return;
    void (async () => {
      setStatus("");
      await load(podIdRef.current);
    })();
  }, [open, load]);

  const download = useCallback(
    async (item: RemoteShare) => {
      setBusyId(item.id);
      setStatus("");
      setError("");
      try {
        const res = await fetch("/api/runpod/share/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, id: item.id, podId }),
        });
        const data = (await res.json()) as {
          name?: string;
          downloaded?: number;
          imageCount?: number;
          videoCount?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "다운로드에 실패했습니다.");
        setStatus(
          `"${data.name || item.name}" 다운로드 완료 — 이미지 ${
            data.imageCount ?? 0
          }장 · 영상 ${data.videoCount ?? 0}개 (새로 받은 파일 ${
            data.downloaded ?? 0
          }개)`
        );
        onDownloaded(item.id);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "다운로드에 실패했습니다."
        );
      } finally {
        setBusyId("");
      }
    },
    [kind, onDownloaded, podId]
  );

  // Deletes the share off the pod itself, so it disappears for every machine —
  // already-downloaded copies and the sharer's original are untouched.
  const remove = useCallback(async () => {
    if (!confirmTarget) return;
    setRemoving(true);
    setStatus("");
    setError("");
    try {
      const query = new URLSearchParams({ kind, id: confirmTarget.id });
      if (podId) query.set("podId", podId);
      const res = await fetch(`/api/runpod/share?${query}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "공유 제거에 실패했습니다.");
      setItems((prev) => prev.filter((item) => item.id !== confirmTarget.id));
      setStatus(`"${confirmTarget.name || "이름 없음"}" 공유를 제거했습니다.`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "공유 제거에 실패했습니다."
      );
    } finally {
      setRemoving(false);
      setConfirmTarget(null);
    }
  }, [confirmTarget, kind, podId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[92vw] max-w-lg overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>공유 {label} 다운로드</DialogTitle>
          <DialogDescription>
            RunPod에 올라온 {label} 목록입니다. 다운로드하면 {label}와 그 안의
            {kind === "workspaces" ? "이미지·영상이" : "이미지가"} 이 컴퓨터로
            내려받아집니다.
            {kind === "workspaces" && media !== "images"
              ? " 영상은 이 화면에, 이미지는 이미지 생성 화면에 나타납니다."
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
          {pods.length > 1 ? (
            <select
              value={podId}
              onChange={(event) => {
                setPodId(event.target.value);
                podIdRef.current = event.target.value;
                void load(event.target.value);
              }}
              className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
            >
              {pods.map((pod) => (
                <option key={pod.id} value={pod.id}>
                  {pod.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {pods.length === 0 && loading
                ? "포드 확인 중…"
                : pods[0]?.label || "설정된 포드 없음"}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void load(podId)}
            disabled={loading}
          >
            {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            새로고침
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-1.5 overflow-y-auto p-4">
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
          {status && <p className="mb-2 text-xs text-primary">{status}</p>}

          {loading && items.length === 0 ? (
            <p className="flex items-center gap-2 py-8 text-center text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> 불러오는 중…
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">
              아직 공유된 {label}가 없습니다.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {item.name || "이름 없음"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    이미지 {item.imageCount ?? 0}장
                    {kind === "workspaces" ? ` · 영상 ${item.videoCount ?? 0}개` : ""}
                    {item.sharedBy ? ` · ${item.sharedBy}` : ""}
                    {formatWhen(item.updatedAt)
                      ? ` · ${formatWhen(item.updatedAt)}`
                      : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void download(item)}
                  disabled={Boolean(busyId)}
                >
                  {busyId === item.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <CloudDownload />
                  )}
                  다운로드
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  onClick={() => setConfirmTarget(item)}
                  disabled={Boolean(busyId) || removing}
                  aria-label={`"${item.name || "이름 없음"}" 공유 제거`}
                  title="공유 제거"
                >
                  <Trash2 />
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>

      <Dialog
        open={Boolean(confirmTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !removing) setConfirmTarget(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>공유 {label} 제거</DialogTitle>
            <DialogDescription>
              {`"${confirmTarget?.name || "이름 없음"}" 공유를 RunPod에서
              제거할까요? 다른 사람도 더 이상 다운로드할 수 없게 됩니다. 이미
              다운로드한 파일과 공유한 사람의 원본은 삭제되지 않습니다.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmTarget(null)}
              disabled={removing}
            >
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void remove()}
              disabled={removing}
            >
              {removing ? <Loader2 className="animate-spin" /> : <Trash2 />}
              제거
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
