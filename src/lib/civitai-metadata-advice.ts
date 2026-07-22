import type {
  CivitaiGenerationRecommendation,
  CivitaiMetadataField,
  CivitaiMetadataReport,
  GenerationParams,
} from "./types";

interface AdviceInput {
  meta: Record<string, unknown>;
  params: Partial<GenerationParams>;
  imageWidth?: number;
  imageHeight?: number;
  metadataHidden: boolean;
  baseModel?: string;
}

export function recommendedCivitaiBackend(meta: Record<string, unknown>) {
  const backendText = [
    meta.Backend,
    meta.backend,
    meta.Software,
    meta.software,
    meta.Generator,
    meta.generator,
    meta.Version,
    meta.version,
  ]
    .map(valueText)
    .filter(Boolean)
    .join(" ");

  if (/comfyui/i.test(backendText)) return { backend: "comfyui" as const, confirmed: true };
  if (/forge|(?:^|\s)f\d+\.\d+(?:\.\d+)?v\d+\.\d+/i.test(backendText)) {
    return { backend: "forge" as const, confirmed: true };
  }
  if (/automatic\s*1111|a1111|stable diffusion webui/i.test(backendText)) {
    return { backend: "a1111" as const, confirmed: true };
  }

  // A generic WebUI version and model-family guesses cannot distinguish Forge
  // from A1111 reliably. Prefer the more conservative A1111 default.
  return { backend: "a1111" as const, confirmed: false };
}

function hasValue(meta: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => {
    const value = meta[key];
    return value !== undefined && value !== null && value !== "";
  });
}

function valueText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function field(
  key: string,
  label: string,
  status: CivitaiMetadataField["status"],
  value?: unknown,
  note?: string
): CivitaiMetadataField {
  return { key, label, status, value: valueText(value), note };
}

function round8(value: number) {
  return Math.max(256, Math.round(value / 8) * 8);
}

