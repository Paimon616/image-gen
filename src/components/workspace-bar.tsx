"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Cloud,
  CloudDownload,
  CloudOff,
  FolderX,
  FolderPlus,
  GripVertical,
  Layers,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { UNGROUPED_WORKSPACE_ID, type WorkspaceSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { RunpodShareDownloadDialog } from "@/components/runpod-share-download";

// A Korean/Japanese/Chinese IME fires a confirming Enter (isComposing / keyCode
// 229) before the real submit Enter. Treating both as submit double-fires the
// handler, so ignore the composition-confirm keystroke.
function isImeConfirmEnter(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

function WorkspaceChip({
  workspace,
  active,
  ko,
  dragging,
  shared,
  sharing,
  shareError,
  onSelect,
  onRename,
  onDelete,
  onShare,
  onUnshare,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onMove,
}: {
  workspace: WorkspaceSummary;
  active: boolean;
  ko: boolean;
  dragging: boolean;
  /** Already pushed to RunPod — its images stay in sync from here on. */
  shared: boolean;
  sharing: boolean;
  shareError: string;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onShare: () => void;
  onUnshare: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onMove: (offset: number) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setMenuOpen(false);
    setRenaming(false);
    setConfirmingDelete(false);
  };

  // The bar is overflow-x-auto (which also clips the y axis), so the menu is
  // rendered in a portal on document.body anchored to the trigger button.
  useLayoutEffect(() => {
    if (!menuOpen) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 224; // w-56
      const left = Math.min(
        Math.max(8, rect.left),
        window.innerWidth - width - 8
      );
      setMenuPos({ top: rect.bottom + 6, left });
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  const submitRename = () => {
    const name = draftName.trim();
    if (name && name !== workspace.name) onRename(name);
    closeMenu();
  };

  const dragHint = ko
    ? "드래그해서 순서 변경 (Alt+←/→)"
    : "Drag to reorder (Alt+\u2190/\u2192)";

  return (
    <div
      className="relative shrink-0"
      // Reordering uses native HTML5 drag events: the bar lives in a horizontal
      // scroller and the chips are plain flex children, so no layout animation
      // library is needed — the list itself is reordered live on drag-enter.
      draggable={!renaming}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", workspace.id);
        closeMenu();
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragEnd();
      }}
      onDragEnd={onDragEnd}
    >
      <div
        className={`group flex items-center gap-1 rounded-full border py-0.5 pl-1.5 pr-1 text-xs transition-colors ${
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:border-primary/50"
        } ${dragging ? "opacity-50 ring-2 ring-primary/60" : ""}`}
      >
        <GripVertical
          className={`h-3.5 w-3.5 shrink-0 cursor-grab opacity-40 transition-opacity group-hover:opacity-80 active:cursor-grabbing ${
            active ? "" : "text-muted-foreground"
          }`}
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={onSelect}
          onKeyDown={(event) => {
            // Keyboard equivalent of the drag, so reordering is reachable
            // without a pointer.
            if (!event.altKey) return;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              onMove(-1);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              onMove(1);
            }
          }}
          className="flex items-center gap-1.5 py-0.5"
          title={`${workspace.name} \u2014 ${dragHint}`}
        >
          {shared && (
            <Cloud
              className={`h-3 w-3 shrink-0 ${
                active ? "" : "text-primary"
              }`}
              aria-label={ko ? "RunPod에 공유됨" : "Shared to RunPod"}
            />
          )}
          <span className="max-w-40 truncate font-medium">{workspace.name}</span>
          <span
            className={`rounded-full px-1.5 text-[10px] tabular-nums ${
              active
                ? "bg-primary-foreground/20 text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {workspace.count}
          </span>
        </button>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setDraftName(workspace.name);
            setMenuOpen((current) => !current);
            setRenaming(false);
            setConfirmingDelete(false);
          }}
          className={`flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
            active
              ? "hover:bg-primary-foreground/20"
              : "text-muted-foreground hover:bg-muted"
          }`}
          aria-label={
            ko
              ? "워크스페이스 관리 (이름 변경·삭제·공유)"
              : "Manage workspace (rename / delete / share)"
          }
          aria-expanded={menuOpen}
          title={ko ? "이름 변경·삭제·공유" : "Rename / delete / share"}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] w-56 rounded-md border border-border bg-popover p-2 text-foreground shadow-xl"
          style={{
            top: menuPos?.top ?? -9999,
            left: menuPos?.left ?? -9999,
            visibility: menuPos ? "visible" : "hidden",
          }}
        >
          {renaming ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    if (isImeConfirmEnter(event)) return;
                    event.preventDefault();
                    submitRename();
                  }
                  if (event.key === "Escape") closeMenu();
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button
                type="button"
                size="icon-sm"
                onClick={submitRename}
                disabled={!draftName.trim()}
                aria-label={ko ? "이름 저장" : "Save name"}
              >
                <Check />
              </Button>
            </div>
          ) : confirmingDelete ? (
            <div>
              <p className="px-1 text-[11px] font-medium text-popover-foreground">
                {ko
                  ? "이 워크스페이스를 삭제할까요?"
                  : "Delete this workspace?"}
              </p>
              <p className="mt-0.5 px-1 text-[10px] text-muted-foreground">
                {ko
                  ? "이미지는 삭제되지 않습니다."
                  : "Images are not deleted."}
              </p>
              <div className="mt-2 flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => {
                    onDelete();
                    closeMenu();
                  }}
                >
                  {ko ? "삭제" : "Delete"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 flex-1 text-[11px]"
                  onClick={() => setConfirmingDelete(false)}
                >
                  {ko ? "취소" : "Cancel"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={() => setRenaming(true)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <Pencil className="h-3.5 w-3.5" />
                {ko ? "이름 변경" : "Rename"}
              </button>
              <button
                type="button"
                disabled={sharing}
                onClick={() => {
                  if (shared) onUnshare();
                  else onShare();
                  closeMenu();
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                {sharing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : shared ? (
                  <CloudOff className="h-3.5 w-3.5" />
                ) : (
                  <Cloud className="h-3.5 w-3.5" />
                )}
                {shared
                  ? ko
                    ? "공유 해제"
                    : "Stop sharing"
                  : ko
                    ? "공유하기"
                    : "Share to RunPod"}
              </button>
              {shared && (
                <p className="px-2 pb-1 text-[10px] text-muted-foreground">
                  {shareError
                    ? shareError
                    : ko
                      ? "이미지가 바뀌면 자동으로 RunPod에 반영됩니다."
                      : "Image changes sync to RunPod automatically."}
                </p>
              )}
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {ko ? "삭제" : "Delete"}
              </button>
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export function WorkspaceBar() {
  const workspaces = useStore((state) => state.workspaces);
  const ungroupedCount = useStore((state) => state.ungroupedCount);
  const activeWorkspaceId = useStore((state) => state.activeWorkspaceId);
  const fetchWorkspaces = useStore((state) => state.fetchWorkspaces);
  const setActiveWorkspace = useStore((state) => state.setActiveWorkspace);
  const createWorkspace = useStore((state) => state.createWorkspace);
  const renameWorkspace = useStore((state) => state.renameWorkspace);
  const reorderWorkspaces = useStore((state) => state.reorderWorkspaces);
  const deleteWorkspace = useStore((state) => state.deleteWorkspace);
  const language = useStore((state) => state.language);
  const ko = language === "ko";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  // Which workspaces this machine has pushed to RunPod, keyed by id. Read from
  // local state only (no pod round-trip) so the bar can badge them on load.
  const [shares, setShares] = useState<Record<string, { error: string }>>({});
  const [sharingId, setSharingId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);

  const refreshShares = useCallback(async () => {
    try {
      const res = await fetch("/api/runpod/share/state?kind=workspaces", {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        shares?: Record<string, { error?: string }>;
      };
      setShares(
        Object.fromEntries(
          Object.entries(data.shares ?? {}).map(([id, record]) => [
            id,
            { error: record?.error ?? "" },
          ])
        )
      );
    } catch {
      // Leave the previous badges in place; sharing still works without them.
    }
  }, []);

  const shareWorkspace = useCallback(
    async (workspaceId: string) => {
      setSharingId(workspaceId);
      setShareMessage("");
      try {
        const res = await fetch("/api/runpod/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "workspaces", id: workspaceId }),
        });
        const data = (await res.json()) as {
          imageCount?: number;
          podLabel?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "공유에 실패했습니다.");
        setShareMessage(
          ko
            ? `${data.podLabel ?? "RunPod"}에 공유됨 — 이미지 ${data.imageCount ?? 0}장`
            : `Shared to ${data.podLabel ?? "RunPod"} — ${data.imageCount ?? 0} images`
        );
        await refreshShares();
      } catch (error) {
        setShareMessage(
          error instanceof Error ? error.message : "공유에 실패했습니다."
        );
      } finally {
        setSharingId("");
      }
    },
    [ko, refreshShares]
  );

  const unshareWorkspace = useCallback(
    async (workspaceId: string) => {
      setSharingId(workspaceId);
      setShareMessage("");
      try {
        await fetch(
          `/api/runpod/share?kind=workspaces&id=${encodeURIComponent(workspaceId)}`,
          { method: "DELETE" }
        );
        setShareMessage(ko ? "공유를 해제했습니다." : "Sharing stopped.");
        await refreshShares();
      } finally {
        setSharingId("");
      }
    },
    [ko, refreshShares]
  );

  // Id of the chip being dragged, plus the in-progress order it is being
  // dragged into. `draftOrder` is what the bar renders while a drag is live;
  // it is committed to the store (and the server) on drop.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);

  const orderedWorkspaces = useMemo(() => {
    if (!draftOrder) return workspaces;

    const byId = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const ordered: WorkspaceSummary[] = [];
    for (const id of draftOrder) {
      const workspace = byId.get(id);
      if (!workspace) continue;
      ordered.push(workspace);
      byId.delete(id);
    }
    // A workspace created (or refetched) mid-drag still shows up.
    for (const workspace of workspaces) {
      if (byId.has(workspace.id)) ordered.push(workspace);
    }
    return ordered;
  }, [workspaces, draftOrder]);

  const moveWorkspace = (workspaceId: string, targetIndex: number) => {
    const ids = orderedWorkspaces.map((workspace) => workspace.id);
    const from = ids.indexOf(workspaceId);
    const to = Math.max(0, Math.min(ids.length - 1, targetIndex));
    if (from < 0 || from === to) return null;

    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  };

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    void (async () => {
      await refreshShares();
    })();
  }, [refreshShares]);

  useEffect(() => {
    if (!creating) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!createRef.current?.contains(event.target as Node)) {
        setCreating(false);
        setNewName("");
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [creating]);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name || submittingRef.current) return;

    submittingRef.current = true;
    setNewName("");
    setCreating(false);
    try {
      const workspace = await createWorkspace(name);
      if (workspace) setActiveWorkspace(workspace.id);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div
      className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-2"
      onDragOver={(event) => {
        if (draggingId) event.preventDefault();
      }}
      onDrop={(event) => {
        if (draggingId) event.preventDefault();
      }}
    >
      <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />

      <button
        type="button"
        onClick={() => setActiveWorkspace(null)}
        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          activeWorkspaceId === null
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:border-primary/50"
        }`}
      >
        {ko ? "전체 보기" : "All images"}
      </button>

      <button
        type="button"
        onClick={() => setActiveWorkspace(UNGROUPED_WORKSPACE_ID)}
        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
          activeWorkspaceId === UNGROUPED_WORKSPACE_ID
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:border-primary/50"
        }`}
        title={
          ko
            ? "어떤 워크스페이스에도 속하지 않은 이미지"
            : "Images not in any workspace"
        }
      >
        <FolderX className="h-3.5 w-3.5" />
        {ko ? "그룹없음" : "Ungrouped"}
        <span
          className={`rounded-full px-1.5 text-[10px] tabular-nums ${
            activeWorkspaceId === UNGROUPED_WORKSPACE_ID
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {ungroupedCount}
        </span>
      </button>

      {orderedWorkspaces.map((workspace, index) => (
        <WorkspaceChip
          key={workspace.id}
          workspace={workspace}
          active={workspace.id === activeWorkspaceId}
          ko={ko}
          dragging={workspace.id === draggingId}
          shared={Boolean(shares[workspace.id])}
          sharing={sharingId === workspace.id}
          shareError={shares[workspace.id]?.error ?? ""}
          onSelect={() => setActiveWorkspace(workspace.id)}
          onRename={(name) => void renameWorkspace(workspace.id, name)}
          onDelete={() => {
            void deleteWorkspace(workspace.id);
            setShares((current) => {
              const next = { ...current };
              delete next[workspace.id];
              return next;
            });
          }}
          onShare={() => void shareWorkspace(workspace.id)}
          onUnshare={() => void unshareWorkspace(workspace.id)}
          onDragStart={() => {
            setDraggingId(workspace.id);
            setDraftOrder(orderedWorkspaces.map((item) => item.id));
          }}
          onDragEnter={() => {
            if (!draggingId || draggingId === workspace.id) return;
            const next = moveWorkspace(draggingId, index);
            if (next) setDraftOrder(next);
          }}
          onDragEnd={() => {
            const next = draftOrder;
            setDraggingId(null);
            setDraftOrder(null);
            const current = workspaces.map((item) => item.id);
            if (next && next.join("\u0000") !== current.join("\u0000")) {
              void reorderWorkspaces(next);
            }
          }}
          onMove={(offset) => {
            const next = moveWorkspace(workspace.id, index + offset);
            if (next) void reorderWorkspaces(next);
          }}
        />
      ))}

      <div ref={createRef} className="relative shrink-0">
        {creating ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  if (isImeConfirmEnter(event)) return;
                  event.preventDefault();
                  void submitCreate();
                }
                if (event.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              placeholder={ko ? "워크스페이스 이름" : "Workspace name"}
              className="h-7 w-40 rounded-full border border-input bg-background px-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
            />
            <Button
              type="button"
              size="icon-sm"
              className="rounded-full"
              onClick={() => void submitCreate()}
              disabled={!newName.trim()}
              aria-label={ko ? "만들기" : "Create"}
            >
              <Check />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
              aria-label={ko ? "취소" : "Cancel"}
            >
              <X />
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {ko ? "새 워크스페이스" : "New workspace"}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDownloadOpen(true)}
        className="flex shrink-0 items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        title={
          ko
            ? "RunPod에 공유된 워크스페이스를 내려받습니다"
            : "Download a workspace shared on RunPod"
        }
      >
        <CloudDownload className="h-3.5 w-3.5" />
        {ko ? "공유 이미지 다운로드" : "Download shared"}
      </button>

      {shareMessage && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {shareMessage}
        </span>
      )}

      <RunpodShareDownloadDialog
        kind="workspaces"
        open={downloadOpen}
        onOpenChange={setDownloadOpen}
        onDownloaded={(workspaceId) => {
          // Jump straight to what was just downloaded: this refetches the
          // gallery filtered to that workspace, so its images show up at once.
          void fetchWorkspaces();
          setActiveWorkspace(workspaceId);
        }}
      />
    </div>
  );
}
