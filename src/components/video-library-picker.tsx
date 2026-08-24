"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { CharacterSituationVideo } from "@/lib/types";

// One entry of the combined video library: a clip from either video surface's
// gallery, carrying which surface it lives in so the link API can find its
// sidecar. Same shape the character link routes use, minus the situation.
export type LibraryVideo = Omit<CharacterSituationVideo, "situationId">;

const MEDIA_LABEL: Record<LibraryVideo["media"], { ko: string; en: string }> = {
  videos: { ko: "영상", en: "Video" },
  seedance: { ko: "시댄스", en: "SeeDance" },
};

function pickKey(video: LibraryVideo) {
  return `${video.media}:${video.filename}`;
}

/** One picker tile: the clip's first frame via a metadata-preloaded <video>,
 *  playing (muted) while hovered so the user can tell similar clips apart. */
function VideoTile({
  video,
  order,
  ko,
  onPick,
}: {
  video: LibraryVideo;
  order: number;
  ko: boolean;
  onPick: () => void;
}) {
  const selected = order > 0;

  return (
    <button
      type="button"
      onClick={onPick}
      title={video.filename}
      className={cn(
        "group relative aspect-video overflow-hidden rounded-md border bg-black text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        selected
          ? "border-primary ring-2 ring-primary/40"
          : "border-border hover:border-primary/60"
      )}
    >
      <video
        src={video.url}
        preload="metadata"
        muted
        playsInline
        loop
        className="size-full object-contain"
        onMouseEnter={(event) => {
          void event.currentTarget.play().catch(() => {});
        }}
        onMouseLeave={(event) => {
          event.currentTarget.pause();
          event.currentTarget.currentTime = 0;
        }}
      />
      <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
        {MEDIA_LABEL[video.media][ko ? "ko" : "en"]}
      </span>
      {selected && (
        <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
          {order}
        </span>
      )}
    </button>
  );
}

export interface VideoLibraryPickerProps {
  title?: string;
  confirmLabel?: string;
  onClose: () => void;
  onPickMany: (videos: LibraryVideo[]) => void;
}

/**
 * The "load a generated video" browser: merges the ComfyUI video gallery and
 * the SeeDance gallery into one newest-first grid (filterable per surface) and
 * lets the user pick several clips — the video counterpart of
 * ImageLibraryPicker, used to register clips onto a character situation.
 */
export function VideoLibraryPicker({
  title,
  confirmLabel,
  onClose,
  onPickMany,
}: VideoLibraryPickerProps) {
  const language = useStore((state) => state.language);
  const ko = language === "ko";

  const [videos, setVideos] = useState<LibraryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  // "" = both surfaces.
  const [mediaFilter, setMediaFilter] = useState<"" | LibraryVideo["media"]>("");
  // Selected clips in click order, so the confirm button can attach a batch.
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Both galleries are small unpaginated lists, so one merged fetch is enough.
  useEffect(() => {
    let active = true;
    void (async () => {
      const load = async (
        media: LibraryVideo["media"],
        endpoint: string
      ): Promise<LibraryVideo[]> => {
        try {
          const res = await fetch(endpoint, { cache: "no-store" });
          const data = (await res.json()) as {
            videos?: { id: string; url: string; filename: string; timestamp: number }[];
          };
          return (data.videos ?? [])
            .filter((video) => video.url && video.filename)
            .map((video) => ({
              media,
              id: video.id || video.filename,
              url: video.url,
              filename: video.filename,
              timestamp: video.timestamp ?? 0,
            }));
        } catch {
          return [];
        }
      };

      const [comfy, seedance] = await Promise.all([
        load("videos", "/api/videos"),
        load("seedance", "/api/seedance/videos"),
      ]);
      if (!active) return;
      setVideos(
        [...comfy, ...seedance].sort((a, b) => b.timestamp - a.timestamp)
      );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const visible = useMemo(
    () =>
      mediaFilter
        ? videos.filter((video) => video.media === mediaFilter)
        : videos,
    [mediaFilter, videos]
  );

  const pickedOrder = useMemo(() => {
    const order = new Map<string, number>();
    picked.forEach((key, index) => order.set(key, index + 1));
    return order;
  }, [picked]);

  const toggle = useCallback((video: LibraryVideo) => {
    const key = pickKey(video);
    setPicked((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  }, []);

  const confirm = useCallback(() => {
    if (picked.length === 0) return;
    const byKey = new Map(videos.map((video) => [pickKey(video), video]));
    onPickMany(
      picked
        .map((key) => byKey.get(key))
        .filter((video): video is LibraryVideo => Boolean(video))
    );
  }, [onPickMany, picked, videos]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1200px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">
            {title ?? (ko ? "생성된 영상에서 선택" : "Pick a generated video")}
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

        {/* Surface filter — the two video screens keep separate galleries, so
            the picker can narrow to either one. */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          {(
            [
              ["", ko ? "전체" : "All"],
              ["videos", MEDIA_LABEL.videos[ko ? "ko" : "en"]],
              ["seedance", MEDIA_LABEL.seedance[ko ? "ko" : "en"]],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value || "all"}
              type="button"
              variant={mediaFilter === value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setMediaFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {ko ? "불러오는 중" : "Loading"}
            </div>
          ) : visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {ko ? "생성된 영상이 없어요." : "No generated videos yet."}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {visible.map((video) => (
                <VideoTile
                  key={pickKey(video)}
                  video={video}
                  order={pickedOrder.get(pickKey(video)) ?? 0}
                  ko={ko}
                  onPick={() => toggle(video)}
                />
              ))}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {picked.length > 0
              ? ko
                ? `${picked.length}개 선택됨`
                : `${picked.length} selected`
              : ko
                ? "추가할 영상을 선택하세요."
                : "Select the videos to add."}
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
      </div>
    </div>
  );
}
