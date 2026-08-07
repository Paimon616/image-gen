import { basename, join, normalize, relative, resolve } from "path";

export interface VideoPipelineDefinition {
  id: string;
  label: string;
  description: string;
  workflowPath: string;
  mode: "i2v" | "t2v";
  experimental?: boolean;
  defaults: Record<string, string | number | boolean>;
  controls: VideoPipelineControl[];
}

export interface VideoPipelineControl {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "boolean";
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  group: "core" | "sampling" | "conditioning" | "lora" | "resize" | "advanced";
  help: string;
  patches: Array<{
    nodeId: string;
    input: string;
  }>;
}

const PROJECT_ROOT = process.cwd();
const WORKFLOWS_DIR = join(/*turbopackIgnore: true*/ PROJECT_ROOT, "workflows");

const SULPHUR_BASE_CONTROLS: VideoPipelineControl[] = [
  {
    key: "frame_rate",
    label: "Frame Rate",
    type: "number",
    defaultValue: 24,
    min: 8,
    max: 30,
    step: 1,
    group: "core",
    help: "Workflow node 26/31/38의 FPS입니다. 높이면 움직임은 부드러워지지만 같은 frame 수에서 영상 길이가 짧아집니다.",
    patches: [
      { nodeId: "26", input: "value" },
      { nodeId: "31", input: "frame_rate" },
    ],
  },
  {
    key: "length",
    label: "Length",
    type: "number",
    defaultValue: 241,
    min: 25,
    max: 321,
    step: 8,
    group: "core",
    help: "생성할 총 frame 수입니다. LTX workflow는 8n+1 길이가 안정적입니다. 값이 커질수록 VRAM과 시간이 크게 증가합니다.",
    patches: [{ nodeId: "27", input: "value" }],
  },
  {
    key: "sampler",
    label: "Sampler",
    type: "select",
    defaultValue: "euler_ancestral",
    options: ["euler_ancestral", "euler_ancestral_cfg_pp", "lcm"],
    group: "sampling",
    help: "최종 sampling node의 sampler입니다. base workflow는 euler_ancestral이 품질 우선, cfg_pp는 빠른 distilled 계열에 더 잘 맞습니다.",
    patches: [{ nodeId: "17", input: "sampler_name" }],
  },
  {
    key: "steps",
    label: "Steps",
    type: "number",
    defaultValue: 50,
    min: 4,
    max: 80,
    step: 1,
    group: "sampling",
    help: "LTXVScheduler steps입니다. base는 40~50이 품질 기준이고 distilled는 6~10 정도가 빠릅니다.",
    patches: [{ nodeId: "47", input: "steps" }],
  },
  {
    key: "cfg",
    label: "CFG",
    type: "number",
    defaultValue: 3.6,
    min: 0,
    max: 8,
    step: 0.1,
    group: "conditioning",
    help: "최종 CFGGuider 값입니다. 높이면 prompt를 더 강하게 따르지만 artifact와 과장된 motion이 늘 수 있습니다.",
    patches: [{ nodeId: "42", input: "cfg" }],
  },
  {
    key: "max_shift",
    label: "Max Shift",
    type: "number",
    defaultValue: 2.72,
    min: 0,
    max: 6,
    step: 0.01,
    group: "sampling",
    help: "LTX scheduler의 high-noise 구간 shift입니다. 높이면 motion 변화가 커질 수 있고 낮추면 안정적이지만 밋밋해질 수 있습니다.",
    patches: [{ nodeId: "47", input: "max_shift" }],
  },
  {
    key: "base_shift",
    label: "Base Shift",
    type: "number",
    defaultValue: 0.8,
    min: 0,
    max: 3,
    step: 0.01,
    group: "sampling",
    help: "LTX scheduler의 base shift입니다. 전체 denoise 흐름의 기준점이라 과하게 바꾸면 색/형태 안정성이 흔들릴 수 있습니다.",
    patches: [{ nodeId: "47", input: "base_shift" }],
  },
  {
    key: "sulphur_strength",
    label: "Sulphur LoRA",
    type: "number",
    defaultValue: 1,
    min: 0,
    max: 2,
    step: 0.05,
    group: "lora",
    help: "sulphur_lora_rank_768.safetensors 강도입니다. 1이 workflow 기본값이고, 0은 해당 LoRA를 사실상 끕니다.",
    patches: [
      { nodeId: "46", input: "strength_model" },
      { nodeId: "60", input: "strength_model" },
    ],
  },
  {
    key: "distilled_strength",
    label: "Distilled LoRA",
    type: "number",
    defaultValue: 0.5,
    min: 0,
    max: 1.5,
    step: 0.05,
    group: "lora",
    help: "ltx-2.3 distilled LoRA 강도입니다. 빠른 추론 성향을 더하지만 너무 높이면 질감이 단순해질 수 있습니다.",
    patches: [{ nodeId: "49", input: "strength_model" }],
  },
];

