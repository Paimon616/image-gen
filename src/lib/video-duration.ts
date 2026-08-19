import type { VideoGenerationParams } from "./types";

// Clip length lives in two different places depending on the pipeline: the
// LTX/10Eros workflows take it from their own "Length" + "Frame Rate" pipeline
// controls (the generic canvas inputs are inert there), while the Wan-style
// workflows use num_frames/fps. These helpers translate between "seconds" — what
// the user asks Paimon for — and whichever pair the selected pipeline honors.

// Structural shape shared by the pipeline metadata the video page holds and the
// raw /api/video/pipelines JSON, so both can be passed in as-is.
export interface DurationPipelineControl {
  key: string;
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface DurationPipeline {
  controls?: DurationPipelineControl[];
}

const DEFAULT_FPS = 16;

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function lengthControls(pipeline: DurationPipeline | undefined | null) {
  const controls = pipeline?.controls ?? [];
  const length = controls.find((control) => control.key === "length");
  const frameRate = controls.find((control) => control.key === "frame_rate");
  return length && frameRate ? { length, frameRate } : null;
}

/** The clip length the current params actually produce, in seconds. */
export function videoDurationSeconds(
  pipeline: DurationPipeline | undefined | null,
  params: VideoGenerationParams
): number {
  const controls = lengthControls(pipeline);
  if (controls) {
    const settings = params.video_pipeline_settings ?? {};
    const fps = toNumber(
      settings.frame_rate ?? controls.frameRate.defaultValue,
      24
    );
    const frames = toNumber(settings.length ?? controls.length.defaultValue, 0);
    return frames > 0 ? frames / fps : 0;
  }

  const fps = toNumber(params.fps, DEFAULT_FPS);
  return params.num_frames > 0 ? params.num_frames / fps : 0;
}

/**
 * The params patch that makes the clip `seconds` long on the selected pipeline.
 * Pipeline-driven lengths are snapped to the control's own step from its minimum
 * (which keeps the LTX 8n+1 grid intact); num_frames falls back to the 4n+1 grid
 * the Wan workflows expect.
 */
export function videoDurationPatch(
  pipeline: DurationPipeline | undefined | null,
  params: VideoGenerationParams,
  seconds: number
): Partial<VideoGenerationParams> {
  const safeSeconds = Math.max(1, Math.round(seconds));
  const controls = lengthControls(pipeline);

  if (controls) {
    const settings = params.video_pipeline_settings ?? {};
    const fps = toNumber(
      settings.frame_rate ?? controls.frameRate.defaultValue,
      24
    );
    const min = toNumber(controls.length.min, 1);
    const max = toNumber(controls.length.max, Number.MAX_SAFE_INTEGER);
    const step = toNumber(controls.length.step, 1);
    const target = safeSeconds * fps;
    const snapped = min + Math.round((target - min) / step) * step;

    return {
      video_pipeline_settings: {
        ...settings,
        length: Math.min(max, Math.max(min, snapped)),
      },
      duration_seconds: safeSeconds,
    };
  }

  const fps = toNumber(params.fps, DEFAULT_FPS);
  const frames = Math.max(
    5,
    Math.round((safeSeconds * fps - 1) / 4) * 4 + 1
  );
  return { num_frames: frames, duration_seconds: safeSeconds };
}
