"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import type { GeneratedImage, HistoryEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  BookmarkPlus,
  Check,
  Clock,
  CopyPlus,
  Loader2,
  Trash2,
  XCircle,
} from "lucide-react";

const INITIAL_VISIBLE_IMAGES = 36;
const LOAD_MORE_IMAGES = 36;

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
}

const GalleryCard = memo(function GalleryCard({
  img,
  scrapped,
  scrapping,
  onOpen,
  onReuse,
  onScrap,
  onDelete,
}: GalleryCardProps) {
  const generation = img.generation;
  const hasImage = Boolean(img.url);
  const isPending =
    generation?.state === "queued" || generation?.state === "generating";
  const canUseCompletedImageActions = hasImage && !isPending;
  const progress = Math.min(100, Math.max(0, generation?.progress ?? 0));
  const statusLabel =
    generation?.state === "queued"
      ? "Queued"
      : generation?.state === "generating"
        ? "Generating"
        : generation?.state === "error"
          ? "Error"
          : generation?.state === "canceled"
            ? "Canceled"
            : "";
  const StatusIcon =
    generation?.state === "queued"
      ? Clock
      : generation?.state === "generating"
        ? Loader2
        : generation?.state === "error"
          ? AlertCircle
          : generation?.state === "canceled"
            ? XCircle
            : null;

  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-border transition-colors [contain-intrinsic-size:320px] [content-visibility:auto] hover:border-primary/50">
      {hasImage ? (
        <button
          type="button"
          className="absolute inset-0 cursor-pointer"
          onClick={() => onOpen(img)}
          aria-label="Open image details"
        >
          <img
            src={img.url}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </button>
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="rounded-md">
              {StatusIcon && (
                <StatusIcon
                  className={`h-3 w-3 ${
                    generation?.state === "generating" ? "animate-spin" : ""
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
          </div>
        </div>
      )}
      {scrapped && (
        <Badge className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-primary/95 text-primary-foreground shadow-sm">
          <Check className="h-3 w-3" />
          스크랩됨
        </Badge>
      )}
      {hasImage && generation && generation.state !== "completed" && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 rounded-md bg-black/70 px-2 py-1.5 text-white shadow-sm">
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
        </div>
      )}
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
            정보 그대로 가져다쓰기
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="pointer-events-auto bg-white/90 text-black hover:bg-white"
            onClick={() => onScrap(img)}
            disabled={!img.params || !canUseCompletedImageActions || scrapping || scrapped}
            aria-label="Scrap image"
          >
            {scrapped ? <Check /> : <BookmarkPlus />}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="destructive"
            className="pointer-events-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => onDelete(img)}
            disabled={isPending}
            aria-label="Delete image"
          >
            <Trash2 />
          </Button>
        </div>
        <div className="absolute bottom-2 left-2 right-2">
          <p className="truncate text-xs text-white">
            {img.params?.prompt || "No prompt"}
          </p>
        </div>
      </div>
    </div>
  );
});

export function Gallery() {
  const images = useStore((state) => state.images);
  const setSelectedImage = useStore((state) => state.setSelectedImage);
  const addImages = useStore((state) => state.addImages);
  const loadParamsFromImage = useStore((state) => state.loadParamsFromImage);
  const removeImage = useStore((state) => state.removeImage);
  const [scrappingIds, setScrappingIds] = useState<Set<string>>(new Set());
  const [scrappedKeys, setScrappedKeys] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_IMAGES);

  const visibleImages = useMemo(
    () => images.slice(0, visibleCount),
    [images, visibleCount]
  );
  const scrappedImageIds = useMemo(() => {
    const ids = new Set<string>();

    visibleImages.forEach((img) => {
      if (generatedImageKeys(img).some((key) => scrappedKeys.has(key))) {
        ids.add(img.id);
      }
    });

    return ids;
  }, [visibleImages, scrappedKeys]);
  const hasMoreImages = visibleCount < images.length;

  useEffect(() => {
    fetch("/api/images")
      .then((r) => r.json())
      .then((data) => {
        if (data.images) {
          addImages(data.images);
        }
      })
      .catch(() => {});
  }, [addImages]);

  useEffect(() => {
    fetch("/api/scrap", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const entries = Array.isArray(data.entries)
          ? (data.entries as HistoryEntry[])
          : [];

        setScrappedKeys(new Set(entries.flatMap(generatedScrapKeys)));
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

  const handleScrap = useCallback(async (img: GeneratedImage) => {
    if (!img.params) return;

    setScrappingIds((current) => new Set(current).add(img.id));

    try {
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

      setScrappedKeys((current) => {
        const next = new Set(current);
        generatedImageKeys(img).forEach((key) => next.add(key));
        return next;
      });
    } catch {
      setScrappedKeys((current) => {
        const next = new Set(current);
        generatedImageKeys(img).forEach((key) => next.delete(key));
        return next;
      });
    } finally {
      setScrappingIds((current) => {
        const next = new Set(current);
        next.delete(img.id);
        return next;
      });
    }
  }, []);

  const handleDelete = useCallback(
    async (img: GeneratedImage) => {
      if (img.filename) {
        await fetch(`/api/images/${img.filename}`, { method: "DELETE" });
      }
      removeImage(img.id);
    },
    [removeImage]
  );

  const handleLoadMore = useCallback(() => {
    setVisibleCount((count) =>
      Math.min(count + LOAD_MORE_IMAGES, images.length)
    );
  }, [images.length]);

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
    <div className="flex-1 overflow-y-auto p-3">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
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
          />
        ))}
      </div>
      {hasMoreImages && (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="text-xs text-muted-foreground">
            {visibleImages.length} / {images.length} images
          </p>
          <Button type="button" variant="outline" onClick={handleLoadMore}>
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}