function sulphurControls(overrides: Record<string, string | number | boolean> = {}) {
  return SULPHUR_BASE_CONTROLS.map((control) => ({
    ...control,
    defaultValue: overrides[control.key] ?? control.defaultValue,
  }));
}

function defaultsFromControls(controls: VideoPipelineControl[]) {
  return Object.fromEntries(controls.map((control) => [control.key, control.defaultValue]));
}

const sulphurI2vBaseControls = sulphurControls();
const sulphurI2vDistilledControls = sulphurControls({
  sampler: "euler_ancestral_cfg_pp",
  steps: 8,
  cfg: 1,
  max_shift: 4,
  base_shift: 1.5,
});
const sulphurT2vBaseControls = sulphurControls();
const sulphurT2vDistilledControls = sulphurControls({
  sampler: "euler_ancestral_cfg_pp",
  steps: 8,
  cfg: 1,
  max_shift: 4,
  base_shift: 1.5,
});
const erosControls: VideoPipelineControl[] = [
  {
    key: "length",
    label: "Length",
    type: "number",
    defaultValue: 241,
    min: 25,
    max: 321,
    step: 8,
    group: "core",
    help: "10Eros triple-pass의 총 frame 수입니다. 8n+1 값을 권장하며 길수록 세 pass 모두 무거워집니다.",
    patches: [{ nodeId: "511", input: "value" }],
  },
  {
    key: "frame_rate",
    label: "Base FPS",
    type: "number",
    defaultValue: 24,
    min: 8,
    max: 30,
    step: 1,
    group: "core",
    help: "base/end frame rate입니다. Video Combine과 conditioning에 영향을 주며, frame 수가 같으면 FPS가 높을수록 재생 시간이 짧아집니다.",
    patches: [
      { nodeId: "542", input: "value" },
      { nodeId: "600", input: "value" },
    ],
  },
  {
    key: "first_pass_lora",
    label: "First Pass LoRA",
    type: "number",
    defaultValue: 0.9,
    min: 0,
    max: 1.5,
    step: 0.05,
    group: "lora",
    help: "첫 번째 pass의 distilled LoRA 강도입니다. 초반 motion 구조를 잡는 강도라 너무 낮추면 흐릿해지고 너무 높이면 단순해질 수 있습니다.",
    patches: [{ nodeId: "517", input: "strength_model" }],
  },
  {
    key: "later_pass_lora",
    label: "Later Pass LoRA",
    type: "number",
    defaultValue: 0.48,
    min: 0,
    max: 1.5,
    step: 0.05,
    group: "lora",
    help: "두 번째/세 번째 pass의 distilled LoRA 강도입니다. 후처리 pass의 질감과 안정성에 영향을 줍니다.",
    patches: [{ nodeId: "518", input: "strength_model" }],
  },
  {
    key: "middle_steps",
    label: "Middle Steps",
    type: "number",
    defaultValue: 8,
    min: 2,
    max: 30,
    step: 1,
    group: "sampling",
    help: "Renoising corrective middle sampler steps입니다. 중간 pass의 보정 강도와 시간을 결정합니다.",
    patches: [{ nodeId: "578", input: "steps" }],
  },
  {
    key: "middle_denoise",
    label: "Middle Denoise",
    type: "number",
    defaultValue: 1,
    min: 0,
    max: 1,
    step: 0.05,
    group: "sampling",
    help: "중간 pass denoise입니다. 1은 강한 재생성, 낮은 값은 원본 motion 보존에 가깝습니다.",
    patches: [{ nodeId: "578", input: "denoise" }],
  },
  {
    key: "guide_strength",
    label: "IC Guide Strength",
    type: "number",
    defaultValue: 0.65,
    min: 0,
    max: 1.5,
    step: 0.05,
    group: "conditioning",
    help: "Add Video IC-LoRA Guide의 이미지 conditioning 강도입니다. I2V 시작 이미지의 형태를 얼마나 강하게 붙잡을지 결정합니다.",
    patches: [{ nodeId: "644", input: "strength" }],
  },
  {
    key: "video_megapixels",
    label: "Video Megapixels",
    type: "number",
    defaultValue: 1.5,
    min: 0.5,
    max: 2,
    step: 0.05,
    group: "resize",
    help: "입력 이미지를 총 픽셀 수 기준으로 resize하는 값입니다. 높이면 선명하지만 VRAM과 시간이 증가합니다.",
    patches: [{ nodeId: "529", input: "resize_type.megapixels" }],
  },
  {
    key: "longer_size",
    label: "Longer Side",
    type: "number",
    defaultValue: 1536,
    min: 768,
    max: 2048,
    step: 64,
    group: "resize",
    help: "참조 이미지의 긴 변 resize 크기입니다. IC guide용 conditioning 이미지 해상도에 영향을 줍니다.",
    patches: [{ nodeId: "530", input: "resize_type.longer_size" }],
  },
];

