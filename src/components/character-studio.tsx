"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Clipboard,
  Cloud,
  CloudDownload,
  CloudOff,
  Copy,
  GripVertical,
  Images as ImagesIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CharacterPaimonChat } from "@/components/character-paimon-chat";
import { RunpodShareDownloadDialog } from "@/components/runpod-share-download";
import {
  getRunningCharacterId,
  registerCharacterPatchApplier,
} from "@/lib/character-paimon-store";
import { useStore } from "@/lib/store";
import {
  composeCharacterPrompt,
  type Character,
  type CharacterBackground,
  type CharacterOutfit,
  type CharacterSituation,
  type GeneratedImage,
} from "@/lib/types";

// Native <select> styling to match the app's inputs (mirrors app-sidebar).
const SELECT_CLASS =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

interface GeneratedImageLite {
  id: string;
  url: string;
  thumbnailUrl?: string;
  filename: string;
}

async function uploadImageFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || "업로드 실패");
  return data.url;
}

// A natural-language description + a generation prompt for one concept, both
// editable — the core "각 입력란마다 자연어 묘사 및 프롬프트" building block.
function FieldPair({
  descriptionLabel = "자연어 묘사",
  promptLabel = "프롬프트",
  description,
  prompt,
  descriptionPlaceholder,
  promptPlaceholder,
  onDescriptionChange,
  onPromptChange,
  minRows = 3,
}: {
  descriptionLabel?: string;
  promptLabel?: string;
  description: string;
  prompt: string;
  descriptionPlaceholder?: string;
  promptPlaceholder?: string;
  onDescriptionChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  minRows?: number;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{descriptionLabel}</Label>
        <Textarea
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          placeholder={descriptionPlaceholder}
          rows={minRows}
          className="text-sm"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{promptLabel}</Label>
        <Textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={promptPlaceholder}
          rows={minRows}
          className="font-mono text-[13px]"
        />
      </div>
    </div>
  );
}

// A small pill showing how many prompts a tab currently holds (outfits for the
// identity tab, backgrounds/situations for their own tabs). Hidden at zero so
// empty tabs stay uncluttered.
function TabCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-semibold leading-4 text-primary [[data-active]_&]:bg-primary-foreground/25 [[data-active]_&]:text-primary-foreground">
      {count}
    </span>
  );
}

// Add / clear-all buttons that live on the right of the tab row. The clear
// button only appears once there's at least one item to remove. An optional
// secondary clear button (used by the situation tab to wipe only its images)
// renders when its count is > 0.
function TabActions({
  addLabel,
  onAdd,
  count,
  onClear,
  secondaryClearLabel,
  secondaryClearCount,
  onSecondaryClear,
}: {
  addLabel: string;
  onAdd: () => void;
  count: number;
  onClear: () => void;
  secondaryClearLabel?: string;
  secondaryClearCount?: number;
  onSecondaryClear?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus /> {addLabel}
      </Button>
      {secondaryClearLabel &&
        onSecondaryClear &&
        (secondaryClearCount ?? 0) > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSecondaryClear}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 /> {secondaryClearLabel} ({secondaryClearCount})
          </Button>
        )}
      {count > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 /> 모두 제거 ({count})
        </Button>
      )}
    </div>
  );
}

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

