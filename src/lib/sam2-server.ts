import { mkdir, stat, writeFile } from "fs/promises";
import { dirname, join } from "path";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

// SAM2 (hiera-tiny, ONNX export) running in the Next server. Given boxes from
// the NudeNet detector it returns per-box alpha masks that follow the actual
// part contour, so the censor screen can paint part-shaped censoring instead
// of rectangles. Encoder ~0.6s / decode ~20ms per frame on CPU.

const SAM2_INPUT_SIZE = 1024;
const MASK_SIZE = 256;
// SAM2's official normalization (ImageNet mean/std, RGB).
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

const MODEL_BASE_URL =
  "https://huggingface.co/vietanhdev/segment-anything-2-onnx-models/resolve/main";
const ENCODER_FILE = "sam2_hiera_tiny.encoder.onnx";
const DECODER_FILE = "sam2_hiera_tiny.decoder.onnx";
const MODEL_MIN_BYTES = 1_000_000;

function sam2ModelDir() {
  const comfyDir =
    process.env.COMFYUI_DIR?.trim() || join(process.cwd(), "ComfyUI");
  return join(comfyDir, "models", "sam2-onnx");
}

async function fileBigEnough(path: string) {
  const info = await stat(path).catch(() => null);
  return Boolean(info?.isFile() && info.size >= MODEL_MIN_BYTES);
}

const downloadPromises = new Map<string, Promise<void>>();

