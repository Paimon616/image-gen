"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Clock,
  Download,
  FolderOpen,
  Images,
  Film,
  Loader2,
  Play,
  Pause,
  Save,
  ScanSearch,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { ImageLibraryPicker } from "@/components/image-library-picker";
import { VideoLibraryPicker } from "@/components/video-library-picker";
import { cn } from "@/lib/utils";

type MediaKind = "image" | "video";
type CensorEffect = "mosaic" | "blur" | "fill";

/** One censored area, in the media's natural pixel coordinates so the same
 *  region paints identically on the preview and the full-size export. */
interface CensorRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  effect: CensorEffect;
  /** Mosaic block size or blur radius, in natural pixels. Ignored by fill. */
  strength: number;
  /** Fill color. Kept on every region so switching effects keeps the value. */
  color: string;
  /** Mask outline shape. A SAM2 `mask` overrides it. Default: rect. */
  shape?: "rect" | "ellipse";
  /** Edge softness, 0–100 (% of half the region's smaller side). */
  feather?: number;
  /** Mask dilation, 0–100 (same scale as feather): grows the censored shape
   *  outward at FULL opacity — covers the surroundings of a detected part
   *  (e.g. pubic hair around genitals) while still following its contour. */
  expand?: number;
  /** SAM2 contour mask, region-local (drawn scaled to the region's w×h). */
  mask?: HTMLCanvasElement;
  /** Video-only: per-frame tracking keyframes (sorted by time). When present,
   *  the painted box/mask comes from here (interpolated) instead of x/y/w/h,
   *  which then hold the track's union box for the list/overlay selection. */
  track?: CensorTrackKeyframe[];
  /** Auto-detected regions carry the NudeNet label they came from. */
  sourceLabel?: string;
  /** Video-only: censor just this time window (seconds). Absent = whole clip. */
  start?: number;
  end?: number;
}

/** One sampled moment of a tracked region: where the part was and (with SAM2)
 *  its contour mask at that time. */
interface CensorTrackKeyframe {
  time: number;
  x: number;
  y: number;
  w: number;
  h: number;
  mask?: HTMLCanvasElement;
}

/** The box+mask a region paints at `time`: keyframe-interpolated for tracked
 *  regions (box lerped, mask from the nearer keyframe), static otherwise. */
function regionFrameAt(
  region: CensorRegion,
  time: number | null
): { x: number; y: number; w: number; h: number; mask?: HTMLCanvasElement } {
  const track = region.track;
  if (!track || track.length === 0 || time === null) {
    return {
      x: region.x,
      y: region.y,
      w: region.w,
      h: region.h,
      mask: region.mask,
    };
  }
  if (time <= track[0].time) return track[0];
  const last = track[track.length - 1];
  if (time >= last.time) return last;
  let hi = 1;
  while (track[hi].time < time) hi++;
  const a = track[hi - 1];
  const b = track[hi];
  const span = b.time - a.time;
  const f = span > 0 ? (time - a.time) / span : 0;
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    w: a.w + (b.w - a.w) * f,
    h: a.h + (b.h - a.h) * f,
    mask: (f < 0.5 ? a.mask : b.mask) ?? a.mask ?? b.mask,
  };
}

interface SourceMedia {
  kind: MediaKind;
  url: string;
  /** Library filename or upload name — recorded on the saved copy's sidecar. */
  filename: string;
}

interface ExportResult {
  blob: Blob;
  url: string;
  mimeType: string;
  kind: MediaKind;
}

type DragMode =
  | { type: "draw"; id: string; originX: number; originY: number }
  | { type: "move"; id: string; grabX: number; grabY: number }
  | { type: "resize"; id: string };

const LABELS = {
  ko: {
    pickImage: "이미지 선택",
    pickVideo: "영상 선택",
    upload: "파일 업로드",
    empty: "검열할 이미지나 영상을 선택하세요.",
    emptyHint: "갤러리에서 고르거나 파일을 직접 업로드할 수 있어요.",
    change: "다른 미디어 선택",
    howTo: "미디어 위를 드래그해서 가릴 영역을 만드세요. 영역을 드래그하면 이동, 모서리 핸들로 크기 조절.",
    newRegion: "새 영역 효과",
    regions: "검열 영역",
    noRegions: "아직 영역이 없어요. 미디어 위를 드래그해 보세요.",
    effect: "효과",
    mosaic: "모자이크",
    blur: "블러",
    fill: "단색",
    strengthMosaic: "블록 크기",
    strengthBlur: "블러 강도",
    color: "색상",
    remove: "영역 삭제",
    clearAll: "전체 삭제",
    apply: "검열 적용",
    applying: "적용 중",
    exportingVideo: "영상을 다시 녹화하는 중이에요. 클립 길이만큼 걸려요.",
    result: "결과",
    download: "다운로드",
    saveToGallery: "갤러리에 저장",
    saving: "저장 중",
    saved: "갤러리에 저장했어요.",
    saveFailed: "저장에 실패했어요.",
    applyFirst: "영역을 하나 이상 만든 뒤 적용하세요.",
    videoNote: "영상은 브라우저에서 다시 녹화돼요 (WebM/MP4). 원본 길이만큼 시간이 걸립니다.",
    play: "재생",
    pause: "일시정지",
    close: "결과 닫기",
    loadFailed: "미디어를 불러오지 못했어요.",
    autoDetect: "자동 감지 (NudeNet)",
    autoDetectHint: "노출 부위를 자동으로 찾아 아래 '새 영역 효과'로 영역을 추가해요.",
    detectTargets: "감지 대상",
    sensitivity: "감지 임계값",
    boxPadding: "영역 여유",
    detectImage: "자동 감지",
    detectFrame: "현재 프레임 감지",
    scanAll: "전체 스캔",
    stopScan: "중지",
    detecting: "감지 중",
    scanning: "스캔 중",
    scanHint: "전체 스캔은 클립을 훑으며 부위를 프레임별로 추적해요. SAM2가 켜져 있으면 부위 모양 마스크로 따라가요 (더 오래 걸려요).",
    detectAdded: (count: number) => `${count}개 영역을 추가했어요.`,
    detectNone: "감지된 부위가 없어요. 임계값을 낮춰 다시 시도해 보세요.",
    detectFailed: "감지에 실패했어요. 잠시 후 다시 시도해 보세요 (최초 실행 시 모델을 내려받고, 스캔 중에는 이 창이 화면에 보여야 해요).",
    wholeClip: "전체 시간 적용",
    sam2Label: "부위 모양 마스크 (SAM2)",
    sam2Hint: "켜면 감지된 부위의 실제 윤곽대로 검열해요. 첫 사용 시 모델(~155MB)을 내려받아요.",
    shape: "모양",
    shapeRect: "사각형",
    shapeEllipse: "타원",
    shapeMask: "마스크(자동)",
    shapeTrack: "마스크 추적",
    trackChip: (count: number) => `${count}개 프레임 추적`,
    feather: "페더",
    expand: "확장",
  },
  en: {
    pickImage: "Pick image",
    pickVideo: "Pick video",
    upload: "Upload file",
    empty: "Pick an image or video to censor.",
    emptyHint: "Choose from the galleries or upload a file.",
    change: "Change media",
    howTo: "Drag on the media to create a censor region. Drag a region to move it, use the corner handle to resize.",
    newRegion: "New region effect",
    regions: "Censor regions",
    noRegions: "No regions yet — drag on the media to add one.",
    effect: "Effect",
    mosaic: "Mosaic",
    blur: "Blur",
    fill: "Solid color",
    strengthMosaic: "Block size",
    strengthBlur: "Blur strength",
    color: "Color",
    remove: "Delete region",
    clearAll: "Clear all",
    apply: "Apply censoring",
    applying: "Applying",
    exportingVideo: "Re-recording the video — this takes as long as the clip.",
    result: "Result",
    download: "Download",
    saveToGallery: "Save to gallery",
    saving: "Saving",
    saved: "Saved to the gallery.",
    saveFailed: "Save failed.",
    applyFirst: "Create at least one region before applying.",
    videoNote: "Videos are re-recorded in the browser (WebM/MP4) and take the clip's length to export.",
    play: "Play",
    pause: "Pause",
    close: "Close result",
    loadFailed: "Could not load the media.",
    autoDetect: "Auto-detect (NudeNet)",
    autoDetectHint: "Finds exposed body parts and adds regions using the 'New region effect' settings below.",
    detectTargets: "Targets",
    sensitivity: "Score threshold",
    boxPadding: "Box padding",
    detectImage: "Auto-detect",
    detectFrame: "Detect current frame",
    scanAll: "Scan whole clip",
    stopScan: "Stop",
    detecting: "Detecting",
    scanning: "Scanning",
    scanHint: "The full scan samples the clip and tracks each part frame-by-frame — with SAM2 on, following its contour mask (slower).",
    detectAdded: (count: number) => `Added ${count} region${count === 1 ? "" : "s"}.`,
    detectNone: "Nothing detected — try lowering the threshold.",
    detectFailed: "Detection failed — try again shortly (the model downloads on first use; scans need this window visible on screen).",
    wholeClip: "Apply to whole clip",
    sam2Label: "Part-shaped masks (SAM2)",
    sam2Hint: "Censors along the detected part's actual contour. Downloads the model (~155MB) on first use.",
    shape: "Shape",
    shapeRect: "Rectangle",
    shapeEllipse: "Ellipse",
    shapeMask: "Mask (auto)",
    shapeTrack: "Tracked mask",
    trackChip: (count: number) => `tracked over ${count} frames`,
    feather: "Feather",
    expand: "Expand",
  },
} as const;

