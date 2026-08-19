// Client-side downscaling for the copy of a pasted/attached image that Paimon
// forwards to the vision model. This runs in the browser via <canvas>, so it
// behaves identically on every machine — unlike the server's native `sharp`
// downscale, which silently no-ops on PCs where the `sharp` binary fails to
// load, leaving oversized clipboard originals to reach the vision model
// untouched (fast on one PC, slow on another).
//
// Only the base64 `dataUrl` sent to the vision model is shrunk here. The
// full-resolution original is uploaded separately and stored on disk
// (`attachment.url`), which is what img2img / pose references use — so those are
// never affected by this downscale.

// Keep in sync with VISION_MAX_EDGE in src/app/api/paimon/chat/route.ts.
const VISION_MAX_EDGE = 1280;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Image read failed"));
    reader.onerror = () => reject(new Error("Image read failed"));
    reader.readAsDataURL(file);
  });
}

async function loadImageSource(
  file: File
): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Fall through to the <img> decode path below.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image decode failed"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function closeImageSource(source: ImageBitmap | HTMLImageElement) {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
}

/**
 * Read `file` as a data URL, downscaled so its longest edge is at most
 * `maxEdge` px. Images already within budget are returned re-encode-free to
 * avoid needless quality loss. Any decode/encode failure falls back to the
 * full-size data URL, where the server still attempts its own `sharp` downscale.
 */
export async function readImageDataUrlForVision(
  file: File,
  maxEdge: number = VISION_MAX_EDGE
): Promise<string> {
  try {
    const source = await loadImageSource(file);
    const width = source.width;
    const height = source.height;
    const longestEdge = Math.max(width, height);

    // Already within budget: keep the original bytes.
    if (longestEdge <= 0 || longestEdge <= maxEdge) {
      closeImageSource(source);
      return await readFileAsDataUrl(file);
    }

    const scale = maxEdge / longestEdge;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      closeImageSource(source);
      return await readFileAsDataUrl(file);
    }
    ctx.drawImage(source, 0, 0, targetW, targetH);
    closeImageSource(source);

    // Prefer webp (smaller); some browsers ignore the type and hand back png, so
    // fall back to jpeg when webp isn't honored. Both are accepted by the
    // server's vision-image validator.
    const webp = canvas.toDataURL("image/webp", 0.82);
    if (webp.startsWith("data:image/webp")) return webp;
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return readFileAsDataUrl(file);
  }
}

/**
 * Fetch an app-served image URL and return it as a JPEG data URL, downscaled so
 * its longest edge is at most `maxEdge` px. Used by the SeeDance surface, whose
 * API takes frames as data URIs (a local `/api/images/...` URL is unreachable
 * from BytePlus) and expects JPEG/PNG rather than webp.
 */
export async function readImageUrlAsJpegDataUrl(
  url: string,
  maxEdge = 1536
): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image fetch failed (${response.status})`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Image decode failed"));
      element.src = objectUrl;
    });

    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unsupported");
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