export function buildCivitaiMetadataAdvice({
  meta,
  params,
  imageWidth,
  imageHeight,
  metadataHidden,
  baseModel,
}: AdviceInput): {
  metadataReport: CivitaiMetadataReport;
  recommendations: CivitaiGenerationRecommendation[];
} {
  const version = valueText(meta.Version ?? meta.version) ?? "";
  const backendRecommendation = recommendedCivitaiBackend(meta);
  const size = valueText(meta.Size ?? meta.size);
  const hasHiresScale = hasValue(meta, "Hires upscale", "hiresUpscale");
  const hasHiresSteps = hasValue(meta, "Hires steps", "hiresSteps");
  const hasHiresUpscaler = hasValue(meta, "Hires upscaler", "hiresUpscaler");
  const hasDenoise = hasValue(meta, "Denoising strength", "denoisingStrength");
  const hasAnyHires = hasHiresScale || hasHiresSteps || hasHiresUpscaler || hasDenoise;
  const finalWidth = imageWidth ?? params.width;
  const finalHeight = imageHeight ?? params.height;
  const finalPixels = (finalWidth ?? 0) * (finalHeight ?? 0);
  const largeFinalImage = finalPixels > 2_000_000;
  const modelText = `${baseModel ?? ""} ${valueText(meta.Model ?? meta.model) ?? ""}`;
  const isIllustrious = /illustrious|a.?mix|wai/i.test(modelText);

  const fields: CivitaiMetadataField[] = [
    field("prompt", "Prompt", hasValue(meta, "prompt", "Prompt") ? "confirmed" : "missing"),
    field(
      "negative_prompt",
      "Negative prompt",
      hasValue(meta, "negativePrompt", "negative_prompt", "Negative prompt")
        ? "confirmed"
        : "missing"
    ),
    field("model", "Checkpoint", hasValue(meta, "Model", "model", "ModelName") ? "confirmed" : "missing", meta.Model ?? meta.model),
    field("seed", "Seed", hasValue(meta, "seed", "Seed") ? "confirmed" : "missing", meta.seed ?? meta.Seed),
    field("steps", "Steps", hasValue(meta, "steps", "Steps") ? "confirmed" : "missing", meta.steps ?? meta.Steps),
    field("cfg", "CFG scale", hasValue(meta, "cfgScale", "CFG scale", "cfg") ? "confirmed" : "missing", meta.cfgScale ?? meta["CFG scale"] ?? meta.cfg),
    field("sampler", "Sampler", hasValue(meta, "sampler", "Sampler") ? "confirmed" : "missing", meta.sampler ?? meta.Sampler),
    field(
      "scheduler",
      "Scheduler",
      hasValue(meta, "scheduler", "Scheduler", "Schedule type", "schedule type")
        ? "confirmed"
        : "missing",
      meta.scheduler ?? meta.Scheduler ?? meta["Schedule type"]
    ),
    field("clip_skip", "CLIP Skip", hasValue(meta, "Clip skip", "clipSkip") ? "confirmed" : "missing", meta["Clip skip"] ?? meta.clipSkip),
    field("final_size", "Final image size", size || (finalWidth && finalHeight) ? "confirmed" : "missing", size ?? (finalWidth && finalHeight ? `${finalWidth}x${finalHeight}` : undefined)),
    field(
      "base_size",
      "First-pass size",
      hasAnyHires && size ? "confirmed" : largeFinalImage ? "inferred" : "missing",
      hasAnyHires ? size : undefined,
      !hasAnyHires && largeFinalImage
        ? "The reported size may be a final upscale size; the first-pass size is unknown."
        : undefined
    ),
    field(
      "hires",
      "Hires/upscale workflow",
      hasAnyHires ? "confirmed" : largeFinalImage ? "missing" : "inferred",
      hasAnyHires ? "Present" : undefined,
      !hasAnyHires && largeFinalImage ? "No Hires fields were published for a large final image." : undefined
    ),
    field("vae", "VAE", hasValue(meta, "VAE", "vae") ? "confirmed" : "missing", meta.VAE ?? meta.vae),
    field(
      "backend",
      "Generation backend",
      backendRecommendation.confirmed ? "confirmed" : "inferred",
      backendRecommendation.backend,
      backendRecommendation.confirmed
        ? undefined
        : "The source backend is not explicit, so A1111 is recommended by default."
    ),
    field("workflow", "ComfyUI workflow", "missing", undefined, /comfyui/i.test(version) ? "The backend name does not include its node graph or custom-node versions." : undefined),
    field("noise", "Noise/RNG implementation", "missing"),
    field("postprocess", "Post-processing/color correction", "missing"),
  ];

  const confirmedCount = fields.filter((item) => item.status === "confirmed").length;
  const inferredCount = fields.filter((item) => item.status === "inferred").length;
  const missingCount = fields.filter((item) => item.status === "missing").length;
  const reproducibility = metadataHidden || missingCount >= 6 ? "low" : missingCount >= 3 ? "medium" : "high";
  const metadataReport: CivitaiMetadataReport = {
    reproducibility,
    summary:
      reproducibility === "high"
        ? "Most generation-critical fields are present."
        : reproducibility === "medium"
          ? "Some generation stages are missing, so an exact match is not guaranteed."
          : "Important workflow details are missing. Treat generated settings as recommendations, not the original recipe.",
    confirmedCount,
    inferredCount,
    missingCount,
    fields,
  };

  const width = finalWidth ?? 1024;
  const height = finalHeight ?? 1024;
  const inferredScale = largeFinalImage ? 2 : 1;
  const baseWidth = inferredScale > 1 ? round8(width / inferredScale) : round8(width);
  const baseHeight = inferredScale > 1 ? round8(height / inferredScale) : round8(height);
  const samplerParams = {
    sampler_name: params.sampler_name,
    scheduler: params.scheduler,
    num_inference_steps: params.num_inference_steps,
    guidance_scale: params.guidance_scale,
    clip_skip: params.clip_skip,
    seed: params.seed,
  } satisfies Partial<GenerationParams>;

  // Preserve the published CLIP Skip. In this Forge/Illustrious setup changing
  // it did not alter output; the observed noise came from the Hires second pass.
  const stableSamplerParams = samplerParams;
  const closestUpscaler = params.upscale_model_name || "4x-UltraSharp";
  const closestScale =
    typeof params.hires_upscale === "number" && params.hires_upscale > 1
      ? params.hires_upscale
      : 2;
  const closestSteps = hasHiresSteps && typeof params.hires_steps === "number"
    ? params.hires_steps
    : Math.max(1, Math.round((params.num_inference_steps ?? 30) / 2));
  const closestParams = {
    ...params,
    backend: backendRecommendation.backend,
    width,
    height,
    hires_upscale: closestScale,
    hires_steps: closestSteps,
    upscale_model_name: closestUpscaler,
  } satisfies Partial<GenerationParams>;

  const recommendations: CivitaiGenerationRecommendation[] = [
    {
      id: "closest-estimate",
      title: "Closest reconstruction estimate",
      goal: "closest",
      description: hasHiresUpscaler && hasHiresSteps
        ? "Uses the published Hires recipe and fills no generation-critical values."
        : "Automatically applies an upscaler and fills missing second-pass steps for the closest estimate.",
      params: closestParams,
    },
    {
      id: "literal-metadata",
      title: "Literal metadata",
      goal: "literal",
      description: hasAnyHires
        ? "Applies the Hires fields exactly as published."
        : "Uses the published final dimensions without inventing a Hires stage.",
      caution: largeFinalImage && !hasAnyHires ? "A large single pass can produce color shifts, duplicated subjects, or latent collapse." : undefined,
      params: hasAnyHires
        ? { ...params }
        : { ...params, width, height, hires_upscale: 1, hires_steps: 0, upscale_model_name: "" },
    },
    {
      id: "stable-generation",
      title: "Stable generation",
      goal: "stable",
      description: "Disables denoising Hires and uses a conservative native resolution for predictable output.",
      params: { ...stableSamplerParams, backend: backendRecommendation.backend, width: baseWidth, height: baseHeight, hires_upscale: 1, hires_steps: 0, upscale_model_name: "" },
    },
    {
      id: "quality-priority",
      title: "Quality priority",
      goal: "quality",
      description: "Uses a strong native-resolution sampler recipe without a second denoising pass.",
      caution: "For a larger final image, upscale the finished image separately instead of using Hires denoising.",
      params: { ...stableSamplerParams, backend: backendRecommendation.backend, width: baseWidth, height: baseHeight, sampler_name: isIllustrious ? "dpmpp_2m" : params.sampler_name, scheduler: isIllustrious ? "karras" : params.scheduler, num_inference_steps: Math.max(30, params.num_inference_steps ?? 0), hires_upscale: 1, hires_steps: 0, upscale_model_name: "" },
    },
  ];

  return { metadataReport, recommendations };
}