const EFFECT_OPTIONS: CensorEffect[] = ["mosaic", "blur", "fill"];
const MIN_REGION_SIZE = 4;

// NudeNet label groups the auto-detect UI exposes. The defaults censor the
// sexual body parts; face/feet/etc. are opt-in.
const DETECT_GROUPS = [
  {
    key: "genitalia",
    names: { ko: "성기", en: "Genitalia" },
    labels: [
      "FEMALE_GENITALIA_EXPOSED",
      "MALE_GENITALIA_EXPOSED",
      "FEMALE_GENITALIA_COVERED",
    ],
    defaultOn: true,
  },
  {
    key: "anus",
    names: { ko: "항문", en: "Anus" },
    labels: ["ANUS_EXPOSED", "ANUS_COVERED"],
    defaultOn: true,
  },
  {
    key: "breast",
    names: { ko: "가슴", en: "Breasts" },
    labels: [
      "FEMALE_BREAST_EXPOSED",
      "MALE_BREAST_EXPOSED",
      "FEMALE_BREAST_COVERED",
    ],
    defaultOn: true,
  },
  {
    key: "buttocks",
    names: { ko: "엉덩이", en: "Buttocks" },
    labels: ["BUTTOCKS_EXPOSED", "BUTTOCKS_COVERED"],
    defaultOn: true,
  },
  {
    key: "face",
    names: { ko: "얼굴", en: "Face" },
    labels: ["FACE_FEMALE", "FACE_MALE"],
    defaultOn: false,
  },
  {
    key: "etc",
    names: { ko: "기타", en: "Other" },
    labels: [
      "FEET_EXPOSED",
      "FEET_COVERED",
      "BELLY_EXPOSED",
      "BELLY_COVERED",
      "ARMPITS_EXPOSED",
      "ARMPITS_COVERED",
    ],
    defaultOn: false,
  },
] as const;

type DetectGroup = (typeof DETECT_GROUPS)[number];

const LABEL_TO_GROUP = new Map<string, DetectGroup>();
for (const group of DETECT_GROUPS) {
  for (const label of group.labels) LABEL_TO_GROUP.set(label, group);
}

/** One auto-detected box, already padded and in natural media pixels. */
interface DetectedBox {
  groupKey: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** SAM2 contour mask (as a canvas) plus the (unpadded) box it is cropped
   *  to, in natural media pixels, for placing it inside the padded region. */
  mask?: HTMLCanvasElement;
  inner?: Rect;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectIou(a: Rect, b: Rect) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function rectUnion(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Whether a region censors the frame at `time` (null = still image). */
function regionActiveAt(region: CensorRegion, time: number | null) {
  if (region.start === undefined || region.end === undefined) return true;
  if (time === null) return true;
  return time >= region.start && time <= region.end;
}

/** Seeks and resolves once the frame is actually presented (a same-time seek
 *  never fires `seeked`, so it resolves immediately). Rejects after a timeout:
 *  browsers stop decoding video in hidden/occluded pages, so a scan there
 *  would otherwise hang forever on its next seek. */
function seekVideo(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    if (Math.abs(video.currentTime - time) < 0.001) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      video.removeEventListener("seeked", done);
      reject(new Error("seek timeout (page hidden?)"));
    }, 8000);
    const done = () => {
      video.removeEventListener("seeked", done);
      window.clearTimeout(timer);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = time;
  });
}

/** Bakes a detection's SAM2 mask into a canvas sized to its padded box, so
 *  painting later just re-scales one bitmap. */
function maskCanvasFor(box: DetectedBox): HTMLCanvasElement | undefined {
  if (!box.mask || !box.inner) return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(box.w));
  canvas.height = Math.max(1, Math.round(box.h));
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(
    box.mask,
    box.inner.x - box.x,
    box.inner.y - box.y,
    box.inner.w,
    box.inner.h
  );
  return canvas;
}

/** One tracked detection during a whole-clip scan: the union box of a part
 *  that keeps being detected at overlapping positions across samples, plus
 *  the per-sample keyframes that let the region follow the part. */
interface ScanTrack {
  groupKey: string;
  label: string;
  box: Rect;
  start: number;
  end: number;
  lastSeen: number;
  keyframes: CensorTrackKeyframe[];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Scratch canvases reused across frames so the video preview/export loop
 *  doesn't allocate a canvas per region per frame. */
interface PaintScratch {
  small: HTMLCanvasElement;
  cropA: HTMLCanvasElement;
  cropB: HTMLCanvasElement;
  effect: HTMLCanvasElement;
  maskA: HTMLCanvasElement;
  maskB: HTMLCanvasElement;
  maskC: HTMLCanvasElement;
}

function createScratch(): PaintScratch {
  return {
    small: document.createElement("canvas"),
    cropA: document.createElement("canvas"),
    cropB: document.createElement("canvas"),
    effect: document.createElement("canvas"),
    maskA: document.createElement("canvas"),
    maskB: document.createElement("canvas"),
    maskC: document.createElement("canvas"),
  };
}

/** Renders the region's effect content over the patch rect (ex,ey,ew,eh) into
 *  `effectCtx` at origin, sampling `frame` (the frame censored so far) so
 *  stacked regions compose. The patch is opaque; masking happens after. */
function renderEffectPatch(
  effectCtx: CanvasRenderingContext2D,
  frame: HTMLCanvasElement,
  region: CensorRegion,
  ex: number,
  ey: number,
  ew: number,
  eh: number,
  naturalW: number,
  naturalH: number,
  scratch: PaintScratch
) {
  if (region.effect === "fill") {
    effectCtx.fillStyle = region.color;
    effectCtx.fillRect(0, 0, ew, eh);
    return;
  }

  if (region.effect === "mosaic") {
    const block = Math.max(2, region.strength);
    const sw = Math.max(1, Math.round(ew / block));
    const sh = Math.max(1, Math.round(eh / block));
    const { small } = scratch;
    small.width = sw;
    small.height = sh;
    const smallCtx = small.getContext("2d");
    if (!smallCtx) return;
    smallCtx.imageSmoothingEnabled = true;
    smallCtx.drawImage(frame, ex, ey, ew, eh, 0, 0, sw, sh);
    effectCtx.imageSmoothingEnabled = false;
    effectCtx.drawImage(small, 0, 0, sw, sh, 0, 0, ew, eh);
    effectCtx.imageSmoothingEnabled = true;
    return;
  }

  // Blur: crop with padding so the blur can pull real neighboring pixels
  // instead of transparent edges, blur the crop, then copy out the patch.
  const radius = Math.max(1, region.strength);
  const pad = Math.ceil(radius * 2);
  const sx = Math.max(0, ex - pad);
  const sy = Math.max(0, ey - pad);
  const sw = Math.min(naturalW, ex + ew + pad) - sx;
  const sh = Math.min(naturalH, ey + eh + pad) - sy;

  const { cropA, cropB } = scratch;
  cropA.width = sw;
  cropA.height = sh;
  const cropCtx = cropA.getContext("2d");
  if (!cropCtx) return;
  cropCtx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh);

