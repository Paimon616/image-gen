interface ModelMediaThumbnailProps {
  src: string | null | undefined;
  alt: string;
  fallback: string;
  className?: string;
  fallbackClassName?: string;
}

function mediaPath(url: string) {
  try {
    return new URL(url, "http://local").pathname.toLowerCase();
  } catch {
    return url.split("?")[0].toLowerCase();
  }
}

function isCivitaiMediaUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "image.civitai.com" || hostname === "image-b2.civitai.com";
  } catch {
    return false;
  }
}

function proxiedThumbnailUrl(url: string) {
  return isCivitaiMediaUrl(url)
    ? `/api/models/remote-thumbnail?url=${encodeURIComponent(url)}`
    : url;
}

export function isVideoThumbnailUrl(url: string | null | undefined) {
  if (!url) return false;
  return /\.(mp4|webm|mov|m4v)$/i.test(mediaPath(url));
}

export function ModelMediaThumbnail({
  src,
  alt,
  fallback,
  className = "",
  fallbackClassName = "",
}: ModelMediaThumbnailProps) {
  if (src) {
    if (isVideoThumbnailUrl(src)) {
      return (
        <video
          src={proxiedThumbnailUrl(src)}
          aria-label={alt}
          className={`rounded-md object-cover ${className}`}
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
        />
      );
    }

    return (
      <img
        src={src}
        alt={alt}
        className={`rounded-md object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-md border border-border bg-muted text-xs font-medium text-muted-foreground ${className} ${fallbackClassName}`}
    >
      {fallback}
    </div>
  );
}