async function ensureModel(filename: string) {
  const path = join(sam2ModelDir(), filename);
  if (await fileBigEnough(path)) return path;
  let pending = downloadPromises.get(filename);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(`${MODEL_BASE_URL}/${filename}`);
      if (!res.ok) throw new Error(`model download failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength < MODEL_MIN_BYTES) {
        throw new Error("model download failed: file too small");
      }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, buffer);
    })().finally(() => {
      downloadPromises.delete(filename);
    });
    downloadPromises.set(filename, pending);
  }
  await pending;
  return path;
}

let sessionsPromise: Promise<{
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
}> | null = null;

async function getSessions() {
  if (!sessionsPromise) {
    sessionsPromise = (async () => {
      const [encoderPath, decoderPath] = await Promise.all([
        ensureModel(ENCODER_FILE),
        ensureModel(DECODER_FILE),
      ]);
      const [encoder, decoder] = await Promise.all([
        ort.InferenceSession.create(encoderPath),
        ort.InferenceSession.create(decoderPath),
      ]);
      return { encoder, decoder };
    })().catch((error) => {
      sessionsPromise = null;
      throw error;
    });
  }
  return sessionsPromise;
}

export interface SegmentBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** How far past the detector box the returned mask may grow, as a fraction
   *  of the box size per side. Default 0.5; genitals warrant more because the
   *  detector often boxes only part of the organ. */
  grow?: number;
}

export interface SegmentResult {
  /** Base64 of raw alpha bytes (one byte per pixel, row-major, box.w × box.h).
   *  Raw instead of PNG on purpose: the client writes it with putImageData,
   *  bypassing the browser's image-decode pipeline, which stalls in
   *  hidden/occluded pages and froze whole-clip scans. */
  mask: string;
  /** The image-pixel box the mask is cropped to. Can be LARGER than the
   *  detector's box when the segmented object extends past it (e.g. the
   *  detector boxed only part of an organ). */
  box: SegmentBox;
}

// How far past the detector box the prompt looks (fraction of the box size
// per side). Detector boxes are often tight on the most confident part of an
// organ; the segmenter sees (and the mask keeps) the rest.
const PROMPT_EXPAND = 0.3;
const DEFAULT_MASK_GROWTH = 0.5;

/**
 * Segments each box's object and returns, per box, a mask PNG plus the box it
 * covers — the union of the detector box and wherever the segmented object
 * actually extends (within a growth limit). Order matches the input boxes.
 */
export async function segmentBoxes(
  imageBuffer: Buffer,
  boxes: SegmentBox[]
): Promise<SegmentResult[]> {
  if (boxes.length === 0) return [];
  const { encoder, decoder } = await getSessions();

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (width < 1 || height < 1) throw new Error("unreadable image");

  // SAM2 squashes the image to a 1024×1024 square (no letterbox).
  const raw = await sharp(imageBuffer)
    .resize(SAM2_INPUT_SIZE, SAM2_INPUT_SIZE, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
  const pixels = SAM2_INPUT_SIZE * SAM2_INPUT_SIZE;
  const imageData = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    imageData[i] = (raw[i * 3] / 255 - MEAN[0]) / STD[0];
    imageData[pixels + i] = (raw[i * 3 + 1] / 255 - MEAN[1]) / STD[1];
    imageData[2 * pixels + i] = (raw[i * 3 + 2] / 255 - MEAN[2]) / STD[2];
  }

  const encoded = await encoder.run({
    [encoder.inputNames[0]]: new ort.Tensor("float32", imageData, [
      1,
      3,
      SAM2_INPUT_SIZE,
      SAM2_INPUT_SIZE,
    ]),
  });

  // Decode per box (the exported decoder does not broadcast a num_labels > 1
  // batch): each is a 2-point prompt with the box-corner labels
  // (2 = top-left, 3 = bottom-right), in 1024-square space. Decoding is ~20ms
  // per box, so the loop is cheap next to the encoder pass.
  const scaleX = SAM2_INPUT_SIZE / width;
  const scaleY = SAM2_INPUT_SIZE / height;
  const results: SegmentResult[] = [];
  for (const box of boxes) {
    // Prompt with a loosened box so the segmenter can grab the whole object
    // when the detector boxed only its most confident part.
    const promptX1 = Math.max(0, box.x - box.w * PROMPT_EXPAND);
    const promptY1 = Math.max(0, box.y - box.h * PROMPT_EXPAND);
    const promptX2 = Math.min(width, box.x + box.w * (1 + PROMPT_EXPAND));
    const promptY2 = Math.min(height, box.y + box.h * (1 + PROMPT_EXPAND));
    const coords = new Float32Array([
      promptX1 * scaleX,
      promptY1 * scaleY,
      promptX2 * scaleX,
      promptY2 * scaleY,
    ]);
    const decoded = await decoder.run({
      image_embed: encoded.image_embed,
      high_res_feats_0: encoded.high_res_feats_0,
      high_res_feats_1: encoded.high_res_feats_1,
      point_coords: new ort.Tensor("float32", coords, [1, 2, 2]),
      point_labels: new ort.Tensor("float32", new Float32Array([2, 3]), [1, 2]),
      mask_input: new ort.Tensor(
        "float32",
        new Float32Array(MASK_SIZE * MASK_SIZE),
        [1, 1, MASK_SIZE, MASK_SIZE]
      ),
      has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
    });

    const masks = decoded.masks;
    const ious = decoded.iou_predictions.data as Float32Array;
    const [, candidateCount, maskH, maskW] = masks.dims;
    const logits = masks.data as Float32Array;
    const maskPixels = maskH * maskW;

    // The decoder proposes several masks per prompt; keep the best-scoring.
    let best = 0;
    for (let c = 1; c < candidateCount; c++) {
      if (ious[c] > ious[best]) best = c;
    }
    const offset = best * maskPixels;
    // Binary at the model's decision boundary — a plain sigmoid leaves the
    // whole background at a faint nonzero alpha (visible haze). The smooth
    // upscale below (plus the client's feather) softens the edge instead.
    const alpha = Buffer.alloc(maskPixels);
    for (let p = 0; p < maskPixels; p++) {
      alpha[p] = logits[offset + p] > 0 ? 255 : 0;
    }

    // Where the segmented object actually sits: the mask's own bounding box,
    // allowed to grow up to one box-size past the detector box per side.
    let mx1 = maskW;
    let my1 = maskH;
    let mx2 = -1;
    let my2 = -1;
    for (let p = 0; p < maskPixels; p++) {
      if (alpha[p] === 0) continue;
      const px = p % maskW;
      const py = (p / maskW) | 0;
      if (px < mx1) mx1 = px;
      if (px > mx2) mx2 = px;
      if (py < my1) my1 = py;
      if (py > my2) my2 = py;
    }

    let finalX = box.x;
    let finalY = box.y;
    let finalX2 = box.x + box.w;
    let finalY2 = box.y + box.h;
    if (mx2 >= 0) {
      const grow = box.grow ?? DEFAULT_MASK_GROWTH;
      const growX = box.w * grow;
      const growY = box.h * grow;
      const bx1 = Math.max((mx1 / maskW) * width, box.x - growX);
      const by1 = Math.max((my1 / maskH) * height, box.y - growY);
      const bx2 = Math.min(((mx2 + 1) / maskW) * width, box.x + box.w + growX);
      const by2 = Math.min(((my2 + 1) / maskH) * height, box.y + box.h + growY);
      finalX = Math.max(0, Math.min(finalX, bx1));
      finalY = Math.max(0, Math.min(finalY, by1));
      finalX2 = Math.min(width, Math.max(finalX2, bx2));
      finalY2 = Math.min(height, Math.max(finalY2, by2));
    }
    const finalBox = {
      x: Math.round(finalX),
      y: Math.round(finalY),
      w: Math.max(1, Math.round(finalX2 - finalX)),
      h: Math.max(1, Math.round(finalY2 - finalY)),
    };

    // Crop the full-frame mask down to that box, then scale it to the box's
    // pixel size in the submitted image.
    const left = Math.max(
      0,
      Math.min(maskW - 1, Math.floor((finalBox.x / width) * maskW))
    );
    const top = Math.max(
      0,
      Math.min(maskH - 1, Math.floor((finalBox.y / height) * maskH))
    );
    const cropW = Math.max(
      1,
      Math.min(maskW - left, Math.ceil((finalBox.w / width) * maskW))
    );
    const cropH = Math.max(
      1,
      Math.min(maskH - top, Math.ceil((finalBox.h / height) * maskH))
    );
    const outW = finalBox.w;
    const outH = finalBox.h;

    // NOTE: sharp's resize may widen a 1-channel raw image to 3 channels, so
    // read the output's actual channel count instead of assuming one — indexing
    // a 3-channel buffer as 1-channel shreds the mask into row stripes.
    const { data: cropped, info: cropInfo } = await sharp(alpha, {
      raw: { width: maskW, height: maskH, channels: 1 },
    })
      .extract({ left, top, width: cropW, height: cropH })
      .resize(outW, outH, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const stride = cropInfo.channels;

    const alphaOut = Buffer.alloc(outW * outH);
    for (let p = 0; p < outW * outH; p++) {
      alphaOut[p] = cropped[p * stride];
    }
    results.push({
      mask: alphaOut.toString("base64"),
      box: finalBox,
    });
  }
  return results;
}
