import { mkdir, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";
import {
  CENSOR_MODEL_DOWNLOAD_URL,
  censorModelFile,
} from "@/lib/censor-assets";

// Runs the NudeNet ONNX detector (the same nudenet.onnx the ComfyUI censor
// path uses) directly in the Next server, so the censor screen can auto-detect
// NSFW regions without a running ComfyUI. Pre/post-processing mirrors the
// pinned ComfyUI-Nudenet node: aspect-preserving resize onto a black 320×320
// letterbox, BGR channel order in 0..1, YOLOv8-style [1, 22, N] output decoded
// with class-agnostic NMS.

export const NUDENET_LABELS = [
  "FEMALE_GENITALIA_COVERED",
  "FACE_FEMALE",
  "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED",
  "FEMALE_GENITALIA_EXPOSED",
  "MALE_BREAST_EXPOSED",
  "ANUS_EXPOSED",
  "FEET_EXPOSED",
  "BELLY_COVERED",
  "FEET_COVERED",
  "ARMPITS_COVERED",
  "ARMPITS_EXPOSED",
  "FACE_MALE",
  "BELLY_EXPOSED",
  "MALE_GENITALIA_EXPOSED",
  "ANUS_COVERED",
  "FEMALE_BREAST_COVERED",
  "BUTTOCKS_COVERED",
] as const;

export type NudenetLabel = (typeof NUDENET_LABELS)[number];

export interface NudenetDetection {
  label: NudenetLabel;
  score: number;
  /** Box in pixels of the submitted image, top-left origin. */
  x: number;
  y: number;
  w: number;
  h: number;
}

const NMS_IOU_THRESHOLD = 0.45;
// A truncated/HTML-error download must not be kept as a model file (same gate
// as scripts/setup-comfyui-censor.sh).
const MODEL_MIN_BYTES = 1_000_000;

// Preferred detectors, best first: the 640px medium model finds small/partial
// parts the 320px nano model misses (and scores true positives much higher),
// at ~100ms/frame on CPU. An explicit COMFYUI_NUDENET_MODEL pins that file.
const DETECTOR_CANDIDATES = [
  {
    file: "640m.onnx",
    url: "https://huggingface.co/zhangsongbo365/nudenet_onnx/resolve/main/640m.onnx",
    inputSize: 640,
  },
  {
    file: "nudenet.onnx",
    url: CENSOR_MODEL_DOWNLOAD_URL,
    inputSize: 320,
  },
];

function nudenetModelDir() {
  const comfyDir =
    process.env.COMFYUI_DIR?.trim() || join(process.cwd(), "ComfyUI");
  return join(comfyDir, "models", "Nudenet");
}

export function nudenetModelPath() {
  return join(nudenetModelDir(), censorModelFile());
}

async function fileBigEnough(path: string) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile() && info.size >= MODEL_MIN_BYTES);
}

let downloadPromise: Promise<void> | null = null;

/** Fetches a detector into the ComfyUI models folder (shared with the
 *  in-graph censor path) when it is not there yet. */
