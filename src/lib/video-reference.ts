// Handoff channel for sending a generated image from the Image Generation
// gallery into the Video Generation screen as the start/reference image.
//
// The video page keeps its params in local component state (no shared store),
// so we stash the picked image in sessionStorage right before navigating to
// `/video`. The video page reads it once on mount and clears it.
export const VIDEO_REFERENCE_HANDOFF_KEY = "image-gen-video-reference";

/**
 * Video generation uploads the start image to ComfyUI only when it looks like a
 * remote ref (`http(s)://…`); a bare app-relative path such as
 * `/api/images/<file>.png` is passed straight to the LoadImage node and fails
 * validation ("Invalid image file"). Gallery images (`GeneratedImage.url`) are
 * relative, so absolutize them against the current origin before they become
 * `source_image`, matching what `/api/upload` already returns for uploads.
 */
export function toAbsoluteImageUrl(url: string): string {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  if (typeof window !== "undefined") {
    try {
      return new URL(url, window.location.origin).toString();
    } catch {
      return url;
    }
  }
  return url;
}

export interface VideoReferenceHandoff {
  url: string;
  filename?: string;
  timestamp: number;
}

export function stashVideoReference(handoff: VideoReferenceHandoff) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      VIDEO_REFERENCE_HANDOFF_KEY,
      JSON.stringify(handoff)
    );
  } catch {
    // sessionStorage may be unavailable (private mode / quota); the video page
    // simply won't preload a reference in that case.
  }
}

export function takeVideoReference(): VideoReferenceHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(VIDEO_REFERENCE_HANDOFF_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(VIDEO_REFERENCE_HANDOFF_KEY);
    const parsed = JSON.parse(raw) as Partial<VideoReferenceHandoff>;
    if (!parsed || typeof parsed.url !== "string" || !parsed.url) return null;
    return {
      url: parsed.url,
      filename: typeof parsed.filename === "string" ? parsed.filename : undefined,
      timestamp:
        typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
    };
  } catch {
    return null;
  }
}
