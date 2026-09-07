"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
  type VideoHTMLAttributes,
} from "react";
import { Film } from "lucide-react";
import { cn } from "@/lib/utils";

/** Aspect ratios of clips whose metadata has loaded once, keyed by URL. A card
 *  scrolled back into view reserves the right height before its <video>
 *  remounts, so the masonry doesn't reflow while scrolling back up. */
const aspectRatioCache = new Map<string, number>();

const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * A gallery <video> that only exists while its card is (near) the viewport.
 * Mounting a media player per clip at once exhausts the browser's
 * decoder/player budget and floods the server with metadata requests, which
 * freezes the page on large galleries — offscreen cards render a lightweight
 * placeholder that keeps the clip's aspect ratio instead.
 */
export function LazyGalleryVideo({
  src,
  className,
  onLoadedMetadata,
  ...videoProps
}: VideoHTMLAttributes<HTMLVideoElement> & { src: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      // Two screens of lead-in: scrolling feels instant, while clips far
      // offscreen release their player again.
      { rootMargin: "600px" }
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef}>
      {inView ? (
        <video
          src={src}
          preload="metadata"
          className={className}
          onLoadedMetadata={(event: SyntheticEvent<HTMLVideoElement>) => {
            const element = event.currentTarget;
            if (element.videoWidth > 0 && element.videoHeight > 0) {
              aspectRatioCache.set(src, element.videoWidth / element.videoHeight);
            }
            onLoadedMetadata?.(event);
          }}
          {...videoProps}
        />
      ) : (
        <div
          // `relative` + absolutely centered icon, because the caller's
          // className may carry `block` (which would strip a `flex` here).
          className={cn("relative", className)}
          style={{
            aspectRatio: aspectRatioCache.get(src) ?? DEFAULT_ASPECT_RATIO,
          }}
        >
          <Film className="absolute inset-0 m-auto h-6 w-6 text-muted-foreground/50" />
        </div>
      )}
    </div>
  );
}

/**
 * Infinite-scroll sentinel: calls `onMore` when scrolled into range so the
 * gallery can grow its render window instead of mounting every card at once.
 * Give it a `key` that changes with the window size — remounting re-checks
 * intersection, so a sentinel still in range after growing fires again.
 */
export function GalleryLoadMore({
  onMore,
  children,
}: {
  onMore: () => void;
  children?: ReactNode;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onMore();
      },
      { rootMargin: "800px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onMore]);

  return (
    <div ref={sentinelRef} className="flex h-12 items-center justify-center">
      {children}
    </div>
  );
}
