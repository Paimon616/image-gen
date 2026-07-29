"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  FolderX,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { UNGROUPED_WORKSPACE_ID, type WorkspaceSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";

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
  onSelect,
  onRename,
  onDelete,
}: {
  workspace: WorkspaceSummary;
  active: boolean;
  ko: boolean;
  onSelect: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
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

  return (
    <div className="relative shrink-0">
      <div
        className={`group flex items-center gap-1 rounded-full border px-1 py-0.5 pl-3 text-xs transition-colors ${
          active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card text-foreground hover:border-primary/50"
        }`}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex items-center gap-1.5 py-0.5"
          title={workspace.name}
        >
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
          aria-label={ko ? "워크스페이스 관리 (이름 변경·삭제)" : "Manage workspace (rename / delete)"}
          aria-expanded={menuOpen}
          title={ko ? "이름 변경·삭제" : "Rename / delete"}
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
  const deleteWorkspace = useStore((state) => state.deleteWorkspace);
  const language = useStore((state) => state.language);
  const ko = language === "ko";

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const createRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

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
    <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-4 py-2">
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

      {workspaces.map((workspace) => (
        <WorkspaceChip
          key={workspace.id}
          workspace={workspace}
          active={workspace.id === activeWorkspaceId}
          ko={ko}
          onSelect={() => setActiveWorkspace(workspace.id)}
          onRename={(name) => void renameWorkspace(workspace.id, name)}
          onDelete={() => void deleteWorkspace(workspace.id)}
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
    </div>
  );
}
