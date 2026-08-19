"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, FolderPlus, Loader2, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  useMediaWorkspaceStore,
  type VideoWorkspaceMedia,
} from "@/lib/media-workspace-store";
import type { GeneratedImage, WorkspaceSummary } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface WorkspacePickerProps {
  image: GeneratedImage;
  align?: "left" | "right";
  triggerClassName?: string;
  triggerVariant?: "overlay" | "outline";
}

interface PickerChromeProps {
  align?: "left" | "right";
  triggerClassName?: string;
  triggerVariant?: "overlay" | "outline";
}

const POPOVER_WIDTH = 224; // matches w-56
const MARGIN = 8;

// The popover itself, shared by every media. What differs per caller is only the
// workspace list it renders and what a checkbox does — images, ComfyUI videos
// and SeeDance clips all pick from the same workspaces.
function WorkspacePickerBase({
  workspaces,
  assignedIds,
  onToggle,
  onCreate,
  align = "right",
  triggerClassName = "",
  triggerVariant = "overlay",
}: PickerChromeProps & {
  workspaces: WorkspaceSummary[];
  assignedIds: string[];
  onToggle: (workspaceId: string, assigned: boolean) => void | Promise<void>;
  /** Creates a workspace and assigns this file to it. */
  onCreate: (name: string) => Promise<void>;
}) {
  const language = useStore((state) => state.language);
  const ko = language === "ko";

  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const memberIds = new Set(assignedIds);
  const memberCount = memberIds.size;

  // The popover renders in a portal on document.body so it is never clipped by
  // the gallery card's overflow-hidden or the scroll container. Position it as
  // a fixed element anchored to the trigger.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    let left = align === "right" ? rect.right - POPOVER_WIDTH : rect.left;
    left = Math.min(
      Math.max(MARGIN, left),
      window.innerWidth - POPOVER_WIDTH - MARGIN
    );

    const estimatedHeight = popoverRef.current?.offsetHeight ?? 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward =
      spaceBelow < estimatedHeight + MARGIN && rect.top > estimatedHeight + MARGIN;
    const top = openUpward
      ? Math.max(MARGIN, rect.top - MARGIN - estimatedHeight)
      : rect.bottom + MARGIN;

    setPosition({ top, left });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) return;

    updatePosition();

    const handleReposition = () => updatePosition();
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);

    // Reposition once the popover's real height is known / changes.
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updatePosition())
        : null;
    if (observer && popoverRef.current) observer.observe(popoverRef.current);

    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
      observer?.disconnect();
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleCreateAndAssign = async () => {
    const name = newName.trim();
    if (!name || creating) return;

    setCreating(true);
    try {
      await onCreate(name);
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  const popover =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[200] w-56 rounded-md border border-border bg-popover p-2 text-left text-popover-foreground shadow-xl"
            style={{
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              visibility: position ? "visible" : "hidden",
            }}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {ko ? "워크스페이스" : "Workspaces"}
            </p>

            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {workspaces.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                  {ko ? "아직 워크스페이스가 없습니다." : "No workspaces yet."}
                </p>
              ) : (
                workspaces.map((workspace) => {
                  const checked = memberIds.has(workspace.id);
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => void onToggle(workspace.id, !checked)}
                      className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {workspace.name}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    // Ignore the IME composition-confirm Enter so a Korean/JP/CN
                    // name doesn't create-and-assign twice.
                    if (event.nativeEvent.isComposing || event.keyCode === 229) {
                      return;
                    }
                    event.preventDefault();
                    void handleCreateAndAssign();
                  }
                }}
                placeholder={ko ? "새 워크스페이스" : "New workspace"}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              <Button
                type="button"
                size="icon-sm"
                onClick={() => void handleCreateAndAssign()}
                disabled={!newName.trim() || creating}
                aria-label={ko ? "만들고 지정" : "Create and assign"}
              >
                {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              </Button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        size="icon-sm"
        variant="outline"
        className={
          triggerVariant === "overlay"
            ? `pointer-events-auto bg-white/90 text-black hover:bg-white ${
                memberCount > 0 ? "ring-2 ring-primary/60" : ""
              } ${triggerClassName}`
            : `${memberCount > 0 ? "border-primary/60 text-primary" : ""} ${triggerClassName}`
        }
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        aria-label={ko ? "워크스페이스 지정" : "Assign to workspace"}
        aria-expanded={open}
        title={ko ? "워크스페이스 지정" : "Assign to workspace"}
      >
        <FolderPlus />
      </Button>
      {popover}
    </>
  );
}

export function WorkspacePicker({ image, ...chrome }: WorkspacePickerProps) {
  const workspaces = useStore((state) => state.workspaces);
  const setImageWorkspace = useStore((state) => state.setImageWorkspace);
  const createWorkspace = useStore((state) => state.createWorkspace);

  return (
    <WorkspacePickerBase
      {...chrome}
      workspaces={workspaces}
      assignedIds={image.workspaces ?? []}
      onToggle={(workspaceId, assigned) =>
        setImageWorkspace(image, workspaceId, assigned)
      }
      onCreate={async (name) => {
        const workspace = await createWorkspace(name);
        if (workspace) await setImageWorkspace(image, workspace.id, true);
      }}
    />
  );
}

// The video screens' picker. It holds no list of its own: the caller owns the
// video record, so the new membership is handed back and the page updates its
// list — the same shape the image store handles internally.
export function MediaWorkspacePicker({
  media,
  filename,
  workspaceIds,
  onChange,
  ...chrome
}: PickerChromeProps & {
  media: VideoWorkspaceMedia;
  filename: string;
  workspaceIds: string[];
  onChange: (workspaceIds: string[]) => void;
}) {
  const workspaces = useMediaWorkspaceStore(
    (state) => state.byMedia[media].workspaces
  );
  const setFileWorkspace = useMediaWorkspaceStore(
    (state) => state.setFileWorkspace
  );
  const createWorkspace = useMediaWorkspaceStore(
    (state) => state.createWorkspace
  );

  const assign = async (workspaceId: string, assigned: boolean) => {
    const next = await setFileWorkspace(media, filename, workspaceId, assigned);
    if (next) onChange(next);
  };

  return (
    <WorkspacePickerBase
      {...chrome}
      workspaces={workspaces}
      assignedIds={workspaceIds}
      onToggle={assign}
      onCreate={async (name) => {
        const workspace = await createWorkspace(media, name);
        if (workspace) await assign(workspace.id, true);
      }}
    />
  );
}
