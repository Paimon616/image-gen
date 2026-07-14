"use client";

import {
  memo,
  type UIEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useStore } from "@/lib/store";
import type { GeneratedImage, HistoryEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CivitaiOriginModal } from "@/components/civitai-origin-modal";
import {
  AlertCircle,
  BookmarkCheck,
  BookmarkPlus,
  Check,
  Clock,
  CopyPlus,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";

const INITIAL_VISIBLE_IMAGES = 18;
const LOAD_MORE_IMAGES = INITIAL_VISIBLE_IMAGES;

function generatedImageKeys(img: GeneratedImage) {
  return [
    img.id,
    img.url,
    img.filename,
    img.filename ? `/api/images/${img.filename}` : "",
  ].filter(Boolean);
}

function generatedScrapKeys(entry: HistoryEntry) {
  if (entry.source !== "generated") return [];

  return [
    entry.requestedUrl,
    entry.imageUrl,
    entry.localImageFilename ?? "",
    entry.localImageUrl ?? "",
  ].filter(Boolean);
}

interface GalleryCardProps {
  img: GeneratedImage;
  scrapped: boolean;
  scrapping: boolean;
  onOpen: (img: GeneratedImage) => void;
  onReuse: (img: GeneratedImage) => void;
  onScrap: (img: GeneratedImage) => void;
  onDelete: (img: GeneratedImage) => void;
  onCancelGeneration?: (img: GeneratedImage) => void;
}

const GalleryCard = memo(function GalleryCard({
  img,
  scrapped,
  scrapping,
  onOpen,
  onReuse,
  onScrap,
  onDelete,
  onCancelGeneration,
}: GalleryCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [originOpen, setOriginOpen] = useState(false);
  const language = useStore((state) => state.language);
  const generation = img.generation;
  const hasImage = Boolean(img.url);
  const civitaiOrigin = img.civitaiOrigin;
  const displayUrl =
    img.thumbnailUrl ||
    (img.filename ? `/api/images/thumb/${img.filename}` : img.url);
  const displayState =
    generation?.state === "generating" &&
    /queued|waiting for comfyui/i.test(generation.message)
      ? "waiting"
      : generation?.state;
  const isPending =
    displayState === "queued" ||
    displayState === "waiting" ||
    displayState === "generating";
  const canUseCompletedImageActions = hasImage && !isPending;
  const progress = Math.min(100, Math.max(0, generation?.progress ?? 0));
  const statusLabel =
    displayState === "queued"
      ? "Queued"
      : displayState === "waiting"
        ? "Waiting"
        : displayState === "generating"
          ? "Generating"
          : displayState === "error"
            ? "Error"
            : displayState === "canceled"
              ? "Canceled"
              : "";
  const StatusIcon =
    displayState === "queued"
      ? Clock
      : displayState === "waiting"
        ? Clock
        : displayState === "generating"
          ? Loader2
          : displayState === "error"
            ? AlertCircle
            : displayState === "canceled"
              ? XCircle
              : null;

  return (
    <>
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border transition-colors [contain-intrinsic-size:320px] [content-visibility:auto] hover:border-primary/50">
      {hasImage ? (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer"
          onClick={() => onOpen(img)}
          aria-label="Open image details"
        >
          <img
            src={displayUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
          />
        </button>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="rounded-md">
              {StatusIcon && (
                <StatusIcon
                  className={`h-3 w-3 ${
                    displayState === "generating" ? "animate-spin" : ""
                  }`}
                />
              )}
              {statusLabel || "Pending"}
            </Badge>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Math.round(progress)}%
            </span>
          </div>

          <div className="space-y-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="line-clamp-4 text-xs leading-5 text-foreground">
              {img.params?.prompt || "No prompt"}
            </p>
            {generation?.message && (
              <p className="truncate text-[11px] text-muted-foreground">
                {generation.message}
              </p>
            )}
            {isPending && onCancelGeneration && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="w-full"
                onClick={() => onCancelGeneration(img)}
              >
                <XCircle />
                생성 취소
              </Button>
            )}
          </div>
        </div>
      )}
      {scrapped && (
        <Badge className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-primary/95 text-primary-foreground shadow-sm">
          <Check className="h-3 w-3" />
          스크랩됨
        </Badge>
      )}
      {hasImage && civitaiOrigin && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setOriginOpen(true);
          }}
          className="absolute bottom-2 left-2 z-20 h-14 w-14 overflow-hidden rounded-md border-2 border-white/80 shadow-md transition-transform hover:scale-105"
          aria-label={language === "ko" ? "원본 Civitai 이미지 보기" : "View original Civitai image"}
          title={language === "ko" ? "원본 Civitai 이미지" : "Original Civitai image"}
        >
          <img
            src={civitaiOrigin.imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        </button>
      )}
      {hasImage && generation && generation.state !== "completed" && (
        <div className="absolute inset-x-2 bottom-2 z-10 rounded-md bg-black/70 px-2 py-1.5 text-white shadow-sm">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span>{statusLabel}</span>
            <span className="tabular-nums">{Math.round(progress)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-cyan-300 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          {isPending && onCancelGeneration && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="mt-2 h-7 w-full text-xs"
              onClick={() => onCancelGeneration(img)}
            >
              <XCircle />
              생성 취소
            </Button>
          )}
        </div>
      )}
      {!isPending && (
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
        <div className="absolute left-2 right-2 top-2 flex gap-1.5">
          <Button
            type="button"
            size="sm"
            className="pointer-events-auto min-w-0 flex-1 bg-white/90 px-1.5 text-[11px] text-black hover:bg-white"
            onClick={() => onReuse(img)}
            disabled={!img.params}
          >
            <CopyPlus />
            가져오기
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="pointer-events-auto bg-white/90 text-black hover:bg-white"
            onClick={() => onScrap(img)}
            disabled={!img.params || !canUseCompletedImageActions || scrapping}
            aria-label={scrapped ? "Remove scrap" : "Scrap image"}
            title={scrapped ? "스크랩 취소" : "스크랩"}
          >
            {scrapping ? (
              <Loader2 className="animate-spin" />
            ) : scrapped ? (
              <BookmarkCheck />
            ) : (
              <BookmarkPlus />
            )}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            className="pointer-events-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => setConfirmingDelete((current) => !current)}
            disabled={isPending}
            aria-label="Delete image"
          >
            <Trash2 />
          </Button>
        </div>
        {confirmingDelete && (
          <div className="pointer-events-auto absolute right-2 top-11 z-20 w-44 rounded-md border border-border bg-popover p-2.5 shadow-xl">
            <p className="text-[11px] font-medium leading-4 text-popover-foreground">
              이미지를 삭제할까요?
            </p>
            <div className="mt-2 flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 flex-1 text-[11px]"
                onClick={() => {
                  setConfirmingDelete(false);
                  onDelete(img);
                }}
              >
                삭제
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 flex-1 text-[11px]"
                onClick={() => setConfirmingDelete(false)}
              >
                취소
              </Button>
            </div>
          </div>
        )}
        <div className={`absolute bottom-2 right-2 ${civitaiOrigin ? "left-[4.5rem]" : "left-2"}`}>
          <p className="truncate text-xs text-white">
            {img.params?.prompt || "No prompt"}
          </p>
        </div>
      </div>
      )}
    </div>
    {civitaiOrigin && (
      <CivitaiOriginModal
        origin={civitaiOrigin}
        open={originOpen}
        onOpenChange={setOriginOpen}
        language={language}
      />
    )}
    </>
  );
});

