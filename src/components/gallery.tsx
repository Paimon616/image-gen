"use client";

import {
  memo,
  type UIEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
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
  ClipboardCopy,
  CopyPlus,
  Loader2,
  Sparkles,
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
  const cardRef = useRef<HTMLDivElement>(null);
  const initialAspectRatio =
    img.params?.width && img.params?.height
      ? img.params.width / img.params.height
      : 4 / 5;
  const [aspectRatio, setAspectRatio] = useState(initialAspectRatio);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorCopied, setErrorCopied] = useState(false);
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
      ? language === "ko" ? "대기열" : "Queued"
      : displayState === "waiting"
        ? language === "ko" ? "준비 중" : "Waiting"
        : displayState === "generating"
          ? language === "ko" ? "생성 중" : "Generating"
          : displayState === "error"
            ? language === "ko" ? "오류" : "Error"
            : displayState === "canceled"
              ? language === "ko" ? "취소됨" : "Canceled"
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

  const copyErrorDetails = async () => {
    const details = generation?.message || (language === "ko" ? "알 수 없는 생성 오류" : "Unknown generation error");
    try {
      await navigator.clipboard.writeText(details);
      setErrorCopied(true);
      window.setTimeout(() => setErrorCopied(false), 1600);
    } catch {
      setErrorCopied(false);
    }
  };

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const updateSpan = () => {
      const contentHeight = card.clientWidth / Math.max(aspectRatio, 0.05);
      card.style.gridRowEnd =
        "span " + Math.max(1, Math.ceil((contentHeight + 12) / 20));
    };
    const observer = new ResizeObserver(updateSpan);
    observer.observe(card);
    updateSpan();

    return () => observer.disconnect();
  }, [aspectRatio]);

  return (
    <>
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-lg border border-border transition-colors [contain-intrinsic-size:320px_420px] [content-visibility:auto] hover:border-primary/50"

    >
      {hasImage ? (
        <button
          type="button"
          className="block h-full w-full cursor-pointer overflow-hidden"
          onClick={() => onOpen(img)}
          aria-label="Open image details"
        >
          <img
            src={displayUrl}
            alt=""
            className="block h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            fetchPriority="low"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth && image.naturalHeight) {
                setAspectRatio(image.naturalWidth / image.naturalHeight);
              }
            }}
          />
        </button>
      ) : (
        <div className={`relative flex h-full min-h-0 flex-col justify-between overflow-hidden p-3 ${displayState === "generating" ? "bg-slate-950 text-white" : displayState === "error" ? "bg-red-50 text-red-950" : displayState === "canceled" ? "bg-slate-100 text-slate-700" : displayState === "waiting" ? "bg-amber-50 text-amber-950" : "bg-sky-50 text-sky-950"}`}>
          {displayState === "generating" && (<>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(34,211,238,0.28),transparent_38%),radial-gradient(circle_at_80%_70%,rgba(168,85,247,0.30),transparent_42%)]" />
            <div className="gallery-generation-orb pointer-events-none absolute -left-12 top-1/3 h-32 w-32 rounded-full bg-cyan-400/20 blur-2xl" />
            <div className="gallery-generation-orb pointer-events-none absolute -right-12 bottom-1/4 h-36 w-36 rounded-full bg-fuchsia-500/20 blur-2xl [animation-delay:-1.4s]" />
            <div className="gallery-generation-scan pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-cyan-300/20 to-transparent" />
            <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" />
          </>)}
          <div className="relative z-10 flex items-center justify-between gap-2">
            <Badge variant="outline" className={`rounded-md ${displayState === "generating" ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : displayState === "error" ? "border-red-300 bg-red-100 text-red-700" : displayState === "waiting" ? "border-amber-300 bg-amber-100 text-amber-800" : "border-sky-300 bg-sky-100 text-sky-800"}`}>
              {StatusIcon && (
                <StatusIcon
                  className={`h-3 w-3 ${
                    displayState === "generating" ? "animate-spin" : ""
                  }`}
                />
              )}
              {statusLabel || "Pending"}
            </Badge>
            <div className="flex items-center gap-1.5">
              <span className={`text-xs font-medium tabular-nums ${displayState === "generating" ? "text-cyan-100" : "opacity-70"}`}>
                {Math.round(progress)}%
              </span>
              {isPending && onCancelGeneration && (
                <Button type="button" size="xs" variant="outline" className={`h-7 px-2 text-[10px] shadow-sm ${displayState === "generating" ? "border-red-300/50 bg-red-500/20 text-red-100 hover:bg-red-500/35 hover:text-white" : "border-red-300 bg-red-100 text-red-700 hover:bg-red-200 hover:text-red-800"}`} onClick={() => onCancelGeneration(img)}>
                  <XCircle className="h-3.5 w-3.5" />
                  {language === "ko" ? "생성 취소" : "Cancel"}
                </Button>
              )}
            </div>
          </div>

          <div className="relative z-10 flex flex-1 items-center justify-center py-3">
            {displayState === "generating" ? (
              <div className="relative flex h-24 w-24 items-center justify-center">
                <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-r-violet-400 border-t-cyan-300" />
                <div className="absolute inset-2 animate-[spin_3s_linear_infinite_reverse] rounded-full border border-transparent border-b-fuchsia-300 border-l-cyan-200" />
                <div className="absolute inset-5 animate-pulse rounded-full bg-white/10 shadow-[0_0_30px_rgba(34,211,238,.35)]" />
                <Sparkles className="relative h-8 w-8 text-cyan-100 drop-shadow-[0_0_10px_rgba(103,232,249,.8)]" />
              </div>
            ) : displayState === "error" ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600 ring-1 ring-red-200"><AlertCircle className="h-7 w-7" /></span>
                <p className="text-sm font-semibold">{language === "ko" ? "생성에 실패했습니다" : "Generation failed"}</p>
              </div>
            ) : (
              <span className={`flex h-14 w-14 items-center justify-center rounded-full ${displayState === "waiting" ? "bg-amber-100 text-amber-600" : "bg-sky-100 text-sky-600"}`}>
                {StatusIcon && <StatusIcon className="h-7 w-7" />}
              </span>
            )}
          </div>
          <div className="relative z-10 space-y-2">
            {isPending && generation?.message && (
              <p className={`line-clamp-2 text-[11px] font-medium ${displayState === "generating" ? "text-cyan-100/80" : displayState === "waiting" ? "text-amber-800/80" : "text-sky-800/80"}`}>
                {generation.message}
              </p>
            )}
            <div className={`h-1.5 overflow-hidden rounded-full ${displayState === "generating" ? "bg-white/15" : "bg-black/10"}`}>
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${displayState === "error" ? "bg-red-500" : displayState === "waiting" ? "bg-amber-500" : "bg-gradient-to-r from-sky-500 via-cyan-400 to-violet-500"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className={`line-clamp-3 text-xs leading-5 ${displayState === "generating" ? "text-white/90" : ""}`}>
              {img.params?.prompt || "No prompt"}
            </p>
            {displayState === "error" && generation?.message && (
              <p className="line-clamp-2 text-[11px] text-red-700">
                {generation.message}
              </p>
            )}
            {displayState === "error" && (
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 min-w-0 px-1 text-[10px]"
                  onClick={() => onReuse(img)}
                  disabled={!img.params}
                  title={language === "ko" ? "실패 당시의 생성 설정을 편집 영역에 불러옵니다" : "Load the failed generation settings into the editor"}
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  {language === "ko" ? "설정 재사용" : "Reuse"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 min-w-0 px-1 text-[10px]"
                  onClick={() => void copyErrorDetails()}
                  title={language === "ko" ? "오류 메시지를 클립보드에 복사합니다" : "Copy the error message"}
                >
                  {errorCopied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
                  {errorCopied ? (language === "ko" ? "복사됨" : "Copied") : (language === "ko" ? "오류 복사" : "Copy")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 min-w-0 px-1 text-[10px]"
                  onClick={() => setConfirmingDelete(true)}
                  title={language === "ko" ? "오류 카드를 제거합니다" : "Remove this error card"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {language === "ko" ? "제거" : "Remove"}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {!hasImage && displayState === "error" && confirmingDelete && (
        <div className="absolute inset-x-3 bottom-3 z-30 rounded-md border border-red-200 bg-white p-2.5 shadow-xl">
          <p className="text-[11px] font-medium text-red-950">
            {language === "ko" ? "이 오류 카드를 제거할까요?" : "Remove this error card?"}
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
              {language === "ko" ? "제거" : "Remove"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 flex-1 text-[11px]" onClick={() => setConfirmingDelete(false)}>
              {language === "ko" ? "취소" : "Cancel"}
            </Button>
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
      {hasImage && !isPending && (
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
  thumbnailWidth?: number;
}

interface ImagesResponse {
  images?: GeneratedImage[];
  nextCursor?: number | null;
  total?: number;
}

export function Gallery({ onCancelGeneration, thumbnailWidth = 240 }: GalleryProps) {
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
        className="grid grid-flow-row-dense gap-3"
        style={{
          gridTemplateColumns:
            "repeat(auto-fill, minmax(min(100%, " + thumbnailWidth + "px), 1fr))",
          gridAutoRows: "8px",
        }}
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
