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
// civitai.com/models/2914130 (Krea2 v1.0) - trigger word "PoseDaal".
const KREA2_DYNAMIC_POSE_LORA = "More_Dynamic_Poses_Krea2_000002500.safetensors";
// civitai.com/models/3022787 (v2) - no trigger word; the angle phrase at the start of
// the prompt is the trigger ("high angle shot", "low angle shot from behind", ...).
const KREA2_CAMERA_ANGLES_LORA = "CameraAngles_Krea2_v2.safetensors";
// civitai.com/models/3193133 version (Krea2 v1) - trigger "detailed expression and emotion".
const KREA2_EMOTIONS_LORA = "Detailed_Emotions_Expressions_Krea2_V1.safetensors";

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
      ko: "Krea2 Turbo + Identity Edit(참조 강도 0.7) + Refusal-Reduction 1.0 + More Dynamic Poses 1.0 + Camera Angles 1.0 + Detailed Emotions 0.8 · 10스텝 · CFG 1. 참조 이미지의 인물과 화풍을 유지하면서 노출 묘사와 다양한 포즈 · 표정 · 카메라 각도를 따릅니다. 프롬프트는 영어 문장으로: 각도 문구(high angle shot / low angle shot / low angle shot from behind / high angle shot from behind / worm's eye view / eye level shot) → 'an illustration of ...' → 트리거 PoseDaal · 'detailed expression and emotion' 순서로 쓰세요. 얼굴 좌우는 인물 기준(her left)이 아니라 화면 기준으로: 'side profile facing the LEFT edge of the picture: her nose points toward the left side of the frame, the back of her head is on the right side of the frame'. 얼굴 각도는 포즈 · 표정 문장이 많으면 밀리니 앞쪽에 쓰세요.",
      en: "Krea2 Turbo + Identity Edit (reference 0.7) + Refusal-Reduction 1.0 + More Dynamic Poses 1.0 + Camera Angles 1.0 + Detailed Emotions 0.8 · 10 steps · CFG 1. Keeps the reference character and art style while following nudity prompts and varied poses / expressions / camera angles. Write English sentences: an angle phrase (high angle shot, low angle shot, low angle shot from behind, high angle shot from behind, worm's eye view, eye level shot), then 'an illustration of ...', then the triggers PoseDaal and 'detailed expression and emotion'. Give face left/right relative to the picture, not to her: 'side profile facing the LEFT edge of the picture: her nose points toward the left side of the frame, the back of her head is on the right side of the frame'. Put the face direction early; long pose / expression text drowns it.",
    },
    modelCandidates: ["krea2_turbo_fp8_scaled.safetensors", "krea2_turbo_bf16.safetensors"],
    params: {
      loras: [
        { path: KREA2_REFUSAL_LORA, scale: 1 },
        { path: KREA2_DYNAMIC_POSE_LORA, scale: 1 },
        { path: KREA2_CAMERA_ANGLES_LORA, scale: 1 },
        { path: KREA2_EMOTIONS_LORA, scale: 0.8 },
      ],
      num_inference_steps: 10,
      guidance_scale: 1,
      sampler_name: "euler",
      scheduler: "simple",
      clip_skip: 1,
      krea2_workflow: "generic",
      character_reference_strength: 0.7,
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
