"use client";

import { useCallback, useRef, useState, type UIEvent } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface GalleryPick {
  url: string;
  thumbnailUrl?: string;
}

interface ImageUploadProps {
  label: string;
  description: string;
  value: string | null;
  onChange: (url: string | null) => void;
  onPreview?: () => void;
  previewClassName?: string;
  // When provided, a "Gallery" action lets the user pick one of these images as
  // the value. URLs may be relative (e.g. /api/images/x.png) — they are resolved
  // to absolute before being emitted so the generation backend can fetch them.
  galleryImages?: GalleryPick[];
  // Paginated gallery: when there are older images to fetch, the picker shows a
  // "load more" button and auto-loads as the grid nears its bottom.
  onLoadMoreGallery?: () => void;
  galleryHasMore?: boolean;
  galleryLoadingMore?: boolean;
  galleryTotal?: number;
}

export function ImageUpload({
  label,
  description,
  value,
  onChange,
  onPreview,
  previewClassName = "h-40 w-full object-cover",
  galleryImages,
  onLoadMoreGallery,
  galleryHasMore = false,
  galleryLoadingMore = false,
  galleryTotal,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pasteError, setPasteError] = useState("");

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setPasteError("");
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.url) onChange(data.url);
      } catch (err) {
        console.error("Upload failed:", err);
      } finally {
        setUploading(false);
      }
    },
    [onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file?.type.startsWith("image/")) upload(file);
    },
    [upload]
  );

  // Cmd/Ctrl+V while the card is focused: pull the first image off the clipboard.
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const item = Array.from(e.clipboardData.items).find((entry) =>
        entry.type.startsWith("image/")
      );
      if (!item) return;
      e.preventDefault();
      const file = item.getAsFile();
      if (file) upload(file);
    },
    [upload]
  );

  // Explicit "Paste" button: reads the clipboard via the async API (no focus
  // needed). Falls back with a hint if the browser blocks clipboard reads.
  const pasteFromClipboard = useCallback(async () => {
    setPasteError("");
    try {
      if (!navigator.clipboard?.read) {
        setPasteError("Press Ctrl/Cmd+V here instead");
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          const ext = type.split("/")[1] || "png";
          await upload(new File([blob], `pasted.${ext}`, { type }));
          return;
        }
      }
      setPasteError("No image in clipboard");
    } catch {
      setPasteError("Press Ctrl/Cmd+V here instead");
    }
  }, [upload]);

  const pickFromGallery = useCallback(
    (url: string) => {
      let absolute = url;
      try {
        absolute = new URL(url, window.location.href).href;
      } catch {
        // Keep the raw value if it can't be parsed (already absolute or opaque).
      }
      onChange(absolute);
      setPickerOpen(false);
    },
    [onChange]
  );

  // Auto-load older images as the grid nears the bottom (mirrors the main gallery).
  const handlePickerScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!galleryHasMore || galleryLoadingMore || !onLoadMoreGallery) return;
      const el = event.currentTarget;
      if (el.scrollHeight - el.scrollTop - el.clientHeight <= 120) {
        onLoadMoreGallery();
      }
    },
    [galleryHasMore, galleryLoadingMore, onLoadMoreGallery]
  );

  const hasGallery = Array.isArray(galleryImages);

  return (
    <>
    <Card
      tabIndex={0}
      onPaste={handlePaste}
      className={`relative overflow-hidden border-dashed transition-colors focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/30 ${
        dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
        }}
      />

      {value ? (
        <div
          role={onPreview ? "button" : undefined}
          tabIndex={onPreview ? 0 : undefined}
          onClick={onPreview}
          onKeyDown={(event) => {
            if (!onPreview) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onPreview();
            }
          }}
          className={`relative group ${onPreview ? "cursor-zoom-in focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/30" : ""}`}
        >
          <img src={value} alt={label} className={previewClassName} />
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="sm"
              variant="secondary"
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Replace
            </Button>
            {hasGallery && (
              <Button
                size="sm"
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  setPickerOpen(true);
                }}
              >
                Gallery
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
            >
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <button
            type="button"
            className="w-full cursor-pointer p-6 text-center transition-colors hover:bg-muted/50"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
                <span className="text-sm text-muted-foreground">Uploading...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <svg
                  className="h-8 w-8 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z"
                  />
                </svg>
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </div>
            )}
          </button>
          <div className="flex items-center justify-center gap-2 border-t border-dashed border-muted-foreground/25 p-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={pasteFromClipboard}
              disabled={uploading}
              title="Paste an image from the clipboard (or focus this box and press Ctrl/Cmd+V)"
            >
              Paste
            </Button>
            {hasGallery && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setPickerOpen(true)}
                disabled={uploading}
                title="Pick an image from your gallery"
              >
                Gallery
              </Button>
            )}
          </div>
          {pasteError && (
            <p className="px-2 pb-2 text-center text-xs text-yellow-500">{pasteError}</p>
          )}
        </div>
      )}
    </Card>

    {hasGallery && (
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[88vh] w-[94vw] max-w-5xl overflow-hidden border border-border bg-card p-0 sm:max-w-5xl">
          <DialogTitle className="border-b border-border px-5 py-3 text-sm font-semibold">
            {label}
          </DialogTitle>
          <div
            className="max-h-[calc(88vh-3.25rem)] overflow-y-auto p-4"
            onScroll={handlePickerScroll}
          >
            {galleryImages && galleryImages.length > 0 ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {galleryImages.map((img, index) => (
                    <button
                      key={`${img.url}-${index}`}
                      type="button"
                      onClick={() => pickFromGallery(img.url)}
                      className="group relative overflow-hidden rounded-lg border border-border bg-muted/40 transition-colors hover:border-primary focus:outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-ring/30"
                    >
                      <img
                        src={img.thumbnailUrl || img.url}
                        alt=""
                        loading="lazy"
                        className="aspect-square w-full object-contain"
                      />
                    </button>
                  ))}
                </div>
                {galleryHasMore && (
                  <div className="flex flex-col items-center gap-2 py-4">
                    <p className="text-xs text-muted-foreground">
                      {galleryImages.length}
                      {typeof galleryTotal === "number" ? ` / ${galleryTotal}` : ""}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onLoadMoreGallery?.()}
                      disabled={galleryLoadingMore}
                    >
                      {galleryLoadingMore ? "Loading..." : "더보기"}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No saved images yet
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )}
    </>
  );
}
