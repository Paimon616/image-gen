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
  Check,
  Clapperboard,
  Clipboard,
  Cloud,
  CloudAlert,
  CloudDownload,
  CloudOff,
  Copy,
  GripVertical,
  Images as ImagesIcon,
  LayoutGrid,
  Loader2,
  MoreHorizontal,
  Plus,
  Rows3,
  SquareCheckBig,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CharacterPaimonChat } from "@/components/character-paimon-chat";
import {
  AssetChoiceButton,
  AssetPickerDialog,
  type LocalModelAsset,
} from "@/components/model-selector";
import { RunpodShareDownloadDialog } from "@/components/runpod-share-download";
import { ImageLibraryPicker } from "@/components/image-library-picker";
import {
  VideoLibraryPicker,
  type LibraryVideo,
} from "@/components/video-library-picker";
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
  type CharacterMainImage,
  type CharacterSituation,
  type CharacterSituationVideo,
  type CharacterLora,
  type GeneratedImage,
  type GenerationParams,
} from "@/lib/types";

// Last-viewed character and tab, restored when the studio remounts after
// navigating to another screen (localStorage so it also survives a reload).
const SELECTED_CHARACTER_KEY = "characterStudio:selectedId";
const ACTIVE_TAB_KEY = "characterStudio:activeTab";
// 상황 탭 보기 방식 (목록/갤러리) — 탭처럼 localStorage로 유지.
const SITUATION_VIEW_KEY = "characterStudio:situationView";
const TAB_VALUES = new Set(["basic", "identity", "background", "situation"]);

// Native <select> styling to match the app's inputs (mirrors app-sidebar).
const SELECT_CLASS =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

interface GeneratedImageLite {
  id: string;
  url: string;
  thumbnailUrl?: string;
  filename: string;
  // Present for anything the generator wrote a sidecar for; the main image
  // keeps it as this character's baseline settings.
  params?: GenerationParams | null;
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
  stacked = false,
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
  // 한 열 세로 배치 (상황 카드처럼 옆에 이미지가 붙는 좁은 자리용)
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "grid gap-3" : "grid gap-3 md:grid-cols-2"}>
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

// What the main image contributes as a baseline: the model settings the
// character's other renders start from, plus the prompt whose FORMAT Paimon
// keeps when it composes a situation. Shown so the "기준 세팅값" is inspectable
// rather than invisible.
function MainImageBaseline({
  mainImage,
}: {
  mainImage: CharacterMainImage | null;
}) {
  if (!mainImage) {
    return (
      <p className="text-xs text-muted-foreground">
        아직 메인 이미지가 없어요. 생성된 이미지를 하나 지정하면 그 이미지의
        모델·LoRA·샘플러 설정과 프롬프트 양식이 이 캐릭터의 기준이 돼요.
      </p>
    );
  }

  const params = mainImage.params;
  if (!params) {
    return (
      <p className="text-xs text-destructive">
        이 이미지에는 생성 정보가 없어서 기준 세팅으로 쓸 수 없어요. 생성 정보가
        남아 있는 다른 이미지를 선택해 주세요.
      </p>
    );
  }

  const facts = [
    params.model_name && `모델 ${params.model_name}`,
    params.loras?.length ? `LoRA ${params.loras.length}개` : "",
    params.sampler_name &&
      `${params.sampler_name}${params.scheduler ? ` · ${params.scheduler}` : ""}`,
    `${params.num_inference_steps} steps · CFG ${params.guidance_scale}`,
    `${params.width}×${params.height}`,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">
        기준 세팅 (상황 이미지 생성에 사용)
      </p>
      <ul className="flex flex-wrap gap-1">
        {facts.map((fact) => (
          <li
            key={fact}
            className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground"
          >
            {fact}
          </li>
        ))}
      </ul>
      {params.prompt && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            기준 프롬프트 보기
          </summary>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {params.prompt}
          </p>
        </details>
      )}
    </div>
  );
}

// 캐릭터 LoRA — the character's own trained LoRAs (e.g. from the LoRA training
// screen). Whenever this character is rendered they are merged on top of the
// main image's baseline settings, so a LoRA trained AFTER the main image was
// made still applies. LoRAs are picked through the same AssetPickerDialog the
// image generator uses (thumbnails + search); a path not in the local catalog
// (e.g. RunPod-only) still shows as a fallback row.
const MAX_CHARACTER_LORAS = 8;

// Which row the LoRA picker dialog is choosing for: an existing row's index,
// "new" for the 추가 button, or null while closed.
type CharacterLoraPickerTarget = number | "new" | null;