  cropB.width = sw;
  cropB.height = sh;
  const blurCtx = cropB.getContext("2d");
  if (!blurCtx) return;
  blurCtx.filter = `blur(${radius}px)`;
  blurCtx.drawImage(cropA, 0, 0);
  blurCtx.filter = "none";

  effectCtx.drawImage(cropB, ex - sx, ey - sy, ew, eh, 0, 0, ew, eh);
}

/** Draws the source frame onto `ctx` (already sized to natural pixels) and
 *  paints every censor region over it — through the region's SAM2 mask or
 *  rect/ellipse shape, with a feathered (blurred) edge when requested. */
function paintCensoredFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  naturalW: number,
  naturalH: number,
  regions: CensorRegion[],
  time: number | null,
  scratch: PaintScratch
) {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, naturalW, naturalH);

  for (const region of regions) {
    const frame = regionFrameAt(region, time);
    const x = Math.round(clamp(frame.x, 0, naturalW));
    const y = Math.round(clamp(frame.y, 0, naturalH));
    const w = Math.round(clamp(frame.w, 0, naturalW - x));
    const h = Math.round(clamp(frame.h, 0, naturalH - y));
    if (w < 1 || h < 1) continue;

    const mask = frame.mask;
    // Feather/expand are stored as % of half the smaller side, so both scale
    // with the region instead of the media resolution.
    const featherPx = ((region.feather ?? 0) / 100) * Math.min(w, h) * 0.5;
    const expandPx = ((region.expand ?? 0) / 100) * Math.min(w, h) * 0.5;
    const shape = region.shape ?? "rect";
    const soft =
      Boolean(mask) ||
      shape === "ellipse" ||
      featherPx >= 0.5 ||
      expandPx >= 0.5;

    if (!soft) {
      // Hard-edged rectangle: paint the effect straight onto the frame.
      if (region.effect === "fill") {
        ctx.fillStyle = region.color;
        ctx.fillRect(x, y, w, h);
      } else {
        const effectCanvas = scratch.effect;
        effectCanvas.width = w;
        effectCanvas.height = h;
        const effectCtx = effectCanvas.getContext("2d");
        if (!effectCtx) continue;
        renderEffectPatch(
          effectCtx,
          ctx.canvas,
          region,
          x,
          y,
          w,
          h,
          naturalW,
          naturalH,
          scratch
        );
        ctx.drawImage(effectCanvas, x, y);
      }
      continue;
    }

    // Soft path: extend the effect patch past the region so the dilation and
    // outward feather land on censored content, not a hard content edge.
    const margin = Math.ceil(expandPx + featherPx * 2);
    const ex = Math.max(0, x - margin);
    const ey = Math.max(0, y - margin);
    const ew = Math.min(naturalW, x + w + margin) - ex;
    const eh = Math.min(naturalH, y + h + margin) - ey;
    if (ew < 1 || eh < 1) continue;

    const effectCanvas = scratch.effect;
    effectCanvas.width = ew;
    effectCanvas.height = eh;
    const effectCtx = effectCanvas.getContext("2d");
    if (!effectCtx) continue;
    renderEffectPatch(
      effectCtx,
      ctx.canvas,
      region,
      ex,
      ey,
      ew,
      eh,
      naturalW,
      naturalH,
      scratch
    );

    // The mask: SAM2 contour, ellipse, or rectangle — blurred by the feather.
    const maskCanvas = scratch.maskA;
    maskCanvas.width = ew;
    maskCanvas.height = eh;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) continue;
    maskCtx.clearRect(0, 0, ew, eh);
    if (mask) {
      maskCtx.drawImage(mask, x - ex, y - ey, w, h);
    } else if (shape === "ellipse") {
      maskCtx.fillStyle = "#fff";
      maskCtx.beginPath();
      maskCtx.ellipse(
        x - ex + w / 2,
        y - ey + h / 2,
        w / 2,
        h / 2,
        0,
        0,
        Math.PI * 2
      );
      maskCtx.fill();
    } else {
      maskCtx.fillStyle = "#fff";
      maskCtx.fillRect(x - ex, y - ey, w, h);
    }

    // Dilation: union of the mask stamped around a circle grows the censored
    // shape outward at full opacity, still roughly following its contour.
    let coreMask: HTMLCanvasElement = maskCanvas;
    if (expandPx >= 0.5) {
      const dilated = scratch.maskC;
      dilated.width = ew;
      dilated.height = eh;
      const dilatedCtx = dilated.getContext("2d");
      if (dilatedCtx) {
        dilatedCtx.clearRect(0, 0, ew, eh);
        const steps = 12;
        for (const radius of [expandPx, expandPx * 0.5]) {
          for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            dilatedCtx.drawImage(
              maskCanvas,
              Math.cos(angle) * radius,
              Math.sin(angle) * radius
            );
          }
        }
        dilatedCtx.drawImage(maskCanvas, 0, 0);
        coreMask = dilated;
      }
    }

    let maskSource: HTMLCanvasElement = coreMask;
    if (featherPx >= 0.5) {
      const blurred = scratch.maskB;
      blurred.width = ew;
      blurred.height = eh;
      const blurredCtx = blurred.getContext("2d");
      if (blurredCtx) {
        blurredCtx.clearRect(0, 0, ew, eh);
        // Outward-only feather: a single centered blur would thin the mask
        // INSIDE its boundary too, letting the censored subject show through
        // as the feather grows. Stacking the blurred mask pushes the falloff
        // to near-full opacity at the boundary, and stamping the hard mask
        // back on top guarantees the covered area itself stays covered — only
        // the halo outside the mask fades out.
        blurredCtx.filter = `blur(${featherPx}px)`;
        blurredCtx.drawImage(coreMask, 0, 0);
        blurredCtx.drawImage(coreMask, 0, 0);
        blurredCtx.drawImage(coreMask, 0, 0);
        blurredCtx.filter = "none";
        blurredCtx.drawImage(coreMask, 0, 0);
        maskSource = blurred;
      }
    }

    effectCtx.globalCompositeOperation = "destination-in";
    effectCtx.drawImage(maskSource, 0, 0);
    effectCtx.globalCompositeOperation = "source-over";

    ctx.drawImage(effectCanvas, ex, ey);
  }
}

/** The best mime type this browser's MediaRecorder can produce, mp4 first so
 *  Chrome builds that support it keep the gallery's default container. */