interface GalleryProps {
  onCancelGeneration?: (img: GeneratedImage) => void;
  columns?: number;
}

interface ImagesResponse {
  images?: GeneratedImage[];
  nextCursor?: number | null;
  total?: number;
}

export function Gallery({ onCancelGeneration, columns = 3 }: GalleryProps) {
  const images = useStore((state) => state.images);
  const setSelectedImage = useStore((state) => state.setSelectedImage);
  const addImages = useStore((state) => state.addImages);
  const loadParamsFromImage = useStore((state) => state.loadParamsFromImage);
  const removeImage = useStore((state) => state.removeImage);
  const [scrappingIds, setScrappingIds] = useState<Set<string>>(new Set());
  const [scrapIdByKey, setScrapIdByKey] = useState<Map<string, string>>(
    new Map()
  );
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [totalImages, setTotalImages] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const visibleImages = images;
  const scrappedImageIds = useMemo(() => {
    const ids = new Set<string>();

    visibleImages.forEach((img) => {
      if (generatedImageKeys(img).some((key) => scrapIdByKey.has(key))) {
        ids.add(img.id);
      }
    });

    return ids;
  }, [visibleImages, scrapIdByKey]);
  const hasMoreImages = nextCursor !== null;

  const loadImagePage = useCallback(
    async (cursor: number) => {
      const response = await fetch(
        `/api/images?cursor=${cursor}&limit=${LOAD_MORE_IMAGES}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as ImagesResponse;

      if (Array.isArray(data.images)) {
        addImages(data.images);
      }

      setNextCursor(data.nextCursor ?? null);
      setTotalImages(data.total ?? 0);
    },
    [addImages]
  );

  useEffect(() => {
    loadImagePage(0).catch(() => {});
  }, [loadImagePage]);

  useEffect(() => {
    fetch("/api/scrap", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const entries = Array.isArray(data.entries)
          ? (data.entries as HistoryEntry[])
          : [];

        setScrapIdByKey(
          new Map(
            entries.flatMap((entry) =>
              generatedScrapKeys(entry).map(
                (key) => [key, entry.id] as const
              )
            )
          )
        );
      })
      .catch(() => {});
  }, []);

  const handleOpen = useCallback(
    (img: GeneratedImage) => {
      if (!img.url) return;

      setSelectedImage(img);
    },
    [setSelectedImage]
  );

  const handleReuse = useCallback(
    (img: GeneratedImage) => {
      if (!img.params) return;

      loadParamsFromImage(img);
    },
    [loadParamsFromImage]
  );

  const handleScrap = useCallback(
    async (img: GeneratedImage) => {
      if (!img.params) return;

      const keys = generatedImageKeys(img);
      const existingId = keys
        .map((key) => scrapIdByKey.get(key))
        .find((value): value is string => Boolean(value));

      setScrappingIds((current) => new Set(current).add(img.id));

      try {
        if (existingId) {
          const response = await fetch("/api/scrap", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existingId }),
          });

          if (!response.ok) {
            throw new Error("Failed to remove scrap.");
          }

          setScrapIdByKey((current) => {
            const next = new Map(current);
            for (const [key, id] of current) {
              if (id === existingId) next.delete(key);
            }
            return next;
          });
        } else {
          const response = await fetch("/api/scrap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              generatedImage: img,
              params: img.params,
            }),
          });

          if (!response.ok) {
            throw new Error("Failed to scrap generated image.");
          }

          const data = (await response.json()) as { entry?: HistoryEntry };
          const entryId = data.entry?.id;

          if (entryId) {
            setScrapIdByKey((current) => {
              const next = new Map(current);
              keys.forEach((key) => next.set(key, entryId));
              return next;
            });
          }
        }
      } finally {
        setScrappingIds((current) => {
          const next = new Set(current);
          next.delete(img.id);
          return next;
        });
      }
    },
    [scrapIdByKey]
  );

  const handleDelete = useCallback(
    async (img: GeneratedImage) => {
      if (img.filename) {
        await fetch(`/api/images/${img.filename}`, { method: "DELETE" });
      }
      removeImage(img.id);
    },
    [removeImage]
  );

  const handleLoadMore = useCallback(async () => {
    if (nextCursor === null || loadingMore) return;

    setLoadingMore(true);
    try {
      await loadImagePage(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [loadImagePage, loadingMore, nextCursor]);

  const handleGalleryScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const distanceToBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight;

      if (distanceToBottom <= 80) {
        void handleLoadMore();
      }
    },
    [handleLoadMore]
  );

  if (images.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <svg
            className="h-16 w-16 mx-auto mb-4 opacity-30"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
            />
          </svg>
          <p className="text-sm">No images yet</p>
          <p className="text-xs mt-1">
            Generate your first image to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3" onScroll={handleGalleryScroll}>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {visibleImages.map((img) => (
          <GalleryCard
            key={img.id}
            img={img}
            scrapped={scrappedImageIds.has(img.id)}
            scrapping={scrappingIds.has(img.id)}
            onOpen={handleOpen}
            onReuse={handleReuse}
            onScrap={handleScrap}
            onDelete={handleDelete}
            onCancelGeneration={onCancelGeneration}
          />
        ))}
      </div>
      {hasMoreImages && (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-xs text-muted-foreground">
            {visibleImages.length} / {totalImages} images
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}
