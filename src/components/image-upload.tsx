"use client";

import { useCallback, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ImageLibraryPicker,
  ImageLightbox,
} from "@/components/image-library-picker";
import { useStore } from "@/lib/store";
import type { GeneratedImage } from "@/lib/types";

interface ImageUploadProps {
  label: string;
  description: string;
  value: string | null;
  onChange: (url: string | null) => void;
  // Overrides the built-in click-to-enlarge on the loaded image (used where the
  // caller already has a richer viewer for it).
  onPreview?: () => void;
  previewClassName?: string;
  // Set false on slots that must not accept an already-generated image.
  allowGallery?: boolean;
  // Fired (after onChange) when the value came from the gallery picker, with the
  // full library image — lets the parent read extra metadata (e.g. generation
  // params) beyond the URL.
  onPickFromGallery?: (image: GeneratedImage) => void;
}

export function ImageUpload({
  label,
  description,
  value,
  onChange,
  onPreview,
  previewClassName = "h-40 w-full object-cover",
  allowGallery = true,
  onPickFromGallery,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const language = useStore((state) => state.language);
  const ko = language === "ko";
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
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

  // URLs from the picker may be relative (e.g. /api/images/x.png) — resolve them
  // to absolute so the generation backend can fetch them.
  const pickFromGallery = useCallback(
    (image: GeneratedImage) => {
      let absolute = image.url;
      try {
        absolute = new URL(image.url, window.location.href).href;
      } catch {
        // Keep the raw value if it can't be parsed (already absolute or opaque).
      }
      onChange(absolute);
      onPickFromGallery?.(image);
      setPickerOpen(false);
    },
    [onChange, onPickFromGallery]
  );

  const enlarge = onPreview ?? (() => setZoomOpen(true));

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
          role="button"
          tabIndex={0}
          onClick={enlarge}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              enlarge();
            }
          }}
          title={ko ? "클릭하면 크게 볼 수 있어요" : "Click to view larger"}
          className="relative group cursor-zoom-in focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
            {allowGallery && (
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
            {allowGallery && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setPickerOpen(true)}
                disabled={uploading}
                title={
                  ko
                    ? "생성된 이미지에서 선택합니다"
                    : "Pick an image from your gallery"
                }
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

    {pickerOpen && (
      <ImageLibraryPicker
        title={label}
        onClose={() => setPickerOpen(false)}
        onPick={pickFromGallery}
      />
    )}

    {zoomOpen && value && (
      <ImageLightbox src={value} alt={label} onClose={() => setZoomOpen(false)} />
    )}
    </>
  );
}
