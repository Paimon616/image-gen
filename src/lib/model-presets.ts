import { DEFAULT_PARAMS, type GenerationParams } from "@/lib/types";

// One-click model setups for the image tab's model box. A preset sets the model,
// LoRAs and the sampling values that go with that model; it never touches the
// prompt, the reference images or the size, so switching presets keeps the work.
export interface ModelPreset {
  id: string;
  label: { ko: string; en: string };
  description: { ko: string; en: string };
  // First file that exists locally wins (fp8 on NVIDIA, bf16 on a Mac install).
  modelCandidates: string[];
  params: Partial<GenerationParams>;
}

const KREA2_REFUSAL_LORA = "Capitan01R_Krea2_TextFusion_Refusal_Reduction_v2_updated.safetensors";

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "hassaku-default",
    label: { ko: "Hassaku 기본", en: "Hassaku default" },
    description: {
      ko: "Hassaku XL + Detailer IL 0.5 · Eye Enhancer 0.6 · HandPatch 0.6 · 30스텝 · CFG 7.5",
      en: "Hassaku XL + Detailer IL 0.5 · Eye Enhancer 0.6 · HandPatch 0.6 · 30 steps · CFG 7.5",
    },
    modelCandidates: [DEFAULT_PARAMS.model_name],
    params: {
      loras: DEFAULT_PARAMS.loras,
      num_inference_steps: DEFAULT_PARAMS.num_inference_steps,
      guidance_scale: DEFAULT_PARAMS.guidance_scale,
      sampler_name: DEFAULT_PARAMS.sampler_name,
      scheduler: DEFAULT_PARAMS.scheduler,
      clip_skip: DEFAULT_PARAMS.clip_skip,
      character_reference_strength: 0.7,
    },
  },
  {
    id: "krea2-identity-adult",
    label: { ko: "Krea2 일관성 · 성인", en: "Krea2 consistency · adult" },
    description: {
      ko: "Krea2 Turbo + Identity Edit(참조 강도 0.75) + Refusal-Reduction 1.0 · 10스텝 · CFG 1. 참조 이미지의 인물과 화풍을 유지하면서 노출 묘사를 따릅니다. 프롬프트는 영어 문장으로 쓰세요.",
      en: "Krea2 Turbo + Identity Edit (reference 0.75) + Refusal-Reduction 1.0 · 10 steps · CFG 1. Keeps the reference character and art style while following nudity prompts. Write the prompt as English sentences.",
    },
    modelCandidates: ["krea2_turbo_fp8_scaled.safetensors", "krea2_turbo_bf16.safetensors"],
    params: {
      loras: [{ path: KREA2_REFUSAL_LORA, scale: 1 }],
      num_inference_steps: 10,
      guidance_scale: 1,
      sampler_name: "euler",
      scheduler: "simple",
      clip_skip: 1,
      krea2_workflow: "generic",
      character_reference_strength: 0.75,
    },
  },
];

export function resolvePresetModel(preset: ModelPreset, availablePaths: string[]) {
  const available = new Set(availablePaths);
  return preset.modelCandidates.find((name) => available.has(name)) ?? preset.modelCandidates[0];
}

export function presetToParams(
  preset: ModelPreset,
  availablePaths: string[]
): Partial<GenerationParams> {
  return {
    ...preset.params,
    loras: (preset.params.loras ?? []).map((lora) => ({ ...lora })),
    model: "comfyui/local-sdxl",
    backend: "comfyui",
    model_name: resolvePresetModel(preset, availablePaths),
  };
}

// The preset whose model and LoRA set match the current params, if any.
export function activePresetId(params: GenerationParams): string | null {
  const loraKey = (loras: GenerationParams["loras"]) =>
    loras
      .filter((lora) => lora.path)
      .map((lora) => `${lora.path}@${lora.scale}`)
      .sort()
      .join("|");
  const current = loraKey(params.loras);
  const match = MODEL_PRESETS.find(
    (preset) =>
      preset.modelCandidates.includes(params.model_name) &&
      loraKey(preset.params.loras ?? []) === current
  );
  return match?.id ?? null;
}
