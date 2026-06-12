"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import type { GeneratedImage } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { CopyPlus, Trash2 } from "lucide-react";

export function Gallery() {
  const {
    images,
    setSelectedImage,
    addImages,
    loadParamsFromImage,
    removeImage,
  } = useStore();

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

  const handleReuse = (img: GeneratedImage) => {
    loadParamsFromImage(img);
  };

  const handleDelete = async (img: GeneratedImage) => {
    await fetch(`/api/images/${img.filename}`, { method: "DELETE" });
    removeImage(img.id);
  };

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
          <p className="text-xs mt-1">Generate your first image to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {images.map((img) => (
          <div
            key={img.id}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border transition-colors hover:border-primary/50"
          >
            <button
              type="button"
              className="absolute inset-0 cursor-pointer"
              onClick={() => setSelectedImage(img)}
              aria-label="Open image details"
            >
              <img
                src={img.url}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </button>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100">
              <div className="absolute left-2 right-2 top-2 flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  className="pointer-events-auto min-w-0 flex-1 bg-white/90 px-1.5 text-[11px] text-black hover:bg-white"
                  onClick={() => handleReuse(img)}
                >
                  <CopyPlus />
                  정보 그대로 가져다쓰기
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="destructive"
                  className="pointer-events-auto bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => handleDelete(img)}
                  aria-label="Delete image"
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="absolute bottom-2 left-2 right-2">
                <p className="text-white text-xs truncate">
                  {img.params?.prompt || "No prompt"}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