function CharacterLoraSection({
  loras,
  onChange,
}: {
  loras: CharacterLora[];
  onChange: (loras: CharacterLora[]) => void;
}) {
  const [available, setAvailable] = useState<LocalModelAsset[]>([]);
  const [pickerTarget, setPickerTarget] =
    useState<CharacterLoraPickerTarget>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const assets = Array.isArray(data.loraAssets) ? data.loraAssets : [];
        setAvailable(
          assets.filter(
            (item: unknown): item is LocalModelAsset =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as LocalModelAsset).path === "string" &&
              (item as LocalModelAsset).path.length > 0
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const findAsset = (path: string) =>
    available.find((asset) => asset.path === path);

  const updateRow = (index: number, patch: Partial<CharacterLora>) => {
    onChange(
      loras.map((lora, i) => (i === index ? { ...lora, ...patch } : lora))
    );
  };

  const handlePickerSelect = (asset: LocalModelAsset) => {
    if (pickerTarget === "new") {
      // The store de-dupes by path anyway; skipping here keeps the row from
      // silently vanishing on the next reload.
      if (!loras.some((lora) => lora.path === asset.path)) {
        onChange([...loras, { path: asset.path, scale: 1 }]);
      }
    } else if (typeof pickerTarget === "number") {
      updateRow(pickerTarget, { path: asset.path });
    }
    setPickerTarget(null);
  };

  return (
    <div className="space-y-2">
      {loras.length === 0 && (
        <p className="text-xs text-muted-foreground">
          아직 설정된 LoRA가 없어요. 이 캐릭터로 학습한 LoRA를 추가하면 이
          캐릭터의 모든 이미지 생성에 항상 함께 적용돼요.
        </p>
      )}

      {loras.map((lora, index) => (
        <div
          key={index}
          className="space-y-2 rounded-md border border-border p-2.5"
        >
          <div className="flex items-center gap-2">
            <AssetChoiceButton
              asset={findAsset(lora.path)}
              placeholder="LoRA 선택"
              fallbackLabel={lora.path || undefined}
              fallbackDescription="로컬 카탈로그에 없는 LoRA"
              onClick={() => setPickerTarget(index)}
            />
            <div className="flex shrink-0 items-center gap-1.5">
              <Label className="text-[11px] text-muted-foreground">
                스케일
              </Label>
              <Input
                type="number"
                step={0.05}
                min={-5}
                max={5}
                value={lora.scale}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  updateRow(index, {
                    scale: Number.isFinite(value) ? value : 1,
                  });
                }}
                className="h-8 w-20 text-[13px]"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              onClick={() => onChange(loras.filter((_, i) => i !== index))}
              aria-label="LoRA 제거"
            >
              <X />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Label className="shrink-0 text-[11px] text-muted-foreground">
              트리거 워드
            </Label>
            <Input
              value={lora.triggerWords ?? ""}
              onChange={(event) =>
                updateRow(index, { triggerWords: event.target.value })
              }
              placeholder="쉼표로 구분 (예: ayori) — 프롬프트에 자동 포함돼요"
              className="h-8 flex-1 font-mono text-[13px]"
            />
          </div>
        </div>
      ))}

      {loras.length < MAX_CHARACTER_LORAS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPickerTarget("new")}
        >
          <Plus /> LoRA 추가
        </Button>
      )}

      <AssetPickerDialog
        title="캐릭터 LoRA 선택"
        description="이 캐릭터 전용으로 학습한 LoRA를 선택하세요."
        assets={available}
        selectedPath={
          typeof pickerTarget === "number"
            ? loras[pickerTarget]?.path ?? ""
            : ""
        }
        open={pickerTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPickerTarget(null);
        }}
        onSelect={handlePickerSelect}
      />
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
        {character.mainImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={character.mainImage.thumbnailUrl || character.mainImage.url}
            alt={character.name}
            className="size-full object-cover"
          />
        ) : (
          <UserRound className="size-5 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          {/* Share state rides in the row itself, not on the hover-only "…"
              button, so an in-flight upload or a failed sync is visible at a
              glance without pointing at the row. */}
          {sharing ? (
            <Loader2
              className="size-3 shrink-0 animate-spin text-primary"
              aria-label="RunPod에 공유하는 중"
            />
          ) : shared && shareError ? (
            <CloudAlert
              className="size-3 shrink-0 text-destructive"
              aria-label="RunPod 동기화 실패"
            />
          ) : shared ? (
            <Cloud
              className="size-3 shrink-0 text-primary"
              aria-label="RunPod에 공유됨"
            />
          ) : null}
          <span className="block truncate text-sm font-semibold">
            {character.name || "이름 없음"}
          </span>
        </span>
        <span
          className={`block truncate text-xs ${
            !sharing && shared && shareError
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
          title={!sharing && shared && shareError ? shareError : undefined}
        >
          {sharing
            ? "RunPod에 공유하는 중…"
            : shared && shareError
              ? shareError
              : character.summary || "간단 정보 없음"}
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
        <MoreHorizontal className="size-4" />
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
  // Characters this machine has pushed to RunPod, keyed by id. Local state only
  // (no pod round-trip), so the list can badge them straight away.
  const [shares, setShares] = useState<Record<string, { error: string }>>({});
  const [sharingId, setSharingId] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);

  const charactersRef = useRef<Character[]>([]);
  const saveTimers = useRef<Map<string, number>>(new Map());

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
        // Character viewed on the last visit, if it still exists.
        const savedId = window.localStorage.getItem(SELECTED_CHARACTER_KEY);
        const saved =
          savedId && list.some((character) => character.id === savedId)
            ? savedId
            : null;
        setCharacters(list);
        setSelectedId(
          (current) => current ?? running ?? saved ?? list[0]?.id ?? null
        );
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

  // Restore the last-viewed tab once on mount. Done in an effect (not the state
  // initializer) so the client's first render matches the server's. The tab is
  // saved in the change handler — never in an effect keyed on activeTab, which
  // would race this restore on remount and clobber the saved value with "basic".
  useEffect(() => {
    const saved = window.localStorage.getItem(ACTIVE_TAB_KEY);
    if (saved && TAB_VALUES.has(saved)) setActiveTab(saved);
  }, []);

  // Remember the current character so a return to this screen restores it.
  useEffect(() => {
    if (selectedId) window.localStorage.setItem(SELECTED_CHARACTER_KEY, selectedId);
  }, [selectedId]);

  const selected = useMemo(
    () => characters.find((character) => character.id === selectedId) ?? null,
    [characters, selectedId]
  );

  const setSelectedImage = useStore((state) => state.setSelectedImage);
  const removeImage = useStore((state) => state.removeImage);
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
  // Generated video clips for the selected character, grouped by situation id —
  // the video counterpart of situationImages (both video surfaces combined).
  const [situationVideos, setSituationVideos] = useState<
    Record<string, CharacterSituationVideo[]>
  >({});
  // Situation whose video picker is open / waiting on a video link request.
  const [situationVideoPickerId, setSituationVideoPickerId] = useState<
    string | null
  >(null);
  const [attachingVideoSituationId, setAttachingVideoSituationId] = useState<
    string | null
  >(null);
  // 상황 탭 보기 방식: 목록(기존 카드) / 갤러리(이미지 + 이름 오버레이).
  const [situationView, setSituationView] = useState<"list" | "gallery">("list");
  // 선택 모드: 여러 상황을 체크해서 일괄 삭제(이미지만/상황만/둘 다)한다.
  const [situationSelectMode, setSituationSelectMode] = useState(false);
  const [checkedSituationIds, setCheckedSituationIds] = useState<Set<string>>(
    () => new Set()
  );

  // Restore the saved view once on mount (effect, not initializer — same
  // hydration-safety reasoning as the ACTIVE_TAB_KEY restore above).
  useEffect(() => {
    const saved = window.localStorage.getItem(SITUATION_VIEW_KEY);
    if (saved === "list" || saved === "gallery") setSituationView(saved);
  }, []);

  const changeSituationView = useCallback((view: "list" | "gallery") => {
    setSituationView(view);
    window.localStorage.setItem(SITUATION_VIEW_KEY, view);
  }, []);

  // Selections are per-character; switching characters exits select mode.
  // Render-time adjustment (not an effect) per the "adjusting state when props
  // change" pattern, so the old selection never paints against the new character.
  const [selectModeCharacterId, setSelectModeCharacterId] = useState(selectedId);
  if (selectModeCharacterId !== selectedId) {
    setSelectModeCharacterId(selectedId);
    setSituationSelectMode(false);
    setCheckedSituationIds(new Set());
  }

  const toggleSituationChecked = useCallback((situationId: string) => {
    setCheckedSituationIds((prev) => {
      const next = new Set(prev);
      if (next.has(situationId)) next.delete(situationId);
      else next.add(situationId);
      return next;
    });
  }, []);

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

  const reloadSituationVideos = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/characters/${selectedId}/videos`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        videos?: CharacterSituationVideo[];
      };
      const grouped: Record<string, CharacterSituationVideo[]> = {};
      for (const video of data.videos ?? []) {
        if (!video.situationId) continue;
        (grouped[video.situationId] ??= []).push(video);
      }
      setSituationVideos(grouped);
    } catch {
      setSituationVideos({});
    }
  }, [selectedId]);

  useEffect(() => {
    void (async () => {
      await reloadSituationVideos();
    })();
  }, [reloadSituationVideos]);

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

  // Remove-from-situation: clears the character/situation link on the clip's
  // metadata so it leaves this situation. The clip itself stays in its video
  // gallery.
  const removeSituationVideo = useCallback(
    async (situationId: string, video: CharacterSituationVideo) => {
      if (!selectedId) return;
      setSituationVideos((prev) => {
        const next = { ...prev };
        const remaining = (next[situationId] ?? []).filter(
          (item) => !(item.media === video.media && item.id === video.id)
        );
        if (remaining.length > 0) next[situationId] = remaining;
        else delete next[situationId];
        return next;
      });
      await fetch(
        `/api/characters/${selectedId}/videos?media=${video.media}&filename=${encodeURIComponent(
          video.filename
        )}`,
        { method: "DELETE" }
      ).catch(() => {});
    },
    [selectedId]
  );

  // Full delete: removes the clip file from its gallery (the sidecar link goes
  // with it), then drops it from this strip.
  const deleteSituationVideo = useCallback(
    async (situationId: string, video: CharacterSituationVideo) => {
      if (!selectedId) return;
      const endpoint =
        video.media === "seedance"
          ? `/api/seedance/videos/${video.filename}`
          : `/api/videos/${video.filename}`;
      await fetch(endpoint, { method: "DELETE" }).catch(() => {});
      setSituationVideos((prev) => {
        const next = { ...prev };
        const remaining = (next[situationId] ?? []).filter(
          (item) => !(item.media === video.media && item.id === video.id)
        );
        if (remaining.length > 0) next[situationId] = remaining;
        else delete next[situationId];
        return next;
      });
    },
    [selectedId]
  );

  // Attach existing gallery clips to a situation: tags each clip's metadata with
  // this character/situation so it shows up in the situation strip just like a
  // Paimon-generated one. A clip already linked elsewhere moves to this situation.
  const attachSituationVideos = useCallback(
    async (situationId: string, videos: LibraryVideo[]) => {
      if (!selectedId || videos.length === 0) return;
      setAttachingVideoSituationId(situationId);
      try {
        await fetch(`/api/characters/${selectedId}/videos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            situationId,
            videos: videos.map((video) => ({
              media: video.media,
              filename: video.filename,
            })),
          }),
        });
      } catch {
        // Silent: the reload below shows whatever actually got linked.
      } finally {
        setAttachingVideoSituationId(null);
        await reloadSituationVideos();
      }
    },
    [reloadSituationVideos, selectedId]
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
  // Background syncs (an image added to a shared character, a studio edit) run
  // server-side, so poll while something is shared to keep the badges honest —
  // a failed sync, or its recovery, shows up without a reload.
  const hasShares = Object.keys(shares).length > 0;
  useEffect(() => {
    if (!hasShares) return;
    const timer = setInterval(() => {
      void refreshShares();
    }, 10_000);
    return () => clearInterval(timer);
  }, [hasShares, refreshShares]);


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

  // ---- 메인 이미지 ----

  // Only a generated image can become the main image: it is the baseline the
  // character's other renders are composed from, so it has to carry generation
  // metadata. Uploads and clipboard pastes have none, hence no such buttons.
  const applyMainImage = useCallback(
    (image: GeneratedImageLite | null) => {
      const mainImage: CharacterMainImage | null = image
        ? {
            url: image.url,
            thumbnailUrl: image.thumbnailUrl,
            filename: image.filename,
            params: image.params ?? null,
          }
        : null;
      patchSelected({ mainImage });
    },
    [patchSelected]
  );

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

  // Delete an image file for good (unlike removeSituationImage, which only
  // unlinks): removes it from disk, the shared gallery store, and this strip.
  const deleteSituationImage = useCallback(
    async (situationId: string, image: GeneratedImage) => {
      if (
        !window.confirm(
          "이미지를 완전히 삭제할까요? 갤러리에서도 사라지고 되돌릴 수 없어요."
        )
      )
        return;
      setSituationImages((prev) => {
        const next = { ...prev };
        const remaining = (next[situationId] ?? []).filter(
          (item) => item.id !== image.id
        );
        if (remaining.length > 0) next[situationId] = remaining;
        else delete next[situationId];
        return next;
      });
      await fetch(`/api/images/${image.filename}`, { method: "DELETE" }).catch(
        () => {}
      );
      removeImage(image.id);
    },
    [removeImage]
  );

  // 통합 삭제: removes the situation AND deletes its generated images from disk
  // (the plain delete button above keeps the images in the gallery).
  const removeSituationWithImages = useCallback(
    async (situationId: string) => {
      if (!selected) return;
      const images = situationImages[situationId] ?? [];
      if (
        !window.confirm(
          images.length > 0
            ? `상황과 포함된 이미지 ${images.length}개를 함께 삭제할까요? 이미지는 갤러리에서도 사라지고 되돌릴 수 없어요.`
            : "이 상황을 삭제할까요? (포함된 이미지 없음)"
        )
      )
        return;
      removeSituation(situationId);
      setSituationImages((prev) => {
        const next = { ...prev };
        delete next[situationId];
        return next;
      });
      await Promise.all(
        images.map(async (image) => {
          await fetch(`/api/images/${image.filename}`, {
            method: "DELETE",
          }).catch(() => {});
          removeImage(image.id);
        })
      );
    },
    [removeImage, removeSituation, selected, situationImages]
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

  // ---- Situation bulk delete (선택 모드) ----

  const checkedSituationImageCount = useMemo(
    () =>
      [...checkedSituationIds].reduce(
        (n, id) => n + (situationImages[id]?.length ?? 0),
        0
      ),
    [checkedSituationIds, situationImages]
  );

  // 이미지만 삭제: 선택한 상황들의 이미지를 디스크·갤러리에서 지우고 상황은
  // 남긴다 (deleteSituationImage의 일괄판).
  const bulkDeleteSituationImages = useCallback(async () => {
    if (checkedSituationIds.size === 0) return;
    const ids = [...checkedSituationIds];
    const images = ids.flatMap((id) => situationImages[id] ?? []);
    if (images.length === 0) {
      window.alert("선택한 상황에 삭제할 이미지가 없어요.");
      return;
    }
    if (
      !window.confirm(
        `선택한 상황 ${ids.length}개의 이미지 ${images.length}개를 삭제할까요? 상황은 유지되지만 이미지는 갤러리에서도 사라지고 되돌릴 수 없어요.`
      )
    )
      return;
    setSituationImages((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    setCheckedSituationIds(new Set());
    await Promise.all(
      images.map(async (image) => {
        await fetch(`/api/images/${image.filename}`, {
          method: "DELETE",
        }).catch(() => {});
        removeImage(image.id);
      })
    );
  }, [checkedSituationIds, removeImage, situationImages]);

  // 상황만 삭제: 상황을 지우고 이미지는 갤러리에 남긴다 (removeSituation의
  // 일괄판).
  const bulkDeleteSituationsOnly = useCallback(() => {
    if (!selected || checkedSituationIds.size === 0) return;
    if (
      !window.confirm(
        `선택한 상황 ${checkedSituationIds.size}개를 삭제할까요? 포함된 이미지는 갤러리에 남아요.`
      )
    )
      return;
    patchSelected({
      situations: selected.situations.filter(
        (situation) => !checkedSituationIds.has(situation.id)
      ),
    });
    setCheckedSituationIds(new Set());
  }, [checkedSituationIds, patchSelected, selected]);

  // 둘 다 삭제: 상황과 포함된 이미지를 함께 지운다
  // (removeSituationWithImages의 일괄판).
  const bulkDeleteSituationsWithImages = useCallback(async () => {
    if (!selected || checkedSituationIds.size === 0) return;
    const ids = [...checkedSituationIds];
    const images = ids.flatMap((id) => situationImages[id] ?? []);
    if (
      !window.confirm(
        images.length > 0
          ? `선택한 상황 ${ids.length}개와 포함된 이미지 ${images.length}개를 함께 삭제할까요? 이미지는 갤러리에서도 사라지고 되돌릴 수 없어요.`
          : `선택한 상황 ${ids.length}개를 삭제할까요? (포함된 이미지 없음)`
      )
    )
      return;
    patchSelected({
      situations: selected.situations.filter(
        (situation) => !checkedSituationIds.has(situation.id)
      ),
    });
    setSituationImages((prev) => {
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
    setCheckedSituationIds(new Set());
    await Promise.all(
      images.map(async (image) => {
        await fetch(`/api/images/${image.filename}`, {
          method: "DELETE",
        }).catch(() => {});
        removeImage(image.id);
      })
    );
  }, [checkedSituationIds, patchSelected, removeImage, selected, situationImages]);

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
              onValueChange={(value) => {
                setActiveTab(value);
                window.localStorage.setItem(ACTIVE_TAB_KEY, value);
              }}
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
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
                      <Button
                        type="button"
                        variant={situationView === "list" ? "secondary" : "ghost"}
                        size="icon-sm"
                        onClick={() => changeSituationView("list")}
                        aria-label="목록으로 보기"
                        title="목록으로 보기"
                      >
                        <Rows3 />
                      </Button>
                      <Button
                        type="button"
                        variant={
                          situationView === "gallery" ? "secondary" : "ghost"
                        }
                        size="icon-sm"
                        onClick={() => changeSituationView("gallery")}
                        aria-label="갤러리로 보기"
                        title="갤러리로 보기 (이미지 + 상황 이름)"
                      >
                        <LayoutGrid />
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant={situationSelectMode ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => {
                        setSituationSelectMode((prev) => !prev);
                        setCheckedSituationIds(new Set());
                      }}
                      title="여러 상황을 선택해 일괄 삭제해요."
                    >
                      <SquareCheckBig />
                      {situationSelectMode ? "선택 종료" : "선택"}
                    </Button>
                    <TabActions
                      addLabel="상황 추가"
                      onAdd={addSituation}
                      count={selected.situations.length}
                      onClear={clearSituations}
                      secondaryClearLabel="이미지만 모두 삭제"
                      secondaryClearCount={situationImageCount}
                      onSecondaryClear={clearAllSituationImages}
                    />
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
                {/* 기본정보 */}
                <TabsContent value="basic" className="space-y-4">
                  <SectionCard
                    title="메인 이미지"
                    description="이 캐릭터의 기준 이미지예요. 목록 썸네일로도 쓰이지만, 이 캐릭터의 다른 이미지를 생성할 때 프롬프트 양식과 모델 설정의 기준이 돼요. 그래서 생성된 이미지에서만 선택할 수 있어요 (업로드·클립보드 이미지는 생성 정보가 없어서 기준이 될 수 없어요)."
                  >
                    <div className="flex items-start gap-4">
                      <span className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
                        {selected.mainImage ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={
                              selected.mainImage.thumbnailUrl ||
                              selected.mainImage.url
                            }
                            alt={selected.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <UserRound className="size-10 text-muted-foreground" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setGalleryOpen(true)}
                          >
                            <ImagesIcon />
                            {selected.mainImage
                              ? "생성된 이미지에서 변경"
                              : "생성된 이미지에서 선택"}
                          </Button>
                          {selected.mainImage && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => applyMainImage(null)}
                            >
                              <X /> 제거
                            </Button>
                          )}
                        </div>
                        <MainImageBaseline mainImage={selected.mainImage} />
                      </div>
                    </div>
                  </SectionCard>

                  <SectionCard
                    title="캐릭터 LoRA"
                    description="이 캐릭터 전용으로 학습한 LoRA예요. 이 캐릭터의 이미지를 생성할 때 메인 이미지의 기준 설정 위에 항상 함께 적용되고, 트리거 워드도 프롬프트에 자동으로 포함돼요 — 메인 이미지가 LoRA 학습 전에 만들어졌어도 적용돼요. 같은 LoRA가 기준 설정에 이미 있으면 여기의 스케일이 우선해요."
                  >
                    <CharacterLoraSection
                      loras={selected.loras ?? []}
                      onChange={(loras) => patchSelected({ loras })}
                    />
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
                  {situationSelectMode && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCheckedSituationIds(
                            checkedSituationIds.size ===
                              selected.situations.length
                              ? new Set()
                              : new Set(
                                  selected.situations.map(
                                    (situation) => situation.id
                                  )
                                )
                          )
                        }
                        disabled={selected.situations.length === 0}
                      >
                        {checkedSituationIds.size > 0 &&
                        checkedSituationIds.size === selected.situations.length
                          ? "전체 해제"
                          : "전체 선택"}
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        상황 {checkedSituationIds.size}개 · 이미지{" "}
                        {checkedSituationImageCount}개 선택됨
                      </span>
                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={checkedSituationIds.size === 0}
                          onClick={() => void bulkDeleteSituationImages()}
                          title="선택한 상황의 이미지를 삭제해요. 상황은 유지되고, 이미지는 갤러리에서도 사라져요."
                        >
                          <Trash2 /> 이미지만 삭제
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={checkedSituationIds.size === 0}
                          onClick={bulkDeleteSituationsOnly}
                          title="선택한 상황만 삭제해요. 이미지는 갤러리에 남아요."
                        >
                          <Trash2 /> 상황만 삭제
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={checkedSituationIds.size === 0}
                          onClick={() => void bulkDeleteSituationsWithImages()}
                          title="선택한 상황과 포함된 이미지를 함께 삭제해요. 이미지는 갤러리에서도 사라져요."
                        >
                          <Trash2 /> 둘 다 삭제
                        </Button>
                      </div>
                    </div>
                  )}
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
                      {situationView === "gallery" ? (
                        /* 갤러리 보기 — 이미지만 크게, 이름은 오버레이. 선택
                           모드에서는 카드 클릭이 곧 선택 토글. */
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                          {selected.situations.map((situation) => {
                            const images = situationImages[situation.id] ?? [];
                            const cover = images[0];
                            const checked = checkedSituationIds.has(
                              situation.id
                            );
                            return (
                              <button
                                key={situation.id}
                                type="button"
                                onClick={() => {
                                  if (situationSelectMode)
                                    toggleSituationChecked(situation.id);
                                  else if (cover) setSelectedImage(cover);
                                }}
                                className={cn(
                                  "group relative aspect-[3/4] overflow-hidden rounded-md border border-border bg-muted text-left",
                                  situationSelectMode
                                    ? checked
                                      ? "border-primary ring-2 ring-primary/50"
                                      : "hover:border-primary/50"
                                    : cover
                                      ? "transition-opacity hover:opacity-90"
                                      : "cursor-default"
                                )}
                                title={
                                  situationSelectMode
                                    ? checked
                                      ? "선택 해제"
                                      : "선택"
                                    : cover
                                      ? "이미지 상세 보기"
                                      : "아직 이미지가 없어요"
                                }
                              >
                                {cover ? (
                                  <img
                                    src={cover.thumbnailUrl || cover.url}
                                    alt={situation.name || "이름 없는 상황"}
                                    className="absolute inset-0 size-full object-cover"
                                  />
                                ) : (
                                  <span className="absolute inset-0 flex items-center justify-center">
                                    <ImagesIcon className="size-8 text-muted-foreground/40" />
                                  </span>
                                )}
                                <span className="absolute inset-x-0 bottom-0 line-clamp-2 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-8 text-xs font-medium text-white">
                                  {situation.name || "이름 없는 상황"}
                                </span>
                                {images.length > 1 && (
                                  <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                    {images.length}
                                  </span>
                                )}
                                {situationSelectMode && (
                                  <span
                                    className={cn(
                                      "absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border shadow",
                                      checked
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-border bg-background/90 text-transparent"
                                    )}
                                  >
                                    <Check className="size-3.5" />
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        selected.situations.map((situation) => (
                        <div
                          key={situation.id}
                          className={cn(
                            "space-y-3 rounded-md border border-border bg-background p-3",
                            situationSelectMode &&
                              checkedSituationIds.has(situation.id) &&
                              "border-primary ring-1 ring-primary/40"
                          )}
                        >
                          {/* 제목 줄 — 카드 맨 위 전체 폭 */}
                          <div className="flex items-center gap-2">
                            {situationSelectMode && (
                              <input
                                type="checkbox"
                                checked={checkedSituationIds.has(situation.id)}
                                onChange={() =>
                                  toggleSituationChecked(situation.id)
                                }
                                className="size-4 shrink-0 accent-primary"
                                aria-label="상황 선택"
                              />
                            )}
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
                              title="상황만 삭제해요. 이미지는 갤러리에 남아요."
                            >
                              <Trash2 />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() =>
                                void removeSituationWithImages(situation.id)
                              }
                              title="상황과 포함된 이미지를 함께 삭제해요. 이미지는 갤러리에서도 사라져요."
                            >
                              <Trash2 />
                              통합 삭제
                            </Button>
                          </div>
                          {/* 본문 — 왼쪽: 입력 필드 1열 세로, 오른쪽: 이미지 크게 */}
                          <div className="flex flex-col gap-4 md:flex-row">
                            <div className="min-w-0 flex-1 space-y-3">
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
                              <FieldPair
                                stacked
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
                            </div>
                            <div className="space-y-1.5 md:w-[45%] md:max-w-[26rem] md:shrink-0">
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
                                      className="group relative"
                                    >
                                      <button
                                        type="button"
                                        className="block h-64 max-w-full overflow-hidden rounded-md border border-border bg-muted transition-opacity hover:opacity-80"
                                        onClick={() => setSelectedImage(image)}
                                        title="이미지 상세 보기"
                                      >
                                        <img
                                          src={image.thumbnailUrl || image.url}
                                          alt={`${situation.name} 결과`}
                                          className="h-full w-auto max-w-full object-contain"
                                        />
                                      </button>
                                      <button
                                        type="button"
                                        className="absolute -right-1.5 -top-1.5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 shadow ring-1 ring-border transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                        onClick={() =>
                                          removeSituationImage(situation.id, image)
                                        }
                                        aria-label="이 상황에서 이미지 제거"
                                        title="이 상황에서 제거 (이미지는 갤러리에 남아요)"
                                      >
                                        <X className="size-3" />
                                      </button>
                                      <button
                                        type="button"
                                        className="absolute -right-1.5 top-5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 shadow ring-1 ring-border transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                        onClick={() =>
                                          void deleteSituationImage(
                                            situation.id,
                                            image
                                          )
                                        }
                                        aria-label="이미지 완전 삭제"
                                        title="이미지 삭제 (갤러리에서도 사라져요)"
                                      >
                                        <Trash2 className="size-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-2 pt-2">
                                <Label className="text-xs text-muted-foreground">
                                  생성된 영상
                                  {(situationVideos[situation.id]?.length ?? 0) > 0
                                    ? ` (${situationVideos[situation.id].length})`
                                    : ""}
                                </Label>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setSituationVideoPickerId(situation.id)
                                  }
                                  disabled={
                                    attachingVideoSituationId === situation.id
                                  }
                                  title="영상/시댄스 갤러리의 영상을 이 상황에 등록해요."
                                >
                                  {attachingVideoSituationId === situation.id ? (
                                    <Loader2 className="animate-spin" />
                                  ) : (
                                    <Clapperboard />
                                  )}
                                  갤러리에서 가져오기
                                </Button>
                              </div>
                              {(situationVideos[situation.id]?.length ?? 0) === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                  아직 영상이 없어요. 영상/시댄스 파이몬으로
                                  생성하거나 갤러리에서 가져올 수 있어요.
                                </p>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {situationVideos[situation.id].map((video) => (
                                    <div
                                      key={`${video.media}:${video.id}`}
                                      className="group relative"
                                    >
                                      <video
                                        src={video.url}
                                        controls
                                        preload="metadata"
                                        playsInline
                                        className="h-48 max-w-full rounded-md border border-border bg-black"
                                        title={video.filename}
                                      />
                                      <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                        {video.media === "seedance"
                                          ? "시댄스"
                                          : "영상"}
                                      </span>
                                      <button
                                        type="button"
                                        className="absolute -right-1.5 -top-1.5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 shadow ring-1 ring-border transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                        onClick={() =>
                                          void removeSituationVideo(
                                            situation.id,
                                            video
                                          )
                                        }
                                        aria-label="이 상황에서 영상 제거"
                                        title="이 상황에서 제거 (영상은 갤러리에 남아요)"
                                      >
                                        <X className="size-3" />
                                      </button>
                                      <button
                                        type="button"
                                        className="absolute -right-1.5 top-5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 shadow ring-1 ring-border transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                                        onClick={() =>
                                          void deleteSituationVideo(
                                            situation.id,
                                            video
                                          )
                                        }
                                        aria-label="영상 완전 삭제"
                                        title="영상 삭제 (갤러리에서도 사라져요)"
                                      >
                                        <Trash2 className="size-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        ))
                      )}
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
        <ImageLibraryPicker
          title="메인 이미지로 사용할 생성 이미지 선택"
          onClose={() => setGalleryOpen(false)}
          onPick={(image) => {
            applyMainImage(image);
            setGalleryOpen(false);
          }}
        />
      )}

      {situationPickerId && (
        <ImageLibraryPicker
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

      {situationVideoPickerId && (
        <VideoLibraryPicker
          title="갤러리에서 이 상황에 등록할 영상 선택"
          confirmLabel="상황에 등록"
          onClose={() => setSituationVideoPickerId(null)}
          onPickMany={(videos) => {
            const situationId = situationVideoPickerId;
            setSituationVideoPickerId(null);
            void attachSituationVideos(situationId, videos);
          }}
        />
      )}
    </div>
  );
}