const BUILTIN_VIDEO_PIPELINES: VideoPipelineDefinition[] = [
  {
    id: "sulphur-ltx23-i2v-distilled-fast",
    label: "Sulphur LTX 2.3 - I2V (distilled, fast)",
    description: "RunPod Video Sulphur LTX 2.3 image-to-video distilled workflow",
    workflowPath: "workflows/sulphur_ltx23_i2v_distilled.json",
    mode: "i2v",
    defaults: defaultsFromControls(sulphurI2vDistilledControls),
    controls: sulphurI2vDistilledControls,
  },
  {
    id: "sulphur-ltx23-i2v-base-high-quality",
    label: "Sulphur LTX 2.3 - I2V (base, high quality)",
    description: "RunPod Video Sulphur LTX 2.3 image-to-video base workflow",
    workflowPath: "workflows/sulphur_ltx23_i2v_base.json",
    mode: "i2v",
    defaults: defaultsFromControls(sulphurI2vBaseControls),
    controls: sulphurI2vBaseControls,
  },
  {
    id: "sulphur-ltx23-t2v-distilled-fast",
    label: "Sulphur LTX 2.3 - T2V (distilled, fast)",
    description: "RunPod Video Sulphur LTX 2.3 text-to-video distilled workflow",
    workflowPath: "workflows/sulphur_ltx23_t2v_distilled.json",
    mode: "t2v",
    defaults: defaultsFromControls(sulphurT2vDistilledControls),
    controls: sulphurT2vDistilledControls,
  },
  {
    id: "sulphur-ltx23-t2v-base-high-quality",
    label: "Sulphur LTX 2.3 - T2V (base, high quality)",
    description: "RunPod Video Sulphur LTX 2.3 text-to-video base workflow",
    workflowPath: "workflows/sulphur_ltx23_t2v_base.json",
    mode: "t2v",
    defaults: defaultsFromControls(sulphurT2vBaseControls),
    controls: sulphurT2vBaseControls,
  },
  {
    id: "10eros-i2v-triple-pass",
    label: "10Eros - I2V (triple-pass, experimental)",
    description: "RunPod Video 10Eros image-to-video triple-pass workflow",
    workflowPath: "workflows/10Eros_10SNodes_TripleSample_I2V.json",
    mode: "i2v",
    experimental: true,
    defaults: defaultsFromControls(erosControls),
    controls: erosControls,
  },
];

function isInsideDirectory(parent: string, child: string) {
  const relativePath = relative(parent, child);
  return Boolean(
    relativePath &&
      !relativePath.startsWith("..") &&
      !relativePath.includes("..\\") &&
      !relativePath.startsWith("/") &&
      !/^[a-z]:/i.test(relativePath)
  );
}

export function defaultVideoPipelineId() {
  return "sulphur-ltx23-i2v-base-high-quality";
}

export function listVideoPipelines() {
  return [...BUILTIN_VIDEO_PIPELINES];
}

export function resolveVideoPipeline(idOrPath: string | undefined) {
  const requested = String(idOrPath ?? "").trim();
  const pipelines = listVideoPipelines();
  const matched =
    pipelines.find((pipeline) => pipeline.id === requested) ??
    pipelines.find((pipeline) => pipeline.workflowPath === requested) ??
    pipelines.find((pipeline) => basename(pipeline.workflowPath) === requested) ??
    pipelines.find((pipeline) => pipeline.id === defaultVideoPipelineId()) ??
    pipelines[0];

  return matched;
}

export async function resolveVideoWorkflowPath(idOrPath: string | undefined) {
  const pipeline = await resolveVideoPipeline(idOrPath);
  const normalized = normalize(pipeline.workflowPath).replace(/^workflows[\\/]/, "");
  const resolved = resolve(WORKFLOWS_DIR, normalized);

  if (!isInsideDirectory(WORKFLOWS_DIR, resolved)) {
    throw new Error("Video workflow path is outside the workflows directory.");
  }

  return { pipeline, absolutePath: resolved };
}
