"use client";

import { useCallback, useEffect, useState } from "react";
import { Images, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GeneratedImage } from "@/lib/types";
import { toAbsoluteImageUrl } from "@/lib/video-reference";

const PAGE_SIZE = 24;

interface VideoReferenceImportProps {
  language: "ko" | "en";
  onSelect: (url: string) => void;
}

/**
 * Lets the video screen pull a start/reference image straight from the images
 * produced on the Image Generation screen. Fetches the same `/api/images`
 * feed the gallery uses, shows a thumbnail grid, and hands the chosen image's
 * URL back to the caller.
 */
export function VideoReferenceImport({
  language,
  onSelect,
}: VideoReferenceImportProps) {
  const ko = language === "ko";
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPage = useCallback(async (cursor: number) => {
    setLoading(true);
    setError("");
    if (cursor === 0) {
      setImages([]);
      setNextCursor(0);
    }
    try {
      const query = new URLSearchParams({
        cursor: String(cursor),
        limit: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/images?${query.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Failed to load images (${res.status}).`);
      const data = await res.json();
      const loaded = Array.isArray(data.images)
        ? (data.images as GeneratedImage[]).filter((image) => image.url)
        : [];
      setImages((current) =>
        cursor === 0 ? loaded : [...current, ...loaded]
      );
      setNextCursor(
        typeof data.nextCursor === "number" ? data.nextCursor : null
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : ko
            ? "이미지를 불러오지 못했습니다."
            : "Could not load images."
      );
    } finally {
      setLoading(false);
    }
  }, [ko]);

  // Load (or refresh) the first page whenever the picker opens.
  useEffect(() => {
    if (!open) return;
    void loadPage(0);
  }, [open, loadPage]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        title={
          ko
            ? "이미지 생성 화면에서 만든 이미지를 레퍼런스로 가져옵니다"
            : "Import an image made on the Image Generation screen"
        }
      >
        <Images className="h-4 w-4" />
        {ko ? "이미지 생성에서 가져오기" : "Import from Image Generation"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] w-[92vw] max-w-3xl overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>
              {ko ? "이미지 생성에서 가져오기" : "Import from Image Generation"}
            </DialogTitle>
            <DialogDescription>
              {ko
                ? "레퍼런스(시작) 이미지로 사용할 이미지를 선택하세요."
                : "Choose an image to use as the start/reference image."}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto p-4">
            {error && (
              <p className="mb-3 text-sm text-destructive">{error}</p>
            )}
            {images.length === 0 && !loading && !error ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {ko
                  ? "아직 생성된 이미지가 없습니다."
                  : "No generated images yet."}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {images.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => {
                      onSelect(toAbsoluteImageUrl(image.url));
                      setOpen(false);
                    }}
                    className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted transition-colors hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={image.filename}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.thumbnailUrl || image.url}
                      alt={image.filename}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex justify-center">
              {loading ? (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {ko ? "불러오는 중" : "Loading"}
                </span>
              ) : nextCursor !== null && images.length > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void loadPage(nextCursor)}
                >
                  {ko ? "더 보기" : "Load more"}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
