"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Loader2, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import {
  UNGROUPED_WORKSPACE_ID,
  type GeneratedImage,
  type WorkspaceSummary,
} from "@/lib/types";

// Tile width of the picker grid, in px. Persisted (and shared by every screen's
// picker) so the size the user dialed in survives closing the modal and reloads.
const TILE_KEY = "image-library-picker:tile";
const TILE_MIN = 80;
const TILE_MAX = 420;
const TILE_DEFAULT = 160;

// The grid packs tiles of mixed aspect ratios into 8px rows, exactly like the
// main gallery, so a picked image sits where the user remembers seeing it.
const ROW_HEIGHT = 8;
const GRID_GAP = 8;

const PAGE_SIZE = 60;

function readStoredTileSize() {
  if (typeof window === "undefined") return TILE_DEFAULT;
  const stored = Number(window.localStorage.getItem(TILE_KEY));
  if (!Number.isFinite(stored) || stored <= 0) return TILE_DEFAULT;
  return Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round(stored)));
}

/** Full-size overlay for looking at one image up close. Click anywhere (or
 *  press Escape) to dismiss. Used by the picker and by every image slot that
 *  wants "click the loaded image to see it big". */
export function ImageLightbox({
  src,
  alt = "",
  onClose,
  children,
}: {
  src: string;
  alt?: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/85 p-6"
      onClick={onClose}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        className="absolute right-4 top-4 text-white hover:bg-white/15 hover:text-white"
        aria-label="close"
      >
        <X />
      </Button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      />
      {children && (
        <div
          className="flex items-center gap-2"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One picker tile. Claims as many 8px grid rows as its aspect ratio needs so
 *  the grid stays a masonry of original-ratio thumbnails. */
function PickerTile({
  image,
  order,
  onPick,
  onZoom,
  label,
}: {
  image: GeneratedImage;
  order: number;
  onPick: () => void;
  onZoom: () => void;
  label: string;
}) {
  const tileRef = useRef<HTMLDivElement>(null);
  const [aspectRatio, setAspectRatio] = useState(
    image.params?.width && image.params?.height
      ? image.params.width / image.params.height
      : 4 / 5
  );

  useLayoutEffect(() => {
    const tile = tileRef.current;
    if (!tile) return;

    const updateSpan = () => {
      const contentHeight = tile.clientWidth / Math.max(aspectRatio, 0.05);
      const rows = Math.ceil(
        (contentHeight + GRID_GAP) / (ROW_HEIGHT + GRID_GAP)
      );
      tile.style.gridRowEnd = `span ${Math.max(1, rows)}`;
    };

    const observer = new ResizeObserver(updateSpan);
    observer.observe(tile);
    updateSpan();
    return () => observer.disconnect();
  }, [aspectRatio]);

  const selected = order > 0;

  return (
    <div
      ref={tileRef}
      className={`group relative overflow-hidden rounded-md border transition-colors ${
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/60"
      }`}
    >
      <button
        type="button"
        onClick={onPick}
        title={image.filename}
        className="block size-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl || image.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onLoad={(event) => {
            const loaded = event.currentTarget;
            if (loaded.naturalWidth && loaded.naturalHeight) {
              setAspectRatio(loaded.naturalWidth / loaded.naturalHeight);
            }
          }}
        />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onZoom();
        }}
        title={label}
        aria-label={label}
        className="absolute left-1 top-1 flex size-6 items-center justify-center rounded bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 focus:opacity-100 focus:outline-none group-hover:opacity-100"
      >
        <Maximize2 className="size-3.5" />
      </button>
      {selected && (
        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          {order}
        </span>
      )}
    </div>
  );
}

export interface ImageLibraryPickerProps {
  title?: string;
  /** Multi-select mode: tiles toggle and a footer confirms the batch. */
  multiple?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onPick?: (image: GeneratedImage) => void;
  onPickMany?: (images: GeneratedImage[]) => void;
}

