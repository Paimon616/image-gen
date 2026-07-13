"use client";

import { ExternalLink } from "lucide-react";
import type { CivitaiOrigin } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface CivitaiOriginModalProps {
  origin: CivitaiOrigin | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  language?: "ko" | "en";
}

export function CivitaiOriginModal({
  origin,
  open,
  onOpenChange,
  language = "en",
}: CivitaiOriginModalProps) {
  if (!origin) return null;

  const ko = language === "ko";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[92vw] max-w-3xl overflow-hidden border border-border bg-card p-0 sm:max-w-3xl">
        <DialogTitle className="border-b border-border px-5 py-3 text-sm font-semibold">
          {ko ? "원본 Civitai 이미지" : "Original Civitai image"}
        </DialogTitle>
        <div className="flex max-h-[calc(92vh-3rem)] flex-col overflow-y-auto">
          <div className="flex items-center justify-center bg-background/70 p-4">
            <img
              src={origin.imageUrl}
              alt={ko ? "원본 Civitai 이미지" : "Original Civitai image"}
              className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
            <div className="flex flex-col gap-0.5">
              {origin.username && (
                <span>
                  {ko ? "작성자" : "By"}{" "}
                  <span className="font-medium text-foreground">
                    {origin.username}
                  </span>
                </span>
              )}
              <span>Image ID: {origin.imageId}</span>
            </div>
            {origin.pageUrl && (
              <a
                href={origin.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-medium text-primary transition-colors hover:border-primary/40"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {ko ? "Civitai에서 보기" : "View on Civitai"}
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