async function ensureModel(path: string, url: string) {
  if (await fileBigEnough(path)) return;
  if (!downloadPromise) {
    downloadPromise = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`model download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength < MODEL_MIN_BYTES) {
        throw new Error("model download failed: file too small");
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer);
    })().finally(() => {
      downloadPromise = null;
    });
  }
  await downloadPromise;
}

interface Detector {
  session: ort.InferenceSession;
  inputSize: number;
}

let detectorPromise: Promise<Detector> | null = null;

/** The model's static input edge when it declares one; `fallback` covers
 *  models exported with dynamic height/width (the 640m export). */
function staticInputSize(session: ort.InferenceSession, fallback: number) {
  const meta = session.inputMetadata?.[0];
  if (!meta?.isTensor) return fallback;
  const edge = meta.shape[2];
  return typeof edge === "number" && edge > 0 ? edge : fallback;
}

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      // An explicit env override pins that exact file (downloaded from the
      // canonical censor URL when absent); otherwise best candidate first,
      // falling back if its download fails.
      const envModel = process.env.COMFYUI_NUDENET_MODEL?.trim();
      const candidates = envModel
        ? [{ file: envModel, url: CENSOR_MODEL_DOWNLOAD_URL, inputSize: 320 }]
        : DETECTOR_CANDIDATES;

      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          const path = join(nudenetModelDir(), candidate.file);
          await ensureModel(path, candidate.url);
          const session = await ort.InferenceSession.create(path);
          return {
            session,
            inputSize: staticInputSize(session, candidate.inputSize),
          };
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error("no NudeNet detector available");
    })().catch((error) => {
      // A failed load must not poison every later request.
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

interface RawBox {
  label: NudenetLabel;
  score: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

function iou(a: RawBox, b: RawBox) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Greedy class-agnostic NMS, matching the cv2.dnn.NMSBoxes call the ComfyUI
 *  node makes over the full candidate list. */
function nms(boxes: RawBox[]) {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: RawBox[] = [];
  for (const box of sorted) {
    if (kept.every((other) => iou(box, other) <= NMS_IOU_THRESHOLD)) {
      kept.push(box);
    }
  }
  return kept;
}

/** One detector pass over one (sub)image; returns unclamped float boxes in
 *  that image's pixel coordinates, pre-NMS. */
async function detectPass(
  detector: Detector,
  imageBuffer: Buffer,
  width: number,
  height: number,
  minScore: number
): Promise<RawBox[]> {
  const { session, inputSize: target } = detector;
  const aspect = width / height;
  let newW: number;
  let newH: number;
  if (height > width) {
    newH = target;
    newW = Math.round(target * aspect);
  } else {
    newW = target;
    newH = Math.round(target / aspect);
  }
  const resizeFactor = Math.sqrt(
    (width * width + height * height) / (newW * newW + newH * newH)
  );
  const padX = target - newW;
  const padY = target - newH;
  const padTop = Math.floor(padY / 2);
  const padLeft = Math.floor(padX / 2);

  const raw = await sharp(imageBuffer)
    .resize(newW, newH, { fit: "fill" })
    .extend({
      top: padTop,
      bottom: padY - padTop,
      left: padLeft,
      right: padX - padLeft,
      background: { r: 0, g: 0, b: 0 },
    })
    .removeAlpha()
    .raw()
    .toBuffer(); // RGB, HWC

  const size = target * target;
  const data = new Float32Array(3 * size);
  for (let i = 0; i < size; i++) {
    // The detector was trained on BGR-ordered channels in 0..1.
    data[i] = raw[i * 3 + 2] / 255;
    data[size + i] = raw[i * 3 + 1] / 255;
    data[2 * size + i] = raw[i * 3] / 255;
  }

  const inputName = session.inputNames[0];
  const outputs = await session.run({
    [inputName]: new ort.Tensor("float32", data, [1, 3, target, target]),
  });
  const output = outputs[session.outputNames[0]];
  const [, channels, rows] = output.dims;
  const values = output.data as Float32Array;

  const candidates: RawBox[] = [];
  for (let row = 0; row < rows; row++) {
    let best = 0;
    let bestId = -1;
    for (let channel = 4; channel < channels; channel++) {
      const score = values[channel * rows + row];
      if (score > best) {
        best = score;
        bestId = channel - 4;
      }
    }
    if (best < minScore || bestId < 0 || bestId >= NUDENET_LABELS.length) {
      continue;
    }
    const cx = values[row];
    const cy = values[rows + row];
    const w = values[2 * rows + row];
    const h = values[3 * rows + row];
    candidates.push({
      label: NUDENET_LABELS[bestId],
      score: best,
      x: (cx - w * 0.5 - padLeft) * resizeFactor,
      y: (cy - h * 0.5 - padTop) * resizeFactor,
      w: w * resizeFactor,
      h: h * resizeFactor,
    });
  }

  return candidates;
}

/** Zoomed sub-frames for the thorough pass: two overlapping halves of the
 *  long side plus a center crop, so parts that are small relative to the
 *  frame still fill enough of the detector's input to be found. */
function thoroughTiles(width: number, height: number) {
  const tiles: { x: number; y: number; w: number; h: number }[] = [];
  if (height >= width) {
    const tileH = Math.round(height * 0.625);
    tiles.push(
      { x: 0, y: 0, w: width, h: tileH },
      { x: 0, y: height - tileH, w: width, h: tileH }
    );
  } else {
    const tileW = Math.round(width * 0.625);
    tiles.push(
      { x: 0, y: 0, w: tileW, h: height },
      { x: width - tileW, y: 0, w: tileW, h: height }
    );
  }
  tiles.push({
    x: Math.round(width * 0.2),
    y: Math.round(height * 0.2),
    w: Math.round(width * 0.6),
    h: Math.round(height * 0.6),
  });
  return tiles;
}

export async function detectNudity(
  imageBuffer: Buffer,
  minScore: number,
  thorough = false
): Promise<{ width: number; height: number; detections: NudenetDetection[] }> {
  const detector = await getDetector();

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1) throw new Error("unreadable image");

  const candidates = await detectPass(
    detector,
    imageBuffer,
    width,
    height,
    minScore
  );

  if (thorough) {
    for (const tile of thoroughTiles(width, height)) {
      const crop = await sharp(imageBuffer)
        .extract({ left: tile.x, top: tile.y, width: tile.w, height: tile.h })
        .png()
        .toBuffer();
      const tileBoxes = await detectPass(
        detector,
        crop,
        tile.w,
        tile.h,
        minScore
      );
      for (const box of tileBoxes) {
        candidates.push({ ...box, x: box.x + tile.x, y: box.y + tile.y });
      }
    }
  }

  const detections = nms(candidates).map((box) => {
    // Clamp into the frame; a box hanging off the letterbox edge otherwise
    // reports negative origins.
    const x = Math.max(0, Math.round(box.x));
    const y = Math.max(0, Math.round(box.y));
    return {
      label: box.label,
      score: Math.round(box.score * 100) / 100,
      x,
      y,
      w: Math.max(1, Math.min(width - x, Math.round(box.w))),
      h: Math.max(1, Math.min(height - y, Math.round(box.h))),
    };
  });

  return { width, height, detections };
}