/**
 * The single "load an image" browser used by character creation, image
 * generation, video generation, and SeeDance. Reads the same `/api/images`
 * feed and workspaces the gallery does, lays the results out as an
 * original-ratio masonry, and lets the user resize the tiles, narrow by
 * workspace, and open any image full-size before picking it.
 */
export function ImageLibraryPicker({
  title,
  multiple = false,
  confirmLabel,
  onClose,
  onPick,
  onPickMany,
}: ImageLibraryPickerProps) {
  const language = useStore((state) => state.language);
  const ko = language === "ko";

  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  // Selected filenames, in click order, so the confirm button can attach a batch.
  const [picked, setPicked] = useState<string[]>([]);
  const [tileSize, setTileSize] = useState(readStoredTileSize);
  // "" = every image; UNGROUPED_WORKSPACE_ID = only images in no workspace.
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [zoomed, setZoomed] = useState<GeneratedImage | null>(null);

  const changeTileSize = useCallback((next: number) => {
    setTileSize(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TILE_KEY, String(next));
    }
  }, []);

  // Escape closes the picker (the lightbox handles its own Escape first).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !zoomed) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, zoomed]);

  // The gallery's workspaces, so the picker can narrow a large library the same
  // way the gallery itself does.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch("/api/workspaces?media=images", {
          cache: "no-store",
        });
        const data = (await res.json()) as {
          workspaces?: WorkspaceSummary[];
          ungroupedCount?: number;
        };
        if (!active) return;
        setWorkspaces(data.workspaces ?? []);
        setUngroupedCount(data.ungroupedCount ?? 0);
      } catch {
        if (active) setWorkspaces([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const listUrl = useCallback(
    (nextCursor: number) => {
      const query = new URLSearchParams({
        limit: String(PAGE_SIZE),
        cursor: String(nextCursor),
      });
      if (workspaceId) query.set("workspaceId", workspaceId);
      return `/api/images?${query.toString()}`;
    },
    [workspaceId]
  );

  // Reloads page one on open and whenever the workspace changes.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await fetch(listUrl(0), { cache: "no-store" });
        const data = (await res.json()) as {
          images?: GeneratedImage[];
          nextCursor?: number | null;
          total?: number;
        };
        if (active) {
          setImages((data.images ?? []).filter((image) => image.url));
          setCursor(data.nextCursor ?? null);
          setTotal(typeof data.total === "number" ? data.total : null);
        }
      } catch {
        if (active) {
          setImages([]);
          setCursor(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [listUrl]);

  const loadMore = useCallback(async () => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await fetch(listUrl(cursor), { cache: "no-store" });
      const data = (await res.json()) as {
        images?: GeneratedImage[];
        nextCursor?: number | null;
      };
      setImages((prev) => [
        ...prev,
        ...(data.images ?? []).filter((image) => image.url),
      ]);
      setCursor(data.nextCursor ?? null);
    } catch {
      setCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, listUrl, loadingMore]);

  // Auto-load older images as the grid nears the bottom (mirrors the gallery).
  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (cursor === null || loadingMore) return;
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 240) {
        void loadMore();
      }
    },
    [cursor, loadMore, loadingMore]
  );

  const choose = useCallback(
    (image: GeneratedImage) => {
      if (multiple) {
        setPicked((prev) =>
          prev.includes(image.filename)
            ? prev.filter((name) => name !== image.filename)
            : [...prev, image.filename]
        );
        return;
      }
      onPick?.(image);
    },
    [multiple, onPick]
  );

  const confirm = useCallback(() => {
    if (picked.length === 0) return;
    const byFilename = new Map(images.map((image) => [image.filename, image]));
    onPickMany?.(
      picked
        .map((filename) => byFilename.get(filename))
        .filter((image): image is GeneratedImage => Boolean(image))
    );
  }, [images, onPickMany, picked]);

  const pickedOrder = useMemo(() => {
    const order = new Map<string, number>();
    picked.forEach((filename, index) => order.set(filename, index + 1));
    return order;
  }, [picked]);

  const zoomLabel = ko ? "크게 보기" : "View larger";

  return (
    <>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
        onClick={onClose}
      >
        <div
          className="flex max-h-[92vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">
              {title ??
                (ko ? "생성된 이미지에서 선택" : "Pick a generated image")}
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label={ko ? "닫기" : "Close"}
            >
              <X />
            </Button>
          </header>

          {/* Workspace filter + tile size. Both only change how the grid is
              browsed, so neither touches the current selection. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2">
            <label className="flex min-w-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
              {ko ? "워크스페이스" : "Workspace"}
              <select
                value={workspaceId}
                onChange={(event) => {
                  setLoading(true);
                  setWorkspaceId(event.target.value);
                }}
                className="h-8 w-48 rounded-md border border-border bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">{ko ? "전체" : "All"}</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name} ({workspace.count})
                  </option>
                ))}
                <option value={UNGROUPED_WORKSPACE_ID}>
                  {ko ? "미분류" : "Ungrouped"} ({ungroupedCount})
                </option>
              </select>
            </label>
            <label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
              <span className="whitespace-nowrap">
                {ko ? "이미지 크기" : "Image size"}
              </span>
              <input
                type="range"
                min={TILE_MIN}
                max={TILE_MAX}
                step={8}
                value={tileSize}
                onChange={(event) => changeTileSize(Number(event.target.value))}
                className="h-1.5 min-w-24 max-w-56 flex-1 accent-primary"
                aria-label={ko ? "이미지 크기" : "Image size"}
              />
              <span className="w-12 shrink-0 text-right tabular-nums">
                {tileSize}px
              </span>
            </label>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto p-4"
            onScroll={handleScroll}
          >
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {ko ? "불러오는 중" : "Loading"}
              </div>
            ) : images.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {workspaceId
                  ? ko
                    ? "이 워크스페이스에는 이미지가 없어요."
                    : "This workspace has no images."
                  : ko
                    ? "생성된 이미지가 없어요."
                    : "No generated images yet."}
              </p>
            ) : (
              <>
                <div
                  className="grid grid-flow-row-dense"
                  style={{
                    gap: `${GRID_GAP}px`,
                    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${tileSize}px), 1fr))`,
                    gridAutoRows: `${ROW_HEIGHT}px`,
                  }}
                >
                  {images.map((image) => (
                    <PickerTile
                      key={image.id || image.filename}
                      image={image}
                      order={pickedOrder.get(image.filename) ?? 0}
                      onPick={() => choose(image)}
                      onZoom={() => setZoomed(image)}
                      label={zoomLabel}
                    />
                  ))}
                </div>
                {cursor !== null && (
                  <div className="mt-3 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      {images.length}
                      {total !== null ? ` / ${total}` : ""}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void loadMore()}
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="animate-spin" />
                          {ko ? "불러오는 중" : "Loading"}
                        </>
                      ) : ko ? (
                        "더 보기"
                      ) : (
                        "Load more"
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
                  ? ko
                    ? `${picked.length}개 선택됨`
                    : `${picked.length} selected`
                  : ko
                    ? "추가할 이미지를 선택하세요."
                    : "Select the images to add."}
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  {ko ? "취소" : "Cancel"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={confirm}
                  disabled={picked.length === 0}
                >
                  {confirmLabel ?? (ko ? "추가" : "Add")}
                </Button>
              </div>
            </footer>
          )}
        </div>
      </div>

      {zoomed && (
        <ImageLightbox
          src={zoomed.url}
          alt={zoomed.filename}
          onClose={() => setZoomed(null)}
        >
          <Button
            type="button"
            size="sm"
            onClick={() => {
              const image = zoomed;
              setZoomed(null);
              choose(image);
            }}
          >
            {multiple
              ? pickedOrder.has(zoomed.filename)
                ? ko
                  ? "선택 해제"
                  : "Deselect"
                : ko
                  ? "선택"
                  : "Select"
              : ko
                ? "이 이미지 사용"
                : "Use this image"}
          </Button>
        </ImageLightbox>
      )}
    </>
  );
}
