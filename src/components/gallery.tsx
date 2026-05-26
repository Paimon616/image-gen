"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import type { GeneratedImage } from "@/lib/types";

export function Gallery() {
  const { images, setSelectedImage, addImage } = useStore();

  useEffect(() => {
    fetch("/api/images")
      .then((r) => r.json())
      .then((data) => {
        if (data.images) {
          const existing = useStore.getState().images;
          const existingIds = new Set(existing.map((img) => img.id));
          data.images.forEach((img: GeneratedImage) => {
            if (!existingIds.has(img.id)) addImage(img);
          });
        }
      })
      .catch(() => {});
  }, [addImage]);

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
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            className="group relative aspect-square overflow-hidden rounded-lg border border-border hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => setSelectedImage(img)}
          >
            <img
              src={img.url}
              alt=""
              className="w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="absolute bottom-2 left-2 right-2">
                <p className="text-white text-xs truncate">
                  {img.params?.prompt || "No prompt"}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