// One row of the character list. The row itself selects (and drags to reorder);
// the trailing "…" opens a menu for the per-character actions — duplicate, share
// to RunPod, delete. The menu is portalled to the body because the list is a
// vertical scroller that would otherwise clip it.
function CharacterRow({
  character,
  active,
  dragging,
  shared,
  sharing,
  shareError,
  onSelect,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDuplicate,
  onShare,
  onUnshare,
  onDelete,
}: {
  character: Character;
  active: boolean;
  dragging: boolean;
  shared: boolean;
  sharing: boolean;
  shareError: string;
  onSelect: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onDuplicate: () => void;
  onShare: () => void;
  onUnshare: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 208; // w-52
      setMenuPos({
        top: Math.min(rect.bottom + 6, window.innerHeight - 160),
        left: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
      });
    };
    place();

    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [menuOpen]);

  const runAndClose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      onDragStart={(event) => {
        onDragStart();
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver();
      }}
      onDragEnd={onDragEnd}
      className={`group flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors ${
        active
          ? "border-primary/30 bg-primary/10"
          : "border-transparent hover:bg-sidebar-accent"
      } ${dragging ? "opacity-50" : ""}`}
    >
      <GripVertical
        className="size-4 shrink-0 cursor-grab text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
        {character.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={character.thumbnail}
            alt={character.name}
            className="size-full object-cover"
          />
        ) : (
          <UserRound className="size-5 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {shared && (
            <Cloud
              className="size-3 shrink-0 text-primary"
              aria-label="RunPod에 공유됨"
            />
          )}
          <span className="block truncate text-sm font-semibold">
            {character.name || "이름 없음"}
          </span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {character.summary || "간단 정보 없음"}
        </span>
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((current) => !current);
        }}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
        aria-label="캐릭터 메뉴 (복제·공유·삭제)"
        aria-expanded={menuOpen}
        title="복제·공유·삭제"
      >
        {sharing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>

      {menuOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] w-52 rounded-md border border-border bg-popover p-2 text-foreground shadow-xl"
            style={{
              top: menuPos?.top ?? -9999,
              left: menuPos?.left ?? -9999,
              visibility: menuPos ? "visible" : "hidden",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-0.5">
              <button
                type="button"
                onClick={runAndClose(onDuplicate)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <Copy className="size-3.5" />
                복제
              </button>
              <button
                type="button"
                disabled={sharing}
                onClick={runAndClose(shared ? onUnshare : onShare)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
              >
                {shared ? (
                  <CloudOff className="size-3.5" />
                ) : (
                  <Cloud className="size-3.5" />
                )}
                {shared ? "공유 해제" : "공유하기"}
              </button>
              {shared && (
                <p className="px-2 pb-1 text-[10px] text-muted-foreground">
                  {shareError ||
                    "내용이 바뀌면 자동으로 RunPod에 반영됩니다."}
                </p>
              )}
              <button
                type="button"
                onClick={runAndClose(onDelete)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" />
                삭제
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export function CharacterStudio() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // A Paimon answer can still be streaming for some character when this screen
  // opens (the chat keeps running after the studio unmounts). Captured on the
  // first render — before the list even arrives — so that character gets
  // selected and its chat opens instead of the usual first-in-list.
  const [runningChatCharacterId] = useState(getRunningCharacterId);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("basic");
  // Id of the character row currently being dragged for reordering, or null.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Mirror of draggingId so drag-over handlers read it without re-subscribing.
  const draggingIdRef = useRef<string | null>(null);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbError, setThumbError] = useState("");
  // Characters this machine has pushed to RunPod, keyed by id. Local state only
  // (no pod round-trip), so the list can badge them straight away.
  const [shares, setShares] = useState<Record<string, { error: string }>>({});
  const [sharingId, setSharingId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);

  const charactersRef = useRef<Character[]>([]);
  const saveTimers = useRef<Map<string, number>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep a ref of the latest characters so debounced save timers read fresh data
  // without needing to be recreated on every edit.
  useEffect(() => {
    charactersRef.current = characters;
  }, [characters]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/characters", { cache: "no-store" });
        const data = (await res.json()) as { characters?: Character[] };
        if (!active) return;
        const list = data.characters ?? [];
        const running =
          runningChatCharacterId &&
          list.some((character) => character.id === runningChatCharacterId)
            ? runningChatCharacterId
            : null;
        setCharacters(list);
        setSelectedId((current) => current ?? running ?? list[0]?.id ?? null);
      } catch {
        // Leave the list empty on failure; the empty state guides the user.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runningChatCharacterId]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  const selected = useMemo(
    () => characters.find((character) => character.id === selectedId) ?? null,
    [characters, selectedId]
  );

  const setSelectedImage = useStore((state) => state.setSelectedImage);
  // Watch the shared detail viewer's selection so we can refresh thumbnails when
  // it closes — an image deleted inside the viewer must drop out of its situation.
  const viewerImageId = useStore((state) => state.selectedImage?.id ?? null);
  // Generated images for the selected character, grouped by situation id, so each
  // situation card can show its result thumbnails.
  const [situationImages, setSituationImages] = useState<
    Record<string, GeneratedImage[]>
  >({});
  // Situation whose "갤러리에서 가져오기" picker is open, and the one currently
  // waiting on a link request (its button shows a spinner).
  const [situationPickerId, setSituationPickerId] = useState<string | null>(null);
  const [attachingSituationId, setAttachingSituationId] = useState<string | null>(
    null
  );

  const reloadSituationImages = useCallback(async () => {
    // No character selected: nothing renders the situation strips, so leaving the
    // (stale) map untouched is fine and avoids a synchronous effect setState.
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/characters/${selectedId}/images`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        images?: {
          id: string;
          filename: string;
          url: string;
          thumbnailUrl: string;
          situationId: string | null;
          timestamp: number;
          params: GeneratedImage["params"];
        }[];
      };
      const grouped: Record<string, GeneratedImage[]> = {};
      for (const image of data.images ?? []) {
        if (!image.situationId) continue;
        (grouped[image.situationId] ??= []).push({
          id: image.id,
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          filename: image.filename,
          params: image.params,
          timestamp: image.timestamp,
          characterId: selectedId,
          situationId: image.situationId,
        });
      }
      setSituationImages(grouped);
    } catch {
      setSituationImages({});
    }
  }, [selectedId]);

  useEffect(() => {
    void (async () => {
      await reloadSituationImages();
    })();
  }, [reloadSituationImages]);

  // When the detail viewer closes (id goes from set → null), a delete may have
  // happened inside it — refresh so the removed image leaves its situation strip.
  const prevViewerImageId = useRef<string | null>(null);
  useEffect(() => {
    if (prevViewerImageId.current && !viewerImageId) {
      void reloadSituationImages();
    }
    prevViewerImageId.current = viewerImageId;
  }, [viewerImageId, reloadSituationImages]);

  // Remove-from-situation: clears the character/situation link on the image's
  // metadata so its thumbnail leaves this situation. The image itself stays in
  // the gallery (use the viewer's Delete to remove the image entirely).
  const removeSituationImage = useCallback(
    async (situationId: string, image: GeneratedImage) => {
      if (!selectedId) return;
      setSituationImages((prev) => {
        const next = { ...prev };
        const remaining = (next[situationId] ?? []).filter(
          (item) => item.id !== image.id
        );
        if (remaining.length > 0) next[situationId] = remaining;
        else delete next[situationId];
        return next;
      });
      await fetch(
        `/api/characters/${selectedId}/images?filename=${encodeURIComponent(
          image.filename
        )}`,
        { method: "DELETE" }
      ).catch(() => {});
    },
    [selectedId]
  );

  // Attach existing gallery images to a situation: tags each image's metadata with
  // this character/situation so it shows up in the situation strip just like a
  // generated result. An image already linked elsewhere moves to this situation.
  const attachSituationImages = useCallback(
    async (situationId: string, images: GeneratedImageLite[]) => {
      if (!selectedId || images.length === 0) return;
      setAttachingSituationId(situationId);
      try {
        await fetch(`/api/characters/${selectedId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            situationId,
            filenames: images.map((image) => image.filename),
          }),
        });
      } catch {
        // Silent: the reload below shows whatever actually got linked.
      } finally {
        setAttachingSituationId(null);
        await reloadSituationImages();
      }
    },
    [reloadSituationImages, selectedId]
  );

  const scheduleSave = useCallback((id: string) => {
    const timers = saveTimers.current;
    const existing = timers.get(id);
    if (existing) window.clearTimeout(existing);
    timers.set(
      id,
      window.setTimeout(() => {
        timers.delete(id);
        const character = charactersRef.current.find((item) => item.id === id);
        if (!character) return;
        void fetch(`/api/characters/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(character),
        }).catch(() => {});
      }, 600)
    );
  }, []);

  const patchCharacter = useCallback(
    (id: string, patch: Partial<Character>) => {
      setCharacters((prev) =>
        prev.map((character) =>
          character.id === id
            ? { ...character, ...patch, updatedAt: Date.now() }
            : character
        )
      );
      scheduleSave(id);
    },
    [scheduleSave]
  );

  // While the studio is mounted, Paimon's character edits land in this list (and
  // its debounced save). When it is unmounted mid-answer, the store persists the
  // patch itself and this list picks it up on the next mount.
  useEffect(
    () => registerCharacterPatchApplier(patchCharacter),
    [patchCharacter]
  );

  const patchSelected = useCallback(
    (patch: Partial<Character>) => {
      if (!selectedId) return;
      patchCharacter(selectedId, patch);
    },
    [patchCharacter, selectedId]
  );

  const createCharacter = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "새 캐릭터" }),
      });
      const data = (await res.json()) as { character?: Character; error?: string };
      if (!res.ok || !data.character) throw new Error(data.error || "생성 실패");
      setCharacters((prev) => [...prev, data.character as Character]);
      setSelectedId(data.character.id);
    } catch {
      // Silent: the button re-enables and the user can retry.
    } finally {
      setCreating(false);
    }
  }, []);

  const deleteCharacter = useCallback(
    async (id: string) => {
      if (!window.confirm("이 캐릭터를 삭제할까요?")) return;
      const timer = saveTimers.current.get(id);
      if (timer) {
        window.clearTimeout(timer);
        saveTimers.current.delete(id);
      }
      setCharacters((prev) => prev.filter((character) => character.id !== id));
      setSelectedId((current) => {
        if (current !== id) return current;
        const remaining = charactersRef.current.filter(
          (character) => character.id !== id
        );
        return remaining[0]?.id ?? null;
      });
      setShares((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await fetch(`/api/characters/${id}`, { method: "DELETE" }).catch(() => {});
    },
    []
  );

  // Re-reads the list from the server, optionally selecting one character —
  // used after a download, which can both add a character and refresh an
  // existing one.
  const reloadCharacters = useCallback(async (selectId?: string) => {
    try {
      const res = await fetch("/api/characters", { cache: "no-store" });
      const data = (await res.json()) as { characters?: Character[] };
      const list = data.characters ?? [];
      setCharacters(list);
      if (selectId && list.some((item) => item.id === selectId)) {
        setSelectedId(selectId);
      }
    } catch {
      // Keep the current list; the user can retry from the dialog.
    }
  }, []);

  const duplicateCharacter = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/characters/${id}/duplicate`, {
        method: "POST",
      });
      const data = (await res.json()) as { character?: Character; error?: string };
      if (!res.ok || !data.character) throw new Error(data.error || "복제 실패");
      const copy = data.character;
      // The server stores the copy directly after the original, so mirror that
      // placement here instead of appending.
      setCharacters((prev) => {
        const index = prev.findIndex((item) => item.id === id);
        if (index === -1) return [...prev, copy];
        const next = [...prev];
        next.splice(index + 1, 0, copy);
        return next;
      });
      setSelectedId(copy.id);
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "복제 실패");
    }
  }, []);

  // ---- RunPod sharing ----

  const refreshShares = useCallback(async () => {
    try {
      const res = await fetch("/api/runpod/share/state?kind=characters", {
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
      // Badges are cosmetic; sharing still works without them.
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshShares();
    })();
  }, [refreshShares]);

  const shareCharacter = useCallback(
    async (id: string) => {
      setSharingId(id);
      setShareMessage("");
      try {
        const res = await fetch("/api/runpod/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "characters", id }),
        });
        const data = (await res.json()) as {
          imageCount?: number;
          podLabel?: string;
          error?: string;
        };
        if (!res.ok) throw new Error(data.error || "공유에 실패했습니다.");
        setShareMessage(
          `${data.podLabel ?? "RunPod"}에 공유됨 — 이미지 ${data.imageCount ?? 0}장`
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
    [refreshShares]
  );

  const unshareCharacter = useCallback(
    async (id: string) => {
      setSharingId(id);
      setShareMessage("");
      try {
        await fetch(
          `/api/runpod/share?kind=characters&id=${encodeURIComponent(id)}`,
          { method: "DELETE" }
        );
        setShareMessage("공유를 해제했습니다.");
        await refreshShares();
      } finally {
        setSharingId("");
      }
    },
    [refreshShares]
  );

  // ---- List reordering (drag & drop) ----

  const startDrag = useCallback((id: string) => {
    draggingIdRef.current = id;
    setDraggingId(id);
  }, []);

  // Live-reorder the list as the dragged row passes over another. Persisting is
  // deferred to drag-end so we PUT the final order once, not on every move.
  const handleDragOver = useCallback((overId: string) => {
    const dragId = draggingIdRef.current;
    if (!dragId || dragId === overId) return;
    setCharacters((prev) => {
      const from = prev.findIndex((item) => item.id === dragId);
      const to = prev.findIndex((item) => item.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(() => {
    draggingIdRef.current = null;
    setDraggingId(null);
    // Persist the current on-screen order (charactersRef is kept fresh above).
    void fetch("/api/characters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ids: charactersRef.current.map((item) => item.id),
      }),
    }).catch(() => {});
  }, []);

  // ---- Thumbnail sources ----

  const applyThumbnail = useCallback(
    (url: string) => {
      patchSelected({ thumbnail: url });
    },
    [patchSelected]
  );

  const handleUploadFile = useCallback(
    async (file: File | undefined | null) => {
      if (!file || !selectedId) return;
      setThumbBusy(true);
      setThumbError("");
      try {
        const url = await uploadImageFile(file);
        applyThumbnail(url);
      } catch (err) {
        setThumbError(err instanceof Error ? err.message : "업로드 실패");
      } finally {
        setThumbBusy(false);
      }
    },
    [applyThumbnail, selectedId]
  );

  const handlePasteThumbnail = useCallback(async () => {
    if (!selectedId) return;
    setThumbBusy(true);
    setThumbError("");
    try {
      if (!navigator.clipboard?.read) {
        throw new Error("이 브라우저에서는 클립보드 읽기를 지원하지 않아요.");
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (!type) continue;
        const blob = await item.getType(type);
        const file = new File([blob], "clipboard", { type });
        const url = await uploadImageFile(file);
        applyThumbnail(url);
        return;
      }
      throw new Error("클립보드에 이미지가 없어요.");
    } catch (err) {
      setThumbError(
        err instanceof Error ? err.message : "클립보드 이미지를 가져오지 못했어요."
      );
    } finally {
      setThumbBusy(false);
    }
  }, [applyThumbnail, selectedId]);

  // ---- Outfits ----

  const addOutfit = useCallback(() => {
    if (!selected) return;
    const outfit: CharacterOutfit = {
      id: crypto.randomUUID(),
      name: `의상 ${selected.outfits.length + 1}`,
      description: "",
      prompt: "",
    };
    patchSelected({ outfits: [...selected.outfits, outfit] });
  }, [patchSelected, selected]);

  const updateOutfit = useCallback(
    (outfitId: string, patch: Partial<CharacterOutfit>) => {
      if (!selected) return;
      patchSelected({
        outfits: selected.outfits.map((outfit) =>
          outfit.id === outfitId ? { ...outfit, ...patch } : outfit
        ),
      });
    },
    [patchSelected, selected]
  );

  const removeOutfit = useCallback(
    (outfitId: string) => {
      if (!selected) return;
      // Drop the reference from any situation that pointed at this outfit.
      patchSelected({
        outfits: selected.outfits.filter((outfit) => outfit.id !== outfitId),
        situations: selected.situations.map((situation) =>
          situation.outfitId === outfitId
            ? { ...situation, outfitId: null }
            : situation
        ),
      });
    },
    [patchSelected, selected]
  );

  // Wipe every outfit at once, clearing any situation that pointed at one.
  const clearOutfits = useCallback(() => {
    if (!selected || selected.outfits.length === 0) return;
    if (
      !window.confirm(
        `의상 ${selected.outfits.length}개를 모두 제거할까요? 이 작업은 되돌릴 수 없어요.`
      )
    )
      return;
    patchSelected({
      outfits: [],
      situations: selected.situations.map((situation) => ({
        ...situation,
        outfitId: null,
      })),
    });
  }, [patchSelected, selected]);

  // ---- Backgrounds ----

  const addBackground = useCallback(() => {
    if (!selected) return;
    const background: CharacterBackground = {
      id: crypto.randomUUID(),
      name: `배경 ${selected.backgrounds.length + 1}`,
      description: "",
      prompt: "",
    };
    patchSelected({ backgrounds: [...selected.backgrounds, background] });
  }, [patchSelected, selected]);

  const updateBackground = useCallback(
    (backgroundId: string, patch: Partial<CharacterBackground>) => {
      if (!selected) return;
      patchSelected({
        backgrounds: selected.backgrounds.map((background) =>
          background.id === backgroundId
            ? { ...background, ...patch }
            : background
        ),
      });
    },
    [patchSelected, selected]
  );

  const removeBackground = useCallback(
    (backgroundId: string) => {
      if (!selected) return;
      // Drop the reference from any situation that pointed at this background.
      patchSelected({
        backgrounds: selected.backgrounds.filter(
          (background) => background.id !== backgroundId
        ),
        situations: selected.situations.map((situation) =>
          situation.backgroundId === backgroundId
            ? { ...situation, backgroundId: null }
            : situation
        ),
      });
    },
    [patchSelected, selected]
  );

  // Wipe every background at once, clearing any situation that referenced one.
  const clearBackgrounds = useCallback(() => {
    if (!selected || selected.backgrounds.length === 0) return;
    if (
      !window.confirm(
        `배경 ${selected.backgrounds.length}개를 모두 제거할까요? 이 작업은 되돌릴 수 없어요.`
      )
    )
      return;
    patchSelected({
      backgrounds: [],
      situations: selected.situations.map((situation) => ({
        ...situation,
        backgroundId: null,
      })),
    });
  }, [patchSelected, selected]);

  // ---- Situations ----

  const addSituation = useCallback(() => {
    if (!selected) return;
    const situation: CharacterSituation = {
      id: crypto.randomUUID(),
      name: `상황 ${selected.situations.length + 1}`,
      description: "",
      prompt: "",
      outfitId: selected.outfits[0]?.id ?? null,
      backgroundId: selected.backgrounds[0]?.id ?? null,
    };
    patchSelected({ situations: [...selected.situations, situation] });
  }, [patchSelected, selected]);

  const updateSituation = useCallback(
    (situationId: string, patch: Partial<CharacterSituation>) => {
      if (!selected) return;
      patchSelected({
        situations: selected.situations.map((situation) =>
          situation.id === situationId
            ? { ...situation, ...patch }
            : situation
        ),
      });
    },
    [patchSelected, selected]
  );

  const removeSituation = useCallback(
    (situationId: string) => {
      if (!selected) return;
      patchSelected({
        situations: selected.situations.filter(
          (situation) => situation.id !== situationId
        ),
      });
    },
    [patchSelected, selected]
  );

  // Wipe every situation for the selected character at once — used by the "모두
  // 제거" button when a batch-generated set needs to be cleared and regenerated.
  const clearSituations = useCallback(() => {
    if (!selected || selected.situations.length === 0) return;
    if (
      !window.confirm(
        `상황 ${selected.situations.length}개를 모두 제거할까요? 이 작업은 되돌릴 수 없어요.`
      )
    )
      return;
    patchSelected({ situations: [] });
  }, [patchSelected, selected]);

  // Unlink every situation image at once — keeps the situations themselves but
  // strips all their generated-image thumbnails. Mirrors removeSituationImage's
  // semantics (unlink, not file delete) across the whole map.
  const clearAllSituationImages = useCallback(async () => {
    if (!selectedId) return;
    const images = Object.values(situationImages).flat();
    if (images.length === 0) return;
    if (
      !window.confirm(
        `상황 이미지 ${images.length}개를 모두 삭제할까요? 상황은 유지되고 이미지 연결만 해제돼요.`
      )
    )
      return;
    setSituationImages({});
    await Promise.all(
      images.map((image) =>
        fetch(
          `/api/characters/${selectedId}/images?filename=${encodeURIComponent(
            image.filename
          )}`,
          { method: "DELETE" }
        ).catch(() => {})
      )
    );
  }, [selectedId, situationImages]);

  const situationImageCount = useMemo(
    () => Object.values(situationImages).reduce((n, arr) => n + arr.length, 0),
    [situationImages]
  );

  const combinedPrompt = useMemo(
    () => (selected ? composeCharacterPrompt(selected) : ""),
    [selected]
  );

  return (
    <div className="flex h-screen min-w-0 flex-1">
      {/* Left: character list */}
      <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-border bg-sidebar">
        {/* Pinned above the scrolling list: creating and downloading a shared
            character stay reachable no matter how far the list is scrolled. */}
        <div className="border-b border-sidebar-border px-4 py-3">
          <h2 className="text-sm font-bold">캐릭터</h2>
          <div className="mt-2 flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={createCharacter}
              disabled={creating}
            >
              {creating ? <Loader2 className="animate-spin" /> : <Plus />}
              새 캐릭터
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setDownloadOpen(true)}
              aria-label="공유 캐릭터 다운로드"
              title="RunPod에 공유된 캐릭터 다운로드"
            >
              <CloudDownload />
            </Button>
          </div>
          {shareMessage && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {shareMessage}
            </p>
          )}
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> 불러오는 중
            </div>
          ) : characters.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              아직 캐릭터가 없어요. &quot;새 캐릭터&quot;로 시작하세요.
            </p>
          ) : (
            characters.map((character) => (
              <CharacterRow
                key={character.id}
                character={character}
                active={character.id === selectedId}
                dragging={draggingId === character.id}
                shared={Boolean(shares[character.id])}
                sharing={sharingId === character.id}
                shareError={shares[character.id]?.error ?? ""}
                onSelect={() => setSelectedId(character.id)}
                onDragStart={() => startDrag(character.id)}
                onDragOver={() => handleDragOver(character.id)}
                onDragEnd={handleDragEnd}
                onDuplicate={() => void duplicateCharacter(character.id)}
                onShare={() => void shareCharacter(character.id)}
                onUnshare={() => void unshareCharacter(character.id)}
                onDelete={() => void deleteCharacter(character.id)}
              />
            ))
          )}
        </div>

        <RunpodShareDownloadDialog
          kind="characters"
          open={downloadOpen}
          onOpenChange={setDownloadOpen}
          onDownloaded={(characterId) => {
            void reloadCharacters(characterId);
            void refreshShares();
          }}
        />
      </aside>

      {/* Right: character settings */}
      <main className="flex h-screen min-w-0 flex-1 flex-col">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {loading
              ? "불러오는 중…"
              : "왼쪽에서 캐릭터를 선택하거나 새로 만들어 설정을 편집하세요."}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-border px-6 py-4">
              <h1 className="text-lg font-bold">
                {selected.name || "이름 없는 캐릭터"}
              </h1>
              <p className="text-xs text-muted-foreground">
                각 입력란은 자연어 묘사와 프롬프트를 함께 편집할 수 있어요. 변경
                사항은 자동 저장됩니다.
              </p>
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as string)}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
                <TabsList>
                  <TabsTrigger value="basic">기본정보</TabsTrigger>
                  <TabsTrigger value="identity">
                    아이덴티티
                    <TabCount count={selected.outfits.length} />
                  </TabsTrigger>
                  <TabsTrigger value="background">
                    배경
                    <TabCount count={selected.backgrounds.length} />
                  </TabsTrigger>
                  <TabsTrigger value="situation">
                    상황
                    <TabCount count={selected.situations.length} />
                  </TabsTrigger>
                </TabsList>

                {/* Add / clear-all actions for the active tab, aligned to the
                    right of the tab row. */}
                {activeTab === "identity" && (
                  <TabActions
                    addLabel="의상 추가"
                    onAdd={addOutfit}
                    count={selected.outfits.length}
                    onClear={clearOutfits}
                  />
                )}
                {activeTab === "background" && (
                  <TabActions
                    addLabel="배경 추가"
                    onAdd={addBackground}
                    count={selected.backgrounds.length}
                    onClear={clearBackgrounds}
                  />
                )}
                {activeTab === "situation" && (
                  <TabActions
                    addLabel="상황 추가"
                    onAdd={addSituation}
                    count={selected.situations.length}
                    onClear={clearSituations}
                    secondaryClearLabel="이미지만 모두 삭제"
                    secondaryClearCount={situationImageCount}
                    onSecondaryClear={clearAllSituationImages}
                  />
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {/* 기본정보 */}
                <TabsContent value="basic" className="space-y-4">
                  <SectionCard
                    title="썸네일"
                    description="생성된 이미지에서 선택하거나, 파일 업로드 또는 클립보드에서 붙여넣을 수 있어요."
                  >
                    <div className="flex items-start gap-4">
                      <span className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                        {selected.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selected.thumbnail}
                            alt={selected.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <UserRound className="size-10 text-muted-foreground" />
                        )}
                      </span>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setGalleryOpen(true)}
                            disabled={thumbBusy}
                          >
                            <ImagesIcon /> 생성된 이미지
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={thumbBusy}
                          >
                            <Upload /> 업로드
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handlePasteThumbnail}
                            disabled={thumbBusy}
                          >
                            <Clipboard /> 클립보드
                          </Button>
                          {selected.thumbnail && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => applyThumbnail("")}
                              disabled={thumbBusy}
                            >
                              <X /> 제거
                            </Button>
                          )}
                        </div>
                        {thumbBusy && (
                          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="size-3 animate-spin" /> 처리 중…
                          </p>
                        )}
                        {thumbError && (
                          <p className="text-xs text-destructive">{thumbError}</p>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            void handleUploadFile(event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard title="이름 · 간단 정보">
                    <div className="space-y-1.5">
                      <Label htmlFor="character-name" className="text-xs text-muted-foreground">
                        이름
                      </Label>
                      <Input
                        id="character-name"
                        value={selected.name}
                        onChange={(event) =>
                          patchSelected({ name: event.target.value })
                        }
                        placeholder="캐릭터 이름"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="character-summary" className="text-xs text-muted-foreground">
                        간단 정보
                      </Label>
                      <Input
                        id="character-summary"
                        value={selected.summary}
                        onChange={(event) =>
                          patchSelected({ summary: event.target.value })
                        }
                        placeholder="예: 은발의 엘프 궁수, 20대 초반"
                      />
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="시놉시스"
                    description="캐릭터의 이야기·설정을 자유롭게 적어두세요. 파이몬이 이 내용을 참고해 상황을 대량으로 만들 수 있어요. (예: “시놉시스를 참고해서 상황 80개 만들어줘”)"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="character-synopsis" className="text-xs text-muted-foreground">
                        시놉시스
                      </Label>
                      <Textarea
                        id="character-synopsis"
                        value={selected.synopsis}
                        onChange={(event) =>
                          patchSelected({ synopsis: event.target.value })
                        }
                        placeholder="예: 남쪽 바다의 작은 섬에서 자란 엘프. 여름 내내 해변과 항구, 밤의 축제를 오가며…"
                        rows={6}
                        className="text-sm"
                      />
                    </div>
                  </SectionCard>
                </TabsContent>

                {/* 아이덴티티 */}
                <TabsContent value="identity" className="space-y-4">
                  <SectionCard
                    title="외형"
                    description="캐릭터의 고정된 외형(얼굴, 머리, 체형, 특징)을 묘사하세요."
                  >
                    <FieldPair
                      description={selected.appearanceDescription}
                      prompt={selected.appearancePrompt}
                      descriptionPlaceholder="예: 은빛 긴 생머리, 청록색 눈동자, 뾰족한 귀, 날씬한 체형…"
                      promptPlaceholder="silver long hair, teal eyes, elf ears, slender…"
                      minRows={5}
                      onDescriptionChange={(value) =>
                        patchSelected({ appearanceDescription: value })
                      }
                      onPromptChange={(value) =>
                        patchSelected({ appearancePrompt: value })
                      }
                    />
                  </SectionCard>

                  <SectionCard
                    title="의상"
                    description="여러 의상을 등록할 수 있어요. 외형이 아닌 옷·액세서리만 넣으세요."
                  >
                    <div className="space-y-3">
                      {selected.outfits.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          등록된 의상이 없어요.
                        </p>
                      )}
                      {selected.outfits.map((outfit) => (
                        <div
                          key={outfit.id}
                          className="space-y-3 rounded-md border border-border bg-background p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Input
                              value={outfit.name}
                              onChange={(event) =>
                                updateOutfit(outfit.id, {
                                  name: event.target.value,
                                })
                              }
                              placeholder="의상 이름 (예: 기본 의상, 수영복)"
                              className="h-8"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeOutfit(outfit.id)}
                              aria-label="의상 삭제"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                          <FieldPair
                            description={outfit.description}
                            prompt={outfit.prompt}
                            descriptionPlaceholder="예: 하늘색 여름 원피스와 밀짚모자…"
                            promptPlaceholder="light blue summer dress, straw hat…"
                            onDescriptionChange={(value) =>
                              updateOutfit(outfit.id, { description: value })
                            }
                            onPromptChange={(value) =>
                              updateOutfit(outfit.id, { prompt: value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </TabsContent>

                {/* 배경 */}
                <TabsContent value="background" className="space-y-4">
                  <SectionCard
                    title="배경"
                    description="여러 배경을 등록할 수 있어요. 상황 탭에서 각 상황에 맞는 배경을 고를 수 있습니다. 인물 태그는 넣지 마세요."
                  >
                    <div className="space-y-3">
                      {selected.backgrounds.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          등록된 배경이 없어요.
                        </p>
                      )}
                      {selected.backgrounds.map((background) => (
                        <div
                          key={background.id}
                          className="space-y-3 rounded-md border border-border bg-background p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Input
                              value={background.name}
                              onChange={(event) =>
                                updateBackground(background.id, {
                                  name: event.target.value,
                                })
                              }
                              placeholder="배경 이름 (예: 해변, 야간 항구)"
                              className="h-8"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeBackground(background.id)}
                              aria-label="배경 삭제"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                          <FieldPair
                            description={background.description}
                            prompt={background.prompt}
                            descriptionPlaceholder="예: 노을 지는 해변, 잔잔한 파도, 야자수…"
                            promptPlaceholder="sunset beach, calm waves, palm trees…"
                            onDescriptionChange={(value) =>
                              updateBackground(background.id, {
                                description: value,
                              })
                            }
                            onPromptChange={(value) =>
                              updateBackground(background.id, { prompt: value })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </TabsContent>

                {/* 상황 */}
                <TabsContent value="situation" className="space-y-4">
                  <SectionCard
                    title="상황"
                    description="캐릭터가 처한 장면/행동을 등록하세요. 예: 바닷물에 떠서 평화롭게 수영한다."
                  >
                    <div className="space-y-3">
                      {selected.situations.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          등록된 상황이 없어요.
                        </p>
                      )}
                      {selected.situations.map((situation) => (
                        <div
                          key={situation.id}
                          className="space-y-3 rounded-md border border-border bg-background p-3"
                        >
                          <div className="flex items-center gap-2">
                            <Input
                              value={situation.name}
                              onChange={(event) =>
                                updateSituation(situation.id, {
                                  name: event.target.value,
                                })
                              }
                              placeholder="상황 이름 (예: 해변에서 수영)"
                              className="h-8"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => removeSituation(situation.id)}
                              aria-label="상황 삭제"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">
                                의상
                              </Label>
                              <select
                                className={SELECT_CLASS}
                                value={situation.outfitId ?? ""}
                                onChange={(event) =>
                                  updateSituation(situation.id, {
                                    outfitId: event.target.value || null,
                                  })
                                }
                              >
                                <option value="">자동 (첫 의상)</option>
                                {selected.outfits.map((outfit) => (
                                  <option key={outfit.id} value={outfit.id}>
                                    {outfit.name || "이름 없는 의상"}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs text-muted-foreground">
                                배경
                              </Label>
                              <select
                                className={SELECT_CLASS}
                                value={situation.backgroundId ?? ""}
                                onChange={(event) =>
                                  updateSituation(situation.id, {
                                    backgroundId: event.target.value || null,
                                  })
                                }
                              >
                                <option value="">자동 (첫 배경)</option>
                                {selected.backgrounds.map((background) => (
                                  <option
                                    key={background.id}
                                    value={background.id}
                                  >
                                    {background.name || "이름 없는 배경"}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <FieldPair
                            description={situation.description}
                            prompt={situation.prompt}
                            descriptionPlaceholder="예: 바닷물에 등을 대고 떠서 평화롭게 수영한다…"
                            promptPlaceholder="floating on back in the sea, peaceful, swimming…"
                            onDescriptionChange={(value) =>
                              updateSituation(situation.id, {
                                description: value,
                              })
                            }
                            onPromptChange={(value) =>
                              updateSituation(situation.id, { prompt: value })
                            }
                          />
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <Label className="text-xs text-muted-foreground">
                                생성된 이미지
                                {(situationImages[situation.id]?.length ?? 0) > 0
                                  ? ` (${situationImages[situation.id].length})`
                                  : ""}
                              </Label>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSituationPickerId(situation.id)}
                                disabled={attachingSituationId === situation.id}
                                title="갤러리의 이미지를 이 상황에 등록해요."
                              >
                                {attachingSituationId === situation.id ? (
                                  <Loader2 className="animate-spin" />
                                ) : (
                                  <ImagesIcon />
                                )}
                                갤러리에서 가져오기
                              </Button>
                            </div>
                            {(situationImages[situation.id]?.length ?? 0) === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                아직 이미지가 없어요. 생성하거나 갤러리에서 가져올
                                수 있어요.
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {situationImages[situation.id].map((image) => (
                                  <div
                                    key={image.id}
                                    className="group relative size-32"
                                  >
                                    <button
                                      type="button"
                                      className="size-32 overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80"
                                      onClick={() => setSelectedImage(image)}
                                      title="이미지 상세 보기"
                                    >
                                      <img
                                        src={image.thumbnailUrl || image.url}
                                        alt={`${situation.name} 결과`}
                                        className="h-full w-full object-cover"
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      className="absolute -right-1.5 -top-1.5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 shadow ring-1 ring-border transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                      onClick={() =>
                                        removeSituationImage(situation.id, image)
                                      }
                                      aria-label="이 상황에서 이미지 제거"
                                      title="이 상황에서 제거"
                                    >
                                      <X className="size-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="조합 프롬프트 미리보기"
                    description="아이덴티티 + 첫 상황(그 상황이 고른 의상·배경) + 상황을 합친 결과예요. 이미지 생성 파이몬에서 이 캐릭터를 불러올 수 있어요."
                  >
                    <Textarea
                      readOnly
                      value={combinedPrompt}
                      placeholder="각 탭을 채우면 조합 프롬프트가 여기 표시됩니다."
                      rows={4}
                      className="font-mono text-[13px]"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!combinedPrompt}
                      onClick={() => {
                        void navigator.clipboard?.writeText(combinedPrompt);
                      }}
                    >
                      <Clipboard /> 복사
                    </Button>
                  </SectionCard>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        )}
      </main>

      {selected && (
        <CharacterPaimonChat
          character={selected}
          autoOpen={selected.id === runningChatCharacterId}
        />
      )}

      {galleryOpen && (
        <GalleryPicker
          onClose={() => setGalleryOpen(false)}
          onPick={(url) => {
            applyThumbnail(url);
            setGalleryOpen(false);
          }}
        />
      )}

      {situationPickerId && (
        <GalleryPicker
          title="갤러리에서 이 상황에 등록할 이미지 선택"
          multiple
          confirmLabel="상황에 등록"
          onClose={() => setSituationPickerId(null)}
          onPickMany={(images) => {
            const situationId = situationPickerId;
            setSituationPickerId(null);
            void attachSituationImages(situationId, images);
          }}
        />
      )}
    </div>
  );
}

// Gallery browser used both for picking a character thumbnail (single pick, by
// url) and for attaching gallery images to a situation (multi pick, by file).
function GalleryPicker({
  title = "생성된 이미지에서 선택",
  multiple = false,
  confirmLabel = "추가",
  onClose,
  onPick,
  onPickMany,
}: {
  title?: string;
  multiple?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onPick?: (url: string) => void;
  onPickMany?: (images: GeneratedImageLite[]) => void;
}) {
  const [images, setImages] = useState<GeneratedImageLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // Selected filenames, in click order, so the confirm button can attach a batch.
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/images?limit=60", { cache: "no-store" });
        const data = (await res.json()) as {
          images?: GeneratedImageLite[];
          nextCursor?: number | null;
        };
        if (active) {
          setImages(data.images ?? []);
          setCursor(data.nextCursor ?? null);
        }
      } catch {
        if (active) setImages([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/images?limit=60&cursor=${cursor}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        images?: GeneratedImageLite[];
        nextCursor?: number | null;
      };
      setImages((prev) => [...prev, ...(data.images ?? [])]);
      setCursor(data.nextCursor ?? null);
    } catch {
      setCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  const toggle = useCallback((image: GeneratedImageLite) => {
    setPicked((prev) =>
      prev.includes(image.filename)
        ? prev.filter((name) => name !== image.filename)
        : [...prev, image.filename]
    );
  }, []);

  const confirm = useCallback(() => {
    if (picked.length === 0) return;
    const byFilename = new Map(images.map((image) => [image.filename, image]));
    onPickMany?.(
      picked
        .map((filename) => byFilename.get(filename))
        .filter((image): image is GeneratedImageLite => Boolean(image))
    );
  }, [images, onPickMany, picked]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="닫기"
          >
            <X />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> 불러오는 중
            </div>
          ) : images.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              생성된 이미지가 없어요.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {images.map((image) => {
                  const selectedIndex = picked.indexOf(image.filename);
                  return (
                    <button
                      key={image.id || image.filename}
                      type="button"
                      onClick={() =>
                        multiple ? toggle(image) : onPick?.(image.url)
                      }
                      className={`relative aspect-square overflow-hidden rounded-md border transition-transform hover:scale-[1.03] hover:border-primary/50 ${
                        selectedIndex >= 0
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.thumbnailUrl || image.url}
                        alt=""
                        className="size-full object-cover"
                        loading="lazy"
                      />
                      {selectedIndex >= 0 && (
                        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                          {selectedIndex + 1}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {cursor !== null && (
                <div className="mt-3 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="animate-spin" /> 불러오는 중
                      </>
                    ) : (
                      "더 보기"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
        {multiple && (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              {picked.length > 0
                ? `${picked.length}개 선택됨`
                : "추가할 이미지를 선택하세요."}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                취소
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={confirm}
                disabled={picked.length === 0}
              >
                {confirmLabel}
              </Button>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