function pickVideoMimeType() {
  const candidates = [
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  return "video/webm";
}

function downloadExtension(mimeType: string) {
  return mimeType.split(";")[0].trim() === "video/mp4" ? "mp4" : "webm";
}

/**
 * The manual censor screen: pick an image or video (from the galleries or an
 * upload), drag rectangular regions over it, choose mosaic / blur / solid
 * color per region, and export the censored copy — images via canvas, videos
 * by re-recording the painted canvas with MediaRecorder. Everything runs in
 * the browser; the save endpoint only files the finished bytes into the
 * existing galleries.
 */
export function CensorEditor() {
  const language = useStore((state) => state.language);
  const ko = language === "ko";
  const t = LABELS[ko ? "ko" : "en"];

  const [source, setSource] = useState<SourceMedia | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const [regions, setRegions] = useState<CensorRegion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragMode | null>(null);

  // Effect settings stamped onto the next drawn region.
  const [draftEffect, setDraftEffect] = useState<CensorEffect>("mosaic");
  const [draftStrength, setDraftStrength] = useState(24);
  const [draftColor, setDraftColor] = useState("#000000");
  const [draftShape, setDraftShape] = useState<"rect" | "ellipse">("rect");
  const [draftFeather, setDraftFeather] = useState(30);

  // Auto-detect settings & progress.
  const [enabledGroups, setEnabledGroups] = useState<Set<string>>(
    () => new Set(DETECT_GROUPS.filter((g) => g.defaultOn).map((g) => g.key))
  );
  const [detectThreshold, setDetectThreshold] = useState(25); // min score, %
  const [detectPadding, setDetectPadding] = useState(20); // box expansion, %
  const [useSam2, setUseSam2] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [detectStatus, setDetectStatus] = useState<
    { kind: "ok"; count: number } | { kind: "none" } | { kind: "error" } | null
  >(null);
  const scanCancelRef = useRef(false);

  const [picker, setPicker] = useState<"image" | "video" | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Video preview transport.
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "failed">(
    "idle"
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scratchRef = useRef<PaintScratch | null>(null);
  const regionsRef = useRef<CensorRegion[]>(regions);
  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

  const scratch = () => {
    if (!scratchRef.current) scratchRef.current = createScratch();
    return scratchRef.current;
  };

  const currentDrawable = useCallback((): CanvasImageSource | null => {
    if (!source) return null;
    if (source.kind === "image") return imageRef.current;
    const video = videoRef.current;
    return video && video.readyState >= 2 ? video : null;
  }, [source]);

  /** Repaints the preview canvas from the current frame + regions. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const size = naturalSize;
    const drawable = currentDrawable();
    if (!canvas || !size || !drawable) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Time-windowed regions only paint on frames inside their window.
    const time =
      source?.kind === "video" ? (videoRef.current?.currentTime ?? null) : null;
    paintCensoredFrame(
      ctx,
      drawable,
      size.w,
      size.h,
      regionsRef.current.filter((region) => regionActiveAt(region, time)),
      time,
      scratch()
    );
  }, [currentDrawable, naturalSize, source]);

  // Repaint when regions or the loaded media change (covers images and the
  // paused-video case; the play loop below covers playback).
  useEffect(() => {
    redraw();
  }, [redraw, regions]);

  // Video playback: repaint every animation frame while playing.
  useEffect(() => {
    if (!playing || source?.kind !== "video") return;
    let raf = 0;
    const tick = () => {
      redraw();
      const video = videoRef.current;
      if (video) setCurrentTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, redraw, source]);

  const resetForNewSource = useCallback(() => {
    setRegions([]);
    setSelectedId(null);
    setNaturalSize(null);
    setLoadError(false);
    setPlaying(false);
    setDuration(0);
    setCurrentTime(0);
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setSaveState("idle");
  }, []);

  const loadSource = useCallback(
    (next: SourceMedia) => {
      resetForNewSource();
      setSource(next);
      if (next.kind === "image") {
        const img = new Image();
        img.onload = () => {
          imageRef.current = img;
          setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
        };
        img.onerror = () => setLoadError(true);
        img.src = next.url;
      }
      // Video natural size arrives via onLoadedMetadata on the <video>.
    },
    [resetForNewSource]
  );

  const handleUpload = useCallback(
    (file: File) => {
      const kind: MediaKind = file.type.startsWith("video/")
        ? "video"
        : "image";
      loadSource({
        kind,
        url: URL.createObjectURL(file),
        filename: file.name,
      });
    },
    [loadSource]
  );

  // --- Region drag interactions -------------------------------------------

  /** Pointer position in natural media pixels, clamped to the frame. */
  const toNatural = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const stage = stageRef.current;
      const size = naturalSize;
      if (!stage || !size) return null;
      const rect = stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return {
        x: clamp(((event.clientX - rect.left) / rect.width) * size.w, 0, size.w),
        y: clamp(((event.clientY - rect.top) / rect.height) * size.h, 0, size.h),
      };
    },
    [naturalSize]
  );

  const capturePointer = (event: ReactPointerEvent) => {
    stageRef.current?.setPointerCapture(event.pointerId);
  };

  const onStagePointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || exporting || scanning) return;
    const point = toNatural(event);
    if (!point) return;
    capturePointer(event);
    const id = crypto.randomUUID();
    setRegions((prev) => [
      ...prev,
      {
        id,
        x: point.x,
        y: point.y,
        w: 0,
        h: 0,
        effect: draftEffect,
        strength: draftStrength,
        color: draftColor,
        shape: draftShape,
        feather: draftFeather,
      },
    ]);
    setSelectedId(id);
    setDrag({ type: "draw", id, originX: point.x, originY: point.y });
  };

  const onRegionPointerDown = (
    event: ReactPointerEvent,
    region: CensorRegion
  ) => {
    if (event.button !== 0 || exporting || scanning) return;
    event.stopPropagation();
    const point = toNatural(event);
    if (!point) return;
    capturePointer(event);
    setSelectedId(region.id);
    setDrag({
      type: "move",
      id: region.id,
      grabX: point.x - region.x,
      grabY: point.y - region.y,
    });
  };

  const onHandlePointerDown = (
    event: ReactPointerEvent,
    region: CensorRegion
  ) => {
    if (event.button !== 0 || exporting || scanning) return;
    event.stopPropagation();
    capturePointer(event);
    setSelectedId(region.id);
    setDrag({ type: "resize", id: region.id });
  };

  const onStagePointerMove = (event: ReactPointerEvent) => {
    if (!drag) return;
    const point = toNatural(event);
    const size = naturalSize;
    if (!point || !size) return;

    setRegions((prev) =>
      prev.map((region) => {
        if (region.id !== drag.id) return region;
        if (drag.type === "draw") {
          const x = Math.min(drag.originX, point.x);
          const y = Math.min(drag.originY, point.y);
          return {
            ...region,
            x,
            y,
            w: Math.abs(point.x - drag.originX),
            h: Math.abs(point.y - drag.originY),
          };
        }
        if (drag.type === "move") {
          const nx = clamp(point.x - drag.grabX, 0, size.w - region.w);
          const ny = clamp(point.y - drag.grabY, 0, size.h - region.h);
          // Moving a tracked region shifts every keyframe by the same delta.
          const dx = nx - region.x;
          const dy = ny - region.y;
          return {
            ...region,
            x: nx,
            y: ny,
            track: region.track?.map((kf) => ({
              ...kf,
              x: kf.x + dx,
              y: kf.y + dy,
            })),
          };
        }
        return {
          ...region,
          w: Math.max(MIN_REGION_SIZE, point.x - region.x),
          h: Math.max(MIN_REGION_SIZE, point.y - region.y),
        };
      })
    );
  };

  const onStagePointerUp = () => {
    if (!drag) return;
    if (drag.type === "draw") {
      // A near-zero drag was just a click: drop the empty region.
      setRegions((prev) =>
        prev.filter(
          (region) =>
            region.id !== drag.id ||
            (region.w >= MIN_REGION_SIZE && region.h >= MIN_REGION_SIZE)
        )
      );
      setSelectedId((prevSelected) => {
        const drawn = regionsRef.current.find((r) => r.id === drag.id);
        if (drawn && (drawn.w < MIN_REGION_SIZE || drawn.h < MIN_REGION_SIZE)) {
          return null;
        }
        return prevSelected;
      });
    }
    setDrag(null);
  };

  const removeRegion = useCallback((id: string) => {
    setRegions((prev) => prev.filter((region) => region.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  }, []);

  // Delete/Backspace removes the selected region (unless typing in a field).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (selectedId) {
        event.preventDefault();
        removeRegion(selectedId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [removeRegion, selectedId]);

  const updateRegion = useCallback(
    (id: string, patch: Partial<CensorRegion>) => {
      setRegions((prev) =>
        prev.map((region) =>
          region.id === id ? { ...region, ...patch } : region
        )
      );
    },
    []
  );

  // --- Auto detection (NudeNet) ---------------------------------------------

  /** Sends the current frame to the NudeNet endpoint and returns the enabled,
   *  padded boxes in natural media pixels. */
  const detectBoxesInFrame = useCallback(
    async (
      drawable: CanvasImageSource,
      withMasks = false,
      thorough = false
    ): Promise<DetectedBox[]> => {
      const size = naturalSize;
      if (!size) return [];
      // The detector works at 320px, so a capped capture keeps uploads small
      // without costing accuracy.
      const maxSide = 896;
      const scale = Math.min(1, maxSide / Math.max(size.w, size.h));
      const cw = Math.max(1, Math.round(size.w * scale));
      const ch = Math.max(1, Math.round(size.h * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unavailable");
      ctx.drawImage(drawable, 0, 0, cw, ch);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("capture failed")),
          "image/jpeg",
          0.85
        );
      });

      const formData = new FormData();
      formData.append(
        "file",
        new File([blob], "frame.jpg", { type: "image/jpeg" })
      );
      formData.append("minScore", String(detectThreshold / 100));
      if (withMasks) formData.append("segment", "1");
      if (thorough) formData.append("thorough", "1");
      const res = await fetch("/api/censor/detect", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("detect failed");
      const data = (await res.json()) as {
        width: number;
        height: number;
        detections: {
          label: string;
          x: number;
          y: number;
          w: number;
          h: number;
          mask?: string;
          maskBox?: { x: number; y: number; w: number; h: number };
        }[];
      };

      const fx = size.w / data.width;
      const fy = size.h / data.height;
      const pad = detectPadding / 100;
      const boxes: DetectedBox[] = [];
      for (const det of data.detections) {
        const group = LABEL_TO_GROUP.get(det.label);
        if (!group || !enabledGroups.has(group.key)) continue;
        // The mask's own box (which may extend past the detector box, e.g.
        // along an organ) wins over the raw detection when present.
        const source = det.maskBox ?? det;
        // Pad so the censor over-covers the detected part.
        const w = source.w * fx;
        const h = source.h * fy;
        const px = w * pad;
        const py = h * pad;
        const x = clamp(source.x * fx - px, 0, size.w - MIN_REGION_SIZE);
        const y = clamp(source.y * fy - py, 0, size.h - MIN_REGION_SIZE);
        const box: DetectedBox = {
          groupKey: group.key,
          label: det.label,
          x,
          y,
          w: clamp(w + 2 * px, MIN_REGION_SIZE, size.w - x),
          h: clamp(h + 2 * py, MIN_REGION_SIZE, size.h - y),
        };
        if (det.mask && det.maskBox) {
          // Raw alpha bytes → canvas via putImageData. Deliberately avoids
          // the browser's image-decode pipeline (Image.decode /
          // createImageBitmap), whose decode tasks are not serviced while the
          // page is hidden/occluded — that froze whole-clip scans mid-run.
          const bytes = Uint8Array.from(atob(det.mask), (c) => c.charCodeAt(0));
          const maskCanvas = document.createElement("canvas");
          maskCanvas.width = Math.max(1, det.maskBox.w);
          maskCanvas.height = Math.max(1, det.maskBox.h);
          const maskCtx = maskCanvas.getContext("2d");
          if (maskCtx) {
            const imageData = maskCtx.createImageData(
              maskCanvas.width,
              maskCanvas.height
            );
            const pixels = Math.min(
              bytes.length,
              maskCanvas.width * maskCanvas.height
            );
            for (let p = 0; p < pixels; p++) {
              imageData.data[p * 4] = 255;
              imageData.data[p * 4 + 1] = 255;
              imageData.data[p * 4 + 2] = 255;
              imageData.data[p * 4 + 3] = bytes[p];
            }
            maskCtx.putImageData(imageData, 0, 0);
            box.mask = maskCanvas;
            box.inner = { x: source.x * fx, y: source.y * fy, w, h };
          }
        }
        boxes.push(box);
      }
      return boxes;
    },
    [detectPadding, detectThreshold, enabledGroups, naturalSize]
  );

  const detectionToRegion = useCallback(
    (
      box: DetectedBox,
      time?: { start: number; end: number },
      track?: CensorTrackKeyframe[]
    ): CensorRegion => ({
      id: crypto.randomUUID(),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      effect: draftEffect,
      strength: draftStrength,
      color: draftColor,
      shape: draftShape,
      feather: draftFeather,
      // Masked regions also dilate the mask by the 영역 여유 amount so the
      // censor covers the part's surroundings (pubic hair etc.), not just its
      // exact contour. Box/ellipse regions are already padded box-side.
      expand: (track ? track.some((kf) => kf.mask) : Boolean(box.mask))
        ? detectPadding
        : 0,
      // A tracked region paints from its keyframes; a static one bakes the
      // SAM2 mask (when present) into a region-local canvas.
      mask: track ? undefined : maskCanvasFor(box),
      track,
      sourceLabel: box.label,
      ...(time ?? {}),
    }),
    [detectPadding, draftColor, draftEffect, draftFeather, draftShape, draftStrength]
  );

  /** One-shot detect: the image, or the video's current frame (the regions it
   *  adds then censor the whole clip). */
  const detectOnce = useCallback(async () => {
    const drawable = currentDrawable();
    if (!drawable || detecting || scanning || exporting) return;
    setDetecting(true);
    setDetectStatus(null);
    try {
      const boxes = await detectBoxesInFrame(drawable, useSam2, true);
      if (boxes.length === 0) {
        setDetectStatus({ kind: "none" });
      } else {
        setRegions((prev) => [
          ...prev,
          ...boxes.map((box) => detectionToRegion(box)),
        ]);
        setDetectStatus({ kind: "ok", count: boxes.length });
      }
    } catch {
      setDetectStatus({ kind: "error" });
    } finally {
      setDetecting(false);
    }
  }, [
    currentDrawable,
    detectBoxesInFrame,
    detecting,
    detectionToRegion,
    exporting,
    scanning,
    useSam2,
  ]);

  /** Samples the clip every few hundred ms, tracks detections that overlap
   *  frame-to-frame into one union box each, and adds them as time-windowed
   *  regions (a part visible the whole clip gets no window). */
  const scanWholeClip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !naturalSize || detecting || scanning || exporting) return;
    setScanning(true);
    setScanProgress(0);
    setDetectStatus(null);
    scanCancelRef.current = false;
    const restoreTime = video.currentTime;
    video.pause();
    setPlaying(false);
    try {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("no duration");
      }
      const step = Math.min(0.6, Math.max(0.2, duration / 30));
      const open: ScanTrack[] = [];
      const closed: ScanTrack[] = [];

      for (let t = 0; t <= duration && !scanCancelRef.current; t += step) {
        const at = Math.min(t, Math.max(0, duration - 0.05));
        await seekVideo(video, at);
        // Unseekable media snaps every seek back to 0, which would silently
        // produce one static frame-0 region. Fail loudly instead.
        if (at > 0.5 && Math.abs(video.currentTime - at) > 0.4) {
          throw new Error("video not seekable");
        }
        // With SAM2 on, every sample also carries the part's contour mask so
        // the resulting region tracks the part's shape frame-by-frame.
        const boxes = await detectBoxesInFrame(video, useSam2);
        for (const box of boxes) {
          const keyframe: CensorTrackKeyframe = {
            time: at,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            mask: maskCanvasFor(box),
          };
          // Match against the track's latest keyframe (not the growing union
          // box, which would swallow a second nearby part), and never give a
          // track two keyframes for the same sample — a second detection at
          // the same time is its own part and starts its own track.
          const track = open.find((candidate) => {
            const tail = candidate.keyframes[candidate.keyframes.length - 1];
            return (
              candidate.groupKey === box.groupKey &&
              tail.time !== at &&
              rectIou(tail, box) > 0.1
            );
          });
          if (track) {
            track.box = rectUnion(track.box, box);
            track.end = Math.min(duration, at + step);
            track.lastSeen = at;
            track.keyframes.push(keyframe);
          } else {
            open.push({
              groupKey: box.groupKey,
              label: box.label,
              box: { x: box.x, y: box.y, w: box.w, h: box.h },
              start: Math.max(0, at - step / 2),
              end: Math.min(duration, at + step),
              lastSeen: at,
              keyframes: [keyframe],
            });
          }
        }
        // A track missing for more than one sample has left the frame.
        for (let i = open.length - 1; i >= 0; i--) {
          if (at - open[i].lastSeen > step * 1.6) {
            closed.push(open[i]);
            open.splice(i, 1);
          }
        }
        setScanProgress(Math.min(1, at / duration));
      }
      closed.push(...open);

      const added = closed.map((track) => {
        const wholeClip = track.start <= step && track.end >= duration - step;
        return detectionToRegion(
          { groupKey: track.groupKey, label: track.label, ...track.box },
          wholeClip
            ? undefined
            : {
                start: Math.max(0, Math.round((track.start - 0.2) * 10) / 10),
                end: Math.min(
                  duration,
                  Math.round((track.end + 0.2) * 10) / 10
                ),
              },
          track.keyframes.length > 0 ? track.keyframes : undefined
        );
      });
      if (added.length === 0) {
        setDetectStatus({ kind: "none" });
      } else {
        setRegions((prev) => [...prev, ...added]);
        setDetectStatus({ kind: "ok", count: added.length });
      }
    } catch {
      setDetectStatus({ kind: "error" });
    } finally {
      const restore = videoRef.current;
      if (restore) {
        await seekVideo(restore, restoreTime).catch(() => {});
        setCurrentTime(restore.currentTime);
      }
      setScanning(false);
    }
  }, [
    detectBoxesInFrame,
    detecting,
    detectionToRegion,
    exporting,
    naturalSize,
    scanning,
    useSam2,
  ]);

  // --- Export ---------------------------------------------------------------

  const exportImage = useCallback(async (): Promise<ExportResult> => {
    const size = naturalSize;
    const drawable = currentDrawable();
    if (!size || !drawable) throw new Error("media not ready");
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    paintCensoredFrame(
      ctx,
      drawable,
      size.w,
      size.h,
      regionsRef.current,
      null,
      createScratch()
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("export failed"))),
        "image/png"
      );
    });
    return {
      blob,
      url: URL.createObjectURL(blob),
      mimeType: "image/png",
      kind: "image",
    };
  }, [currentDrawable, naturalSize]);

  /** Re-records the clip in real time: plays the source video from the start
   *  while painting censored frames onto a canvas whose stream (plus the
   *  source's audio tracks, when the browser exposes them) feeds a
   *  MediaRecorder. */
  const exportVideo = useCallback(async (): Promise<ExportResult> => {
    const video = videoRef.current;
    const size = naturalSize;
    if (!video || !size) throw new Error("media not ready");

    setPlaying(false);
    video.pause();
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done);
    });

    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    const exportScratch = createScratch();
    const paint = () =>
      paintCensoredFrame(
        ctx,
        video,
        size.w,
        size.h,
        regionsRef.current.filter((region) =>
          regionActiveAt(region, video.currentTime)
        ),
        video.currentTime,
        exportScratch
      );
    paint();

    const stream = canvas.captureStream(30);
    // Carry the source audio through when the element can expose it.
    try {
      const withCapture = video as HTMLVideoElement & {
        captureStream?: () => MediaStream;
      };
      const mediaStream = withCapture.captureStream?.();
      mediaStream?.getAudioTracks().forEach((track) => stream.addTrack(track));
    } catch {
      // No element capture support — export video-only.
    }

    const mimeType = pickVideoMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const finished = new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = () => reject(new Error("recording failed"));
    });

    recorder.start(250);
    video.muted = true;
    await video.play();

    await new Promise<void>((resolve) => {
      let raf = 0;
      const tick = () => {
        paint();
        setExportProgress(
          video.duration > 0 ? video.currentTime / video.duration : 0
        );
        if (video.ended) {
          cancelAnimationFrame(raf);
          resolve();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });

    paint();
    recorder.stop();
    stream.getTracks().forEach((track) => track.stop());
    const blob = await finished;
    video.currentTime = 0;

    return {
      blob,
      url: URL.createObjectURL(blob),
      mimeType,
      kind: "video",
    };
  }, [naturalSize]);

  const applyCensoring = useCallback(async () => {
    if (!source || regions.length === 0 || exporting) return;
    setExporting(true);
    setExportProgress(0);
    setSaveState("idle");
    setResult((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    try {
      const next =
        source.kind === "image" ? await exportImage() : await exportVideo();
      setResult(next);
    } catch {
      setLoadError(true);
    } finally {
      setExporting(false);
    }
  }, [exportImage, exportVideo, exporting, regions.length, source]);

  const saveToGallery = useCallback(async () => {
    if (!result || !source || saving) return;
    setSaving(true);
    setSaveState("idle");
    try {
      const formData = new FormData();
      const extension =
        result.kind === "image" ? "png" : downloadExtension(result.mimeType);
      formData.append(
        "file",
        new File([result.blob], `censored.${extension}`, {
          type: result.mimeType,
        })
      );
      formData.append("kind", result.kind);
      formData.append("source", source.filename);
      const res = await fetch("/api/censor/save", {
        method: "POST",
        body: formData,
      });
      setSaveState(res.ok ? "saved" : "failed");
    } catch {
      setSaveState("failed");
    } finally {
      setSaving(false);
    }
  }, [result, saving, source]);

  const downloadName = useMemo(() => {
    if (!result || !source) return "censored";
    const stem = source.filename.replace(/\.\w+$/, "") || "media";
    const extension =
      result.kind === "image" ? "png" : downloadExtension(result.mimeType);
    return `censored-${stem}.${extension}`;
  }, [result, source]);

  const effectLabel = (effect: CensorEffect) =>
    effect === "mosaic" ? t.mosaic : effect === "blur" ? t.blur : t.fill;

  const strengthBounds = (effect: CensorEffect) =>
    effect === "mosaic" ? { min: 4, max: 100 } : { min: 2, max: 60 };

  // --- Render ---------------------------------------------------------------

  const pickButtons = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => setPicker("image")}>
        <Images />
        {t.pickImage}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setPicker("video")}>
        <Film />
        {t.pickVideo}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload />
        {t.upload}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) handleUpload(file);
          event.currentTarget.value = "";
        }}
      />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row lg:overflow-hidden">
      {/* Left: media stage */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:overflow-y-auto">
        {!source ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border p-10 text-center">
            <FolderOpen className="size-8 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">{t.empty}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t.emptyHint}</p>
            </div>
            {pickButtons}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 truncate text-xs text-muted-foreground">
                {source.filename}
                {naturalSize ? ` · ${naturalSize.w}×${naturalSize.h}` : ""}
              </p>
              {pickButtons}
            </div>

            <p className="text-xs text-muted-foreground">{t.howTo}</p>

            {loadError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {t.loadFailed}
              </p>
            )}

            <div className="flex items-start justify-center rounded-lg border border-border bg-black/40 p-3">
              <div
                ref={stageRef}
                className="relative inline-block max-w-full cursor-crosshair touch-none select-none"
                onPointerDown={onStagePointerDown}
                onPointerMove={onStagePointerMove}
                onPointerUp={onStagePointerUp}
                onPointerCancel={onStagePointerUp}
              >
                <canvas
                  ref={canvasRef}
                  width={naturalSize?.w ?? 1}
                  height={naturalSize?.h ?? 1}
                  className="block h-auto max-h-[65vh] w-auto max-w-full rounded"
                />
                {source.kind === "video" && (
                  <video
                    ref={videoRef}
                    src={source.url}
                    preload="auto"
                    playsInline
                    muted
                    className="hidden"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      setNaturalSize({
                        w: video.videoWidth,
                        h: video.videoHeight,
                      });
                      setDuration(video.duration || 0);
                    }}
                    onLoadedData={redraw}
                    onSeeked={redraw}
                    onEnded={() => setPlaying(false)}
                    onError={() => setLoadError(true)}
                  />
                )}

                {/* Region overlays, positioned in % of the stage so they track
                    the canvas at any display size. */}
                {naturalSize &&
                  regions.map((region, index) => {
                    // Time-windowed regions only show on frames they censor.
                    if (
                      source.kind === "video" &&
                      !regionActiveAt(region, currentTime)
                    ) {
                      return null;
                    }
                    const selected = region.id === selectedId;
                    const groupName = region.sourceLabel
                      ? LABEL_TO_GROUP.get(region.sourceLabel)?.names[
                          ko ? "ko" : "en"
                        ]
                      : null;
                    // Tracked regions draw their overlay at the keyframe-
                    // interpolated position for the current frame.
                    const frame = regionFrameAt(
                      region,
                      source.kind === "video" ? currentTime : null
                    );
                    return (
                      <div
                        key={region.id}
                        onPointerDown={(event) =>
                          onRegionPointerDown(event, region)
                        }
                        className={cn(
                          "absolute cursor-move border-2",
                          region.shape === "ellipse" &&
                            !region.mask &&
                            "rounded-full",
                          (region.mask || region.track) && "border-dashed",
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-white/70 bg-white/5 hover:border-primary/70"
                        )}
                        style={{
                          left: `${(frame.x / naturalSize.w) * 100}%`,
                          top: `${(frame.y / naturalSize.h) * 100}%`,
                          width: `${(frame.w / naturalSize.w) * 100}%`,
                          height: `${(frame.h / naturalSize.h) * 100}%`,
                        }}
                      >
                        <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/70 px-1 text-[10px] font-semibold text-white">
                          {index + 1} · {effectLabel(region.effect)}
                          {groupName ? ` · ${groupName}` : ""}
                        </span>
                        {!region.track && (
                          <span
                            onPointerDown={(event) =>
                              onHandlePointerDown(event, region)
                            }
                            className={cn(
                              "absolute -bottom-1.5 -right-1.5 size-3 cursor-nwse-resize rounded-sm border border-white",
                              selected ? "bg-primary" : "bg-white/80"
                            )}
                          />
                        )}
                      </div>
                    );
                  })}

                {!naturalSize && !loadError && (
                  <div className="flex h-48 w-72 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>

            {source.kind === "video" && naturalSize && (
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={playing ? t.pause : t.play}
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    if (playing) {
                      video.pause();
                      setPlaying(false);
                    } else {
                      void video.play().then(() => setPlaying(true));
                    }
                  }}
                  disabled={exporting}
                >
                  {playing ? <Pause /> : <Play />}
                </Button>
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration, 0.01)}
                  step={0.01}
                  value={currentTime}
                  onChange={(event) => {
                    const video = videoRef.current;
                    if (!video) return;
                    const next = Number(event.currentTarget.value);
                    video.currentTime = next;
                    setCurrentTime(next);
                  }}
                  className="h-1.5 flex-1 accent-primary"
                  disabled={exporting}
                />
                <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {currentTime.toFixed(1)}s / {duration.toFixed(1)}s
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Right: region list + apply/result */}
      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-80 lg:overflow-y-auto">
        <section className="rounded-lg border border-border p-3">
          <h2 className="mb-1 text-xs font-semibold text-muted-foreground">
            {t.autoDetect}
          </h2>
          <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
            {t.autoDetectHint}
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            <span className="mr-1 self-center text-[11px] text-muted-foreground">
              {t.detectTargets}
            </span>
            {DETECT_GROUPS.map((group) => {
              const on = enabledGroups.has(group.key);
              return (
                <Button
                  key={group.key}
                  type="button"
                  size="sm"
                  variant={on ? "secondary" : "ghost"}
                  className={cn("h-7 px-2", !on && "text-muted-foreground")}
                  onClick={() =>
                    setEnabledGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                >
                  {group.names[ko ? "ko" : "en"]}
                </Button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-16 shrink-0">{t.sensitivity}</span>
            <input
              type="range"
              min={5}
              max={80}
              value={detectThreshold}
              onChange={(event) =>
                setDetectThreshold(Number(event.currentTarget.value))
              }
              className="h-1.5 flex-1 accent-primary"
            />
            <span className="w-10 shrink-0 text-right tabular-nums">
              {detectThreshold}%
            </span>
          </label>
          <label className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-16 shrink-0">{t.boxPadding}</span>
            <input
              type="range"
              min={0}
              max={60}
              value={detectPadding}
              onChange={(event) =>
                setDetectPadding(Number(event.currentTarget.value))
              }
              className="h-1.5 flex-1 accent-primary"
            />
            <span className="w-10 shrink-0 text-right tabular-nums">
              {detectPadding}%
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={useSam2}
              onChange={(event) => setUseSam2(event.currentTarget.checked)}
              className="mt-0.5 size-3.5 accent-primary"
            />
            <span>
              <span className="font-medium text-foreground">{t.sam2Label}</span>
              <span className="mt-0.5 block text-[11px] leading-4">
                {t.sam2Hint}
              </span>
            </span>
          </label>
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => void detectOnce()}
              disabled={
                !source || !naturalSize || detecting || scanning || exporting
              }
            >
              {detecting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {source?.kind === "video" ? t.detectFrame : t.detectImage}
            </Button>
            {source?.kind === "video" &&
              (scanning ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    scanCancelRef.current = true;
                  }}
                >
                  <X />
                  {t.stopScan} {Math.round(scanProgress * 100)}%
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => void scanWholeClip()}
                  disabled={!naturalSize || detecting || exporting}
                >
                  <ScanSearch />
                  {t.scanAll}
                </Button>
              ))}
          </div>
          {scanning && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(scanProgress * 100)}%` }}
              />
            </div>
          )}
          {source?.kind === "video" && !scanning && (
            <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
              {t.scanHint}
            </p>
          )}
          {detectStatus && (
            <p
              className={cn(
                "mt-2 text-[11px] leading-4",
                detectStatus.kind === "error"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {detectStatus.kind === "ok"
                ? t.detectAdded(detectStatus.count)
                : detectStatus.kind === "none"
                  ? t.detectNone
                  : t.detectFailed}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-border p-3">
          <h2 className="mb-2 text-xs font-semibold text-muted-foreground">
            {t.newRegion}
          </h2>
          <div className="flex flex-col gap-2">
            <div className="flex gap-1">
              {EFFECT_OPTIONS.map((effect) => (
                <Button
                  key={effect}
                  type="button"
                  variant={draftEffect === effect ? "secondary" : "ghost"}
                  size="sm"
                  className="flex-1"
                  onClick={() => setDraftEffect(effect)}
                >
                  {effectLabel(effect)}
                </Button>
              ))}
            </div>
            {draftEffect !== "fill" ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-16 shrink-0">
                  {draftEffect === "mosaic" ? t.strengthMosaic : t.strengthBlur}
                </span>
                <input
                  type="range"
                  min={strengthBounds(draftEffect).min}
                  max={strengthBounds(draftEffect).max}
                  value={clamp(
                    draftStrength,
                    strengthBounds(draftEffect).min,
                    strengthBounds(draftEffect).max
                  )}
                  onChange={(event) =>
                    setDraftStrength(Number(event.currentTarget.value))
                  }
                  className="h-1.5 flex-1 accent-primary"
                />
                <span className="w-8 shrink-0 text-right tabular-nums">
                  {draftStrength}
                </span>
              </label>
            ) : (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-16 shrink-0">{t.color}</span>
                <input
                  type="color"
                  value={draftColor}
                  onChange={(event) => setDraftColor(event.currentTarget.value)}
                  className="h-7 w-12 cursor-pointer rounded border border-border bg-background"
                />
                <span className="tabular-nums">{draftColor}</span>
              </label>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-16 shrink-0">{t.shape}</span>
              <div className="flex flex-1 gap-1">
                {(["rect", "ellipse"] as const).map((shape) => (
                  <Button
                    key={shape}
                    type="button"
                    variant={draftShape === shape ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 flex-1"
                    onClick={() => setDraftShape(shape)}
                  >
                    {shape === "rect" ? t.shapeRect : t.shapeEllipse}
                  </Button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-16 shrink-0">{t.feather}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={draftFeather}
                onChange={(event) =>
                  setDraftFeather(Number(event.currentTarget.value))
                }
                className="h-1.5 flex-1 accent-primary"
              />
              <span className="w-8 shrink-0 text-right tabular-nums">
                {draftFeather}
              </span>
            </label>
          </div>
        </section>

        <section className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-muted-foreground">
              {t.regions} ({regions.length})
            </h2>
            {regions.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRegions([]);
                  setSelectedId(null);
                }}
              >
                <Trash2 />
                {t.clearAll}
              </Button>
            )}
          </div>
          {regions.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">{t.noRegions}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {regions.map((region, index) => {
                const selected = region.id === selectedId;
                const bounds = strengthBounds(region.effect);
                const groupName = region.sourceLabel
                  ? LABEL_TO_GROUP.get(region.sourceLabel)?.names[
                      ko ? "ko" : "en"
                    ]
                  : null;
                return (
                  <li
                    key={region.id}
                    className={cn(
                      "rounded-md border p-2",
                      selected ? "border-primary" : "border-border"
                    )}
                    onClick={() => {
                      setSelectedId(region.id);
                      // Jump the preview into a time-windowed region's window
                      // so selecting it always shows what it censors.
                      const video = videoRef.current;
                      if (
                        video &&
                        source?.kind === "video" &&
                        region.start !== undefined &&
                        !regionActiveAt(region, video.currentTime)
                      ) {
                        video.currentTime = Math.min(
                          video.duration || region.start,
                          region.start + 0.05
                        );
                        setCurrentTime(video.currentTime);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                        {index + 1}
                      </span>
                      <select
                        value={region.effect}
                        onChange={(event) =>
                          updateRegion(region.id, {
                            effect: event.currentTarget.value as CensorEffect,
                          })
                        }
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus-visible:border-ring"
                      >
                        {EFFECT_OPTIONS.map((effect) => (
                          <option key={effect} value={effect}>
                            {effectLabel(effect)}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t.remove}
                        onClick={(event) => {
                          event.stopPropagation();
                          removeRegion(region.id);
                        }}
                      >
                        <X />
                      </Button>
                    </div>
                    <div className="mt-2">
                      {region.effect !== "fill" ? (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="w-16 shrink-0">
                            {region.effect === "mosaic"
                              ? t.strengthMosaic
                              : t.strengthBlur}
                          </span>
                          <input
                            type="range"
                            min={bounds.min}
                            max={bounds.max}
                            value={clamp(region.strength, bounds.min, bounds.max)}
                            onChange={(event) =>
                              updateRegion(region.id, {
                                strength: Number(event.currentTarget.value),
                              })
                            }
                            className="h-1.5 flex-1 accent-primary"
                          />
                          <span className="w-8 shrink-0 text-right tabular-nums">
                            {region.strength}
                          </span>
                        </label>
                      ) : (
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="w-16 shrink-0">{t.color}</span>
                          <input
                            type="color"
                            value={region.color}
                            onChange={(event) =>
                              updateRegion(region.id, {
                                color: event.currentTarget.value,
                              })
                            }
                            className="h-7 w-12 cursor-pointer rounded border border-border bg-background"
                          />
                          <span className="tabular-nums">{region.color}</span>
                        </label>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <select
                        value={
                          region.track
                            ? "track"
                            : region.mask
                              ? "mask"
                              : (region.shape ?? "rect")
                        }
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          if (value === "mask" || value === "track") return;
                          // Switching to a plain shape drops the SAM2 mask and
                          // the tracking keyframes (back to the union box).
                          updateRegion(region.id, {
                            shape: value as "rect" | "ellipse",
                            mask: undefined,
                            track: undefined,
                          });
                        }}
                        className="h-7 w-24 shrink-0 rounded-md border border-border bg-background px-1.5 text-xs outline-none focus-visible:border-ring"
                      >
                        {region.track && (
                          <option value="track">{t.shapeTrack}</option>
                        )}
                        {region.mask && (
                          <option value="mask">{t.shapeMask}</option>
                        )}
                        <option value="rect">{t.shapeRect}</option>
                        <option value="ellipse">{t.shapeEllipse}</option>
                      </select>
                      <span className="shrink-0">{t.feather}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={region.feather ?? 0}
                        onChange={(event) =>
                          updateRegion(region.id, {
                            feather: Number(event.currentTarget.value),
                          })
                        }
                        className="h-1.5 min-w-0 flex-1 accent-primary"
                      />
                      <span className="w-6 shrink-0 text-right tabular-nums">
                        {region.feather ?? 0}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="w-24 shrink-0">{t.expand}</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={region.expand ?? 0}
                        onChange={(event) =>
                          updateRegion(region.id, {
                            expand: Number(event.currentTarget.value),
                          })
                        }
                        className="h-1.5 min-w-0 flex-1 accent-primary"
                      />
                      <span className="w-6 shrink-0 text-right tabular-nums">
                        {region.expand ?? 0}
                      </span>
                    </div>
                    {(groupName || region.track || region.start !== undefined) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {groupName && (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                            {groupName}
                          </span>
                        )}
                        {region.track && (
                          <span className="rounded bg-muted px-1.5 py-0.5">
                            {t.trackChip(region.track.length)}
                          </span>
                        )}
                        {region.start !== undefined &&
                          region.end !== undefined && (
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              <span className="tabular-nums">
                                {region.start.toFixed(1)}–
                                {region.end.toFixed(1)}s
                              </span>
                              <button
                                type="button"
                                title={t.wholeClip}
                                aria-label={t.wholeClip}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  updateRegion(region.id, {
                                    start: undefined,
                                    end: undefined,
                                  });
                                }}
                                className="rounded p-0.5 hover:bg-muted"
                              >
                                <X className="size-3" />
                              </button>
                            </span>
                          )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border p-3">
          {source?.kind === "video" && (
            <p className="mb-2 text-[11px] leading-4 text-muted-foreground">
              {t.videoNote}
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            onClick={() => void applyCensoring()}
            disabled={
              !source ||
              !naturalSize ||
              regions.length === 0 ||
              exporting ||
              scanning
            }
          >
            {exporting ? (
              <>
                <Loader2 className="animate-spin" />
                {t.applying}
                {source?.kind === "video"
                  ? ` ${Math.round(exportProgress * 100)}%`
                  : ""}
              </>
            ) : (
              <>
                <Square />
                {t.apply}
              </>
            )}
          </Button>
          {source && regions.length === 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t.applyFirst}
            </p>
          )}
          {exporting && source?.kind === "video" && (
            <>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${Math.round(exportProgress * 100)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t.exportingVideo}
              </p>
            </>
          )}

          {result && (
            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {t.result}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.close}
                  onClick={() =>
                    setResult((prev) => {
                      if (prev) URL.revokeObjectURL(prev.url);
                      return null;
                    })
                  }
                >
                  <X />
                </Button>
              </div>
              {result.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.url}
                  alt=""
                  className="max-h-48 w-full rounded-md border border-border object-contain"
                />
              ) : (
                <video
                  src={result.url}
                  controls
                  playsInline
                  className="max-h-48 w-full rounded-md border border-border bg-black"
                />
              )}
              <div className="flex gap-2">
                <a
                  href={result.url}
                  download={downloadName}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "flex-1"
                  )}
                >
                  <Download />
                  {t.download}
                </a>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={() => void saveToGallery()}
                  disabled={saving || saveState === "saved"}
                >
                  {saving ? (
                    <>
                      <Loader2 className="animate-spin" />
                      {t.saving}
                    </>
                  ) : (
                    <>
                      <Save />
                      {t.saveToGallery}
                    </>
                  )}
                </Button>
              </div>
              {saveState === "saved" && (
                <p className="text-[11px] text-muted-foreground">{t.saved}</p>
              )}
              {saveState === "failed" && (
                <p className="text-[11px] text-destructive">{t.saveFailed}</p>
              )}
            </div>
          )}
        </section>
      </aside>

      {picker === "image" && (
        <ImageLibraryPicker
          onClose={() => setPicker(null)}
          onPick={(image) => {
            setPicker(null);
            loadSource({
              kind: "image",
              url: image.url,
              filename: image.filename,
            });
          }}
        />
      )}
      {picker === "video" && (
        <VideoLibraryPicker
          confirmLabel={ko ? "선택" : "Select"}
          onClose={() => setPicker(null)}
          onPickMany={(videos) => {
            setPicker(null);
            const video = videos[0];
            if (video) {
              loadSource({
                kind: "video",
                url: video.url,
                filename: video.filename,
              });
            }
          }}
        />
      )}
    </div>
  );
}
