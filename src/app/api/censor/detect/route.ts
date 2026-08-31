import { NextRequest, NextResponse } from "next/server";
import { detectNudity } from "@/lib/nudenet-server";
import { segmentBoxes } from "@/lib/sam2-server";

// NudeNet auto-detection for the censor screen: takes one image (or one video
// frame rendered to an image by the client) and returns labeled NSFW boxes in
// that image's pixel coordinates. With segment=1 each detection also carries a
// SAM2 contour mask (PNG data URL, cropped to its box) so the censoring can
// follow the part's actual shape.

function parseMinScore(value: FormDataEntryValue | null) {
  const parsed = typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return 0.25;
  return Math.min(0.95, Math.max(0.05, parsed));
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const minScore = parseMinScore(formData.get("minScore"));
    const segment = formData.get("segment") === "1";
    // thorough adds zoomed tile passes (~4× inference) — worth it for one-shot
    // detects, skipped by the frame-by-frame video scan.
    const thorough = formData.get("thorough") === "1";
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await detectNudity(buffer, minScore, thorough);

    if (segment && result.detections.length > 0) {
      // Genital/anus boxes are frequently partial (the organ continues past
      // them), so their masks may grow further than other parts'.
      const masks = await segmentBoxes(
        buffer,
        result.detections.map((det) => ({
          ...det,
          grow: /GENITALIA|ANUS/.test(det.label) ? 1.0 : 0.4,
        }))
      );
      return NextResponse.json({
        ...result,
        detections: result.detections.map((det, i) => ({
          ...det,
          mask: masks[i].mask,
          // The box the mask is cropped to — may extend past the detector box
          // when the segmented object does.
          maskBox: masks[i].box,
        })),
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "detect failed";
    // A missing/failed model download is a setup problem, not a bad request.
    const status = /model download/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
