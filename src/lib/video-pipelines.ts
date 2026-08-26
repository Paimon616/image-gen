import { basename, join, normalize, relative, resolve } from "path";

export interface VideoPipelineCanvasSupport {
  /** width/height inputs reach a numeric node and change the output size. */
  resolution: boolean;
  /** num_frames reaches a numeric node and changes the frame count. */
  frames: boolean;
  /** fps reaches a numeric node and changes the playback rate. */
  fps: boolean;
}

export interface VideoPipelineDefinition {
  id: string;
  label: string;
  description: string;
  workflowPath: string;
  mode: "i2v" | "t2v";
  experimental?: boolean;
  /**
   * The workflow renders audio and muxes it into the output on its own (e.g. the
   * LTXV audio VAE path or a CreateVideo/VideoCombine node fed an `audio` input).
   * When true the separate "Generate Sound" toggle is irrelevant and hidden.
   */
  embedsAudio: boolean;
  /**
   * Which "Reference & Canvas" fields actually affect this pipeline. The current
   * LTX/10Eros workflows wire width/height/length from internal nodes and take
   * fps/length from the Pipeline controls below, so the generic canvas inputs are
   * inert. Fields marked false are hidden so the UI matches real behavior.
   */
  canvas: VideoPipelineCanvasSupport;
  defaults: Record<string, string | number | boolean>;
  controls: VideoPipelineControl[];
  /**
   * Optional LoRA loaders spliced into the model graph at generation time. Unlike
   * `controls` (which only patch values onto nodes already baked into the workflow),
   * a slot inserts a brand-new LoraLoaderModelOnly node right after the base model
   * loader and repoints every consumer of that model output through it. When the
   * slot's select control is left on its `offValue` (or strength 0) nothing is
   * injected, so the workflow runs byte-for-byte identically to before.
   */
  loraSlots?: VideoPipelineLoraSlot[];
  /**
   * Optional toggles for LoRAs that already live inside a DaSiWa_LTX2LoraLoader
   * `stack_data` stack (baked into the workflow with `on: false`). Unlike
   * `loraSlots` nothing is injected — the toggle just flips the matching stack
   * entry's `on` flag (and strength) at generation time. When the select stays on
   * `offValue` the stack_data string is left byte-for-byte untouched.
   */
  stackLoraToggles?: VideoPipelineStackLoraToggle[];
}

export interface VideoPipelineStackLoraToggle {
  /** Pipeline-setting key whose value selects the stack LoRA (equals `offValue` = disabled). */
  selectKey: string;
  /** Pipeline-setting key holding the numeric strength (`str` in stack_data); 0 keeps it off. */
  strengthKey: string;
  /** Select value that means "leave the stack untouched" (e.g. "None"). */
  offValue: string;
  /** Node id of the DaSiWa_LTX2LoraLoader carrying the stack. */
  nodeId: string;
  /** Map from select option label to the exact `lora` filename inside stack_data. */
  loraByOption: Record<string, string>;
}

export interface VideoPipelineLoraSlot {
  /** Pipeline-setting key whose value selects the LoRA (equals `offValue` = disabled). */
  selectKey: string;
  /** Pipeline-setting key holding the numeric strength_model. */
  strengthKey: string;
  /** Select value that means "do not inject" (e.g. "None"). */
  offValue: string;
  /** LoRA file name as it lives under ComfyUI/models/loras. */
  loraName: string;
  /** Node id of the base model loader whose model output feeds the LoRA/sampler chain. */
  sourceNodeId: string;
  /** Output slot of the source node that carries the model (default 0). */
  sourceOutput?: number;
  /** Node id assigned to the injected loader — must not collide with the workflow. */
  injectNodeId: string;
  /** ComfyUI loader class (default LoraLoaderModelOnly — LTX 2.3 LoRAs are model-only). */
  loraClass?: string;
}

// The LTX 2.3 / 10Eros workflows drive size from the reference image resize and
// take frame count / fps from their Pipeline controls (Length, Base FPS, Video
// Megapixels, Longer Side). The generic canvas width/height/frames/fps inputs
// never reach a numeric node, so none of them are honored.
const NO_CANVAS_SUPPORT: VideoPipelineCanvasSupport = {
  resolution: false,
  frames: false,
  fps: false,
};

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

// --- Optional "East Asian Facial Fidelity" LoRA (LTX 2.3 I2V) -----------------
// https://civitai.red/models/2816700 — improves face/eye/jaw consistency of East
// Asian women during large camera motion. Standard model-only LoRA, no trigger
// word, recommended strength 1.0. Selectable on every LTX 2.3 pipeline; when the
// dropdown stays on "None" the pipeline is unchanged.
//
// Set this to whatever the file is actually named under ComfyUI/models/loras.
const FACE_FIDELITY_LORA_FILE = "East_Asian_Facial_Fidelity_LTX23_I2V.safetensors";
const FACE_FIDELITY_OFF = "None";
const FACE_FIDELITY_ON = "동아시아 얼굴 충실도 (East Asian Facial Fidelity)";

// Same key names on every pipeline so a user's choice survives pipeline switches.
const FACE_FIDELITY_SELECT_KEY = "face_fidelity_lora";
const FACE_FIDELITY_STRENGTH_KEY = "face_fidelity_strength";
const FACE_FIDELITY_INJECT_NODE_ID = "ff_lora_inject";

function faceFidelityControls(): VideoPipelineControl[] {
  return [
    {
      key: FACE_FIDELITY_SELECT_KEY,
      label: "Face Fidelity LoRA",
      type: "select",
      defaultValue: FACE_FIDELITY_OFF,
      options: [FACE_FIDELITY_OFF, FACE_FIDELITY_ON],
      group: "lora",
      help:
        "동아시아 여성 얼굴의 형태·눈매·홍채·윤곽 일관성을 높이는 LTX 2.3 I2V용 선택 LoRA입니다. " +
        "'None'이면 기존과 완전히 동일하게 동작하고, 켜면 모델 로더 직후에 LoRA가 주입돼 모든 pass에 적용됩니다. " +
        `ComfyUI/models/loras 안에 '${FACE_FIDELITY_LORA_FILE}' 파일이 있어야 합니다(파일명이 다르면 video-pipelines.ts의 FACE_FIDELITY_LORA_FILE 값을 변경하세요).`,
      patches: [],
    },
    {
      key: FACE_FIDELITY_STRENGTH_KEY,
      label: "Face LoRA Strength",
      type: "number",
      defaultValue: 1,
      min: 0,
      max: 1.5,
      step: 0.05,
      group: "lora",
      help: "Face Fidelity LoRA 강도(strength_model)입니다. 모델 카드 권장값은 1.0이며, 0이면 켜져 있어도 주입하지 않습니다(기존과 동일).",
      patches: [],
    },
  ];
}

function faceFidelitySlot(sourceNodeId: string): VideoPipelineLoraSlot {
  return {
    selectKey: FACE_FIDELITY_SELECT_KEY,
    strengthKey: FACE_FIDELITY_STRENGTH_KEY,
    offValue: FACE_FIDELITY_OFF,
    loraName: FACE_FIDELITY_LORA_FILE,
    sourceNodeId,
    injectNodeId: FACE_FIDELITY_INJECT_NODE_ID,
    loraClass: "LoraLoaderModelOnly",
  };
}

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
  ...faceFidelityControls(),
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
  ...faceFidelityControls(),
];

// PornMaster-krea2 (LTX 2.3) I2V+audio workflow reconstructed from the reference
// video's embedded ComfyUI prompt. Prompt / negative prompt (nodes 536 / 537) and
// the reference image (node 773 LoadImage) are injected by the generic video params,
// so they are not exposed here. The distilled multi-weight LoRA strengths
// (nodes 779-782) and the whole NSFW LoRA stack (node 922, LoraManager) are kept
// baked exactly as captured so output matches the source video.
const krea2Controls: VideoPipelineControl[] = [
  {
    key: "seed",
    label: "Seed",
    type: "number",
    defaultValue: 133733223221282,
    min: 0,
    step: 1,
    group: "core",
    help: "node 524 (Seed rgthree) -> RandomNoise. 캡처된 원본 seed가 기본값입니다. 같은 seed·같은 입력이면 원본 영상과 동일하게 재생성되고, 값을 바꾸면 다른 변주가 나옵니다.",
    patches: [{ nodeId: "524", input: "seed" }],
  },
  {
    key: "length",
    label: "Length",
    type: "number",
    defaultValue: 264,
    min: 33,
    max: 361,
    step: 1,
    group: "core",
    help: "node 796 (mxSlider Xi) -> latent length 계산으로 이어지는 총 frame 수입니다. 값이 커질수록 VRAM과 시간이 크게 증가합니다.",
    patches: [{ nodeId: "796", input: "Xi" }],
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
    help: "node 542 (PrimitiveFloat) -> LTXVConditioning frame_rate 및 VHS_VideoCombine frame_rate입니다. frame 수가 같으면 FPS가 높을수록 재생 시간이 짧아집니다.",
    patches: [{ nodeId: "542", input: "value" }],
  },
  {
    key: "image_guide",
    label: "Image Guide Strength",
    type: "number",
    defaultValue: 0.8,
    min: 0,
    max: 1,
    step: 0.05,
    group: "conditioning",
    help: "node 797 (mxSlider Xf) -> LTXVImgToVideoInplaceKJ / LTXVAddGuide strength입니다. 시작 이미지의 형태를 얼마나 강하게 유지할지 결정합니다. 높이면 입력 이미지에 더 충실하고, 낮추면 motion 자유도가 커집니다.",
    patches: [{ nodeId: "797", input: "Xf" }],
  },
  ...faceFidelityControls(),
];

// LTX-2.5 two-stage distilled I2V (+audio), reconstructed from the official
// Lightricks/ComfyUI-LTXVideo `2.5/LTX-2.5_T2V_I2V_Two_Stage_Distilled` template.
// The official template ships as nested ComfyUI subgraphs; it was expanded to a
// flat API-format prompt via ComfyUI's own graphToPrompt (hence the `5575:xxxx`
// colon-namespaced node ids). Two changes vs. the raw template make it a clean,
// deterministic self-hosted I2V:
//   1. The cloud "Gemma API Text Encode" + local prompt-enhancer branches (which
//      needed an LTX API key / a second Gemma encoder) were pruned; the positive
//      and negative CLIPTextEncode nodes are wired straight to the prompt strings.
//   2. The "use image" boolean (node 5014:5506) is forced true so the image
//      conditioning is active (the raw template defaults to text-to-video).
//   3. The transformer loader (node 5575:5569) uses the *distilled* 22B model,
//      not the dev model the raw template shipped as a placeholder. Per the LTX-2.5
//      model card the distilled model is the one designed for this workflow's fixed
//      8-step (+3-step upscale) schedule at CFG=1; the dev model needs far more steps
//      and produces garbled motion at 8 steps. The video VAE uses the `conv` variant,
//      which is the decoder architecture ComfyUI's core VAELoader builds for LTX-2.5.
// The base latent renders at width×height then a second pass runs a latent x2
// upscaler + re-sample, so 960×544 outputs ~1920×1088. Audio is decoded through
// the LTXV audio VAE and muxed by the CreateVideo node, so the clip carries sound.
// Official constraints (LTX-2.5 model card): frame count must be 8n+1 (the duration
// formula guarantees this) and width/height must be divisible by 32.
const ltx25I2vControls: VideoPipelineControl[] = [
  {
    key: "seed",
    label: "Seed",
    type: "number",
    defaultValue: 43,
    min: 0,
    step: 1,
    group: "core",
    help: "두 pass의 RandomNoise seed(node 5516:4832 / 5517:4967)입니다. 같은 seed·같은 입력이면 동일하게 재생성되고, 값을 바꾸면 다른 변주가 나옵니다.",
    patches: [
      { nodeId: "5516:4832", input: "noise_seed" },
      { nodeId: "5517:4967", input: "noise_seed" },
    ],
  },
  {
    key: "duration_seconds",
    label: "Duration (sec)",
    type: "number",
    defaultValue: 5,
    min: 1,
    max: 20,
    step: 1,
    group: "core",
    help: "생성할 영상 길이(초)입니다. 프레임 수 = 1 + floor(fps×초/8)×8(항상 8n+1). ⚠️ LTX-2.5 안정 범위는 6~20초이고 품질 최상은 6~10초입니다. 20초를 넘기면 모델이 코헤런스를 잃어 구간별로 뭉개지므로 최대 20초로 제한됩니다(30초 등은 자동으로 20초로 clamp).",
    patches: [{ nodeId: "5512", input: "value" }],
  },
  {
    key: "fps",
    label: "FPS",
    type: "number",
    defaultValue: 24,
    min: 8,
    max: 60,
    step: 1,
    group: "core",
    help: "재생 프레임레이트(node 5511)입니다. 오디오 latent·CreateVideo·프레임 수 계산에 함께 쓰입니다. 초가 같으면 FPS가 높을수록 프레임 수가 늘어납니다.",
    patches: [{ nodeId: "5511", input: "value" }],
  },
  {
    key: "width",
    label: "Base Width",
    type: "number",
    defaultValue: 960,
    min: 512,
    max: 1280,
    step: 32,
    group: "resize",
    help: "1차 pass의 기본 latent 가로(node 5514:3059)입니다. 2차 pass에서 x2 업스케일되어 최종은 약 2배가 됩니다. 32의 배수여야 하며, 입력 이미지의 가로세로비에 맞추면 왜곡이 줄어듭니다.",
    patches: [{ nodeId: "5514:3059", input: "width" }],
  },
  {
    key: "height",
    label: "Base Height",
    type: "number",
    defaultValue: 544,
    min: 512,
    max: 1280,
    step: 32,
    group: "resize",
    help: "1차 pass의 기본 latent 세로(node 5514:3059)입니다. 32의 배수여야 합니다. 최종 해상도는 2차 x2 업스케일 후 값의 약 2배입니다.",
    patches: [{ nodeId: "5514:3059", input: "height" }],
  },
  {
    key: "image_conditioning_size",
    label: "Image Cond. Longer Side",
    type: "number",
    defaultValue: 1536,
    min: 768,
    max: 2048,
    step: 64,
    group: "resize",
    help: "시작 이미지를 conditioning용으로 resize하는 긴 변 크기(node 5014:4990)입니다. 높이면 시작 이미지의 디테일이 더 잘 보존되지만 VRAM이 늘 수 있습니다.",
    patches: [{ nodeId: "5014:4990", input: "resize_type.longer_size" }],
  },
  {
    key: "image_guide",
    label: "Image Guide Strength",
    type: "number",
    defaultValue: 0.7,
    min: 0,
    max: 1,
    step: 0.05,
    group: "conditioning",
    help: "1차 pass의 이미지 conditioning 강도(node 5514:3159)입니다. 시작 이미지의 형태를 얼마나 강하게 유지할지 결정합니다. 높이면 입력에 더 충실하고, 낮추면 motion 자유도가 커집니다.",
    patches: [{ nodeId: "5514:3159", input: "strength" }],
  },
  {
    key: "cfg",
    label: "CFG",
    type: "number",
    defaultValue: 1,
    min: 1,
    max: 8,
    step: 0.1,
    group: "conditioning",
    help: "두 pass의 CFGGuider 값(node 5516:4828 / 5517:4964)입니다. LTX-2.5 distilled 모델은 8-step 고정 스케줄에서 CFG=1로 동작하도록 설계됐으니 1로 두는 것을 강력히 권장합니다. 올리면 distilled 특성상 artifact·과장된 motion이 늘 수 있습니다.",
    patches: [
      { nodeId: "5516:4828", input: "cfg" },
      { nodeId: "5517:4964", input: "cfg" },
    ],
  },
  {
    key: "upscale_image_guide",
    label: "Upscale Image Guide",
    type: "number",
    defaultValue: 1,
    min: 0,
    max: 1,
    step: 0.05,
    group: "advanced",
    help: "2차(업스케일) pass의 이미지 conditioning 강도(node 5517:4970)입니다. 기본 1.0이며, 낮추면 업스케일 pass가 원본 형태에서 더 자유롭게 재생성합니다.",
    patches: [{ nodeId: "5517:4970", input: "strength" }],
  },
];

// LTX-2.5 text-to-video: the same two-stage distilled workflow with the image
// conditioning branch removed (no LoadImage / resize / preprocess / ImgToVideoInplace);
// the empty latent feeds the sampler directly, so generation is driven purely by the
// text prompt. Same distilled transformer + DiffVAE + 8-step/CFG=1 config as the i2v
// pipeline, so the image-only controls (image guide, cond. size, upscale guide) are dropped.
const ltx25T2vControls: VideoPipelineControl[] = [
  {
    key: "seed",
    label: "Seed",
    type: "number",
    defaultValue: 43,
    min: 0,
    step: 1,
    group: "core",
    help: "두 pass의 RandomNoise seed(node 5516:4832 / 5517:4967)입니다. 같은 seed·같은 프롬프트면 동일하게 재생성됩니다.",
    patches: [
      { nodeId: "5516:4832", input: "noise_seed" },
      { nodeId: "5517:4967", input: "noise_seed" },
    ],
  },
  {
    key: "duration_seconds",
    label: "Duration (sec)",
    type: "number",
    defaultValue: 5,
    min: 1,
    max: 20,
    step: 1,
    group: "core",
    help: "생성할 영상 길이(초)입니다. 프레임 수 = 1 + floor(fps×초/8)×8(항상 8n+1). ⚠️ LTX-2.5 안정 범위 6~20초, 품질 최상 6~10초. 20초 초과 시 구간 붕괴가 생겨 최대 20초로 clamp됩니다. t2v는 이미지 앵커가 없어 특히 짧은 길이(≤10초)를 권장합니다.",
    patches: [{ nodeId: "5512", input: "value" }],
  },
  {
    key: "fps",
    label: "FPS",
    type: "number",
    defaultValue: 24,
    min: 8,
    max: 60,
    step: 1,
    group: "core",
    help: "재생 프레임레이트(node 5511)입니다. 공식 권장 24~25fps.",
    patches: [{ nodeId: "5511", input: "value" }],
  },
  {
    key: "width",
    label: "Base Width",
    type: "number",
    defaultValue: 960,
    min: 512,
    max: 1280,
    step: 32,
    group: "resize",
    help: "1차 pass 기본 latent 가로(node 5514:3059). 32의 배수. 최종은 2차 x2 업스케일로 약 2배(예: 960→1920). 16:9는 960×544, 9:16 세로는 544×960.",
    patches: [{ nodeId: "5514:3059", input: "width" }],
  },
  {
    key: "height",
    label: "Base Height",
    type: "number",
    defaultValue: 544,
    min: 512,
    max: 1280,
    step: 32,
    group: "resize",
    help: "1차 pass 기본 latent 세로(node 5514:3059). 32의 배수. 최종 해상도는 값의 약 2배입니다.",
    patches: [{ nodeId: "5514:3059", input: "height" }],
  },
  {
    key: "cfg",
    label: "CFG",
    type: "number",
    defaultValue: 1,
    min: 1,
    max: 8,
    step: 0.1,
    group: "conditioning",
    help: "두 pass의 CFGGuider 값(node 5516:4828 / 5517:4964). LTX-2.5 distilled는 8-step 고정 스케줄에서 CFG=1로 설계됐으니 1 권장.",
    patches: [
      { nodeId: "5516:4828", input: "cfg" },
      { nodeId: "5517:4964", input: "cfg" },
    ],
  },
];

// DaSiWa MiniMax H3 I2VA (image→video+audio), captured verbatim from a source
// video's embedded ComfyUI prompt (DaSiWa "MythicAlchemy" workflow). The graph is
// the exact executed flat API prompt, so defaults reproduce the source video when
// given the same image/prompt/seed. Prompt and reference image live on the
// MiniMaxH3Director node and are injected by applyVideoParamsToWorkflow (the
// Director has no negative-prompt input — the guider is CFG-less BasicGuider).
// The DaSiWa LoRA stack (node 2678) defaults to the captured state — only
// MysticXXX_MMH3-V3 @ 0.9 enabled — but the lightx2v turbo distill LoRAs (baked
// into the stack with on:false) can be flipped on via the Turbo LoRA control
// below for 8-step / 4-step fast sampling. Requires ComfyUI >= 0.30.0 (native
// MiniMax H3) plus the ComfyUI-DaSiWa-Nodes and ComfyUI-KJNodes packs on the pod.
const MMH3_TURBO_OFF = "None";
const MMH3_TURBO_8STEP = "8-step v1.0 (품질 우선 터보)";
const MMH3_TURBO_4STEP = "4-step v0.1 (최고 속도)";
const MMH3_TURBO_LORAS: Record<string, string> = {
  [MMH3_TURBO_8STEP]:
    "minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors",
  [MMH3_TURBO_4STEP]:
    "minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors",
};

const dasiwaMinimaxH3I2vaControls: VideoPipelineControl[] = [
  {
    key: "seed",
    label: "Seed",
    type: "number",
    defaultValue: 815967602714924,
    min: 0,
    step: 1,
    group: "core",
    help: "RandomNoise seed(node 1512:2600)입니다. 캡처된 원본 seed가 기본값이라 같은 이미지·프롬프트면 원본 영상과 동일하게 재생성되고, 값을 바꾸면 다른 변주가 나옵니다.",
    patches: [{ nodeId: "1512:2600", input: "noise_seed" }],
  },
  {
    key: "duration_seconds",
    label: "Duration (sec)",
    type: "number",
    defaultValue: 10,
    min: 1,
    max: 15,
    step: 1,
    group: "core",
    help: "생성할 영상 길이(초)입니다(node 2730 duration). MiniMax H3의 안정 범위는 5~10초이며 원본 영상은 10초입니다. 길수록 VRAM과 시간이 크게 증가합니다.",
    patches: [{ nodeId: "2730", input: "duration" }],
  },
  {
    key: "frame_rate",
    label: "FPS",
    type: "number",
    defaultValue: 24,
    min: 8,
    max: 30,
    step: 1,
    group: "core",
    help: "재생 프레임레이트(node 2730 frame_rate)입니다. Enhanced Video Combine의 FPS는 Director 출력에서 이어받으므로 이 값 하나로 함께 바뀝니다.",
    patches: [{ nodeId: "2730", input: "frame_rate" }],
  },
  {
    key: "width",
    label: "Width",
    type: "number",
    defaultValue: 736,
    min: 256,
    max: 1920,
    step: 16,
    group: "resize",
    help: "출력 가로(node 2730 width)입니다. MiniMax H3는 latent가 16px당 1이고 2×2 패치를 쓰므로 32의 배수여야 합니다(16의 배수만으로는 patchify reshape 오류). 원본 영상은 736×1280(9:16 세로)입니다.",
    patches: [{ nodeId: "2730", input: "width" }],
  },
  {
    key: "height",
    label: "Height",
    type: "number",
    defaultValue: 1280,
    min: 256,
    max: 1920,
    step: 16,
    group: "resize",
    help: "출력 세로(node 2730 height)입니다. 16의 배수여야 합니다.",
    patches: [{ nodeId: "2730", input: "height" }],
  },
  {
    key: "auto_aspect",
    label: "Auto Aspect",
    type: "boolean",
    defaultValue: true,
    group: "resize",
    help:
      "시작 이미지의 가로세로 비율에 맞춰 출력 캔버스를 자동 재계산합니다(Width×Height 픽셀 예산 유지, 16px 배수). " +
      "끄면 Width/Height 값을 그대로 쓰며, 이미지 비율과 다르면 영상이 좁아지거나(홀쭉) 늘어나 보일 수 있습니다.",
    patches: [],
  },
  {
    key: "prompt_autoformat",
    label: "Prompt Auto-Format",
    type: "boolean",
    defaultValue: true,
    group: "conditioning",
    help:
      "프롬프트가 MiniMax Director 형식이 아니면 원본 예시 영상들과 같은 구조로 자동 포장합니다 " +
      "(시작 이미지 fully_preserved 앵커 + integrated_multimodal_description + overall_soundscape). " +
      "이 보존 앵커가 없으면 영상이 진행될수록 인물과 그림이 시작 이미지에서 멀어지며 뭉개지기 쉽습니다. " +
      "'integrated_multimodal_description'을 이미 포함한 프롬프트는 그대로 전달됩니다.",
    patches: [],
  },
  {
    key: "steps",
    label: "Steps",
    type: "number",
    defaultValue: 20,
    min: 4,
    max: 40,
    step: 1,
    group: "sampling",
    help: "BasicScheduler steps(node 1512:2590/2679)입니다. 원본은 20 step이며, MiniMaxH3Cache가 중간 구간을 재사용해 체감 속도를 높입니다. Turbo LoRA 사용 시 8-step은 steps 8, 4-step은 steps 4~12로 함께 낮추세요.",
    patches: [
      { nodeId: "1512:2590", input: "steps" },
      { nodeId: "1512:2679", input: "steps" },
    ],
  },
  {
    key: "sampler",
    label: "Sampler",
    type: "select",
    defaultValue: "dpmpp_2m",
    options: ["dpmpp_2m", "res_multistep", "euler", "euler_ancestral", "uni_pc"],
    group: "sampling",
    help: "KSamplerSelect(node 1512:2598)의 sampler입니다. 원본 영상은 dpmpp_2m을 사용했습니다. res_multistep은 lightx2v turbo 계열 공식 예시들이 쓰는 sampler로, Turbo LoRA와 함께 쓸 때 권장됩니다.",
    patches: [{ nodeId: "1512:2598", input: "sampler_name" }],
  },
  {
    key: "turbo_lora",
    label: "Turbo LoRA",
    type: "select",
    defaultValue: MMH3_TURBO_OFF,
    options: [MMH3_TURBO_OFF, MMH3_TURBO_8STEP, MMH3_TURBO_4STEP],
    group: "lora",
    help:
      "lightx2v turbo distill LoRA로 저스텝 고속 샘플링을 켭니다(DaSiWa 스택 node 2678). " +
      "'None'이면 원본과 완전히 동일하게 동작합니다. 8-step v1.0은 steps 8 + 강도 1.0, " +
      "4-step v0.1은 steps 4~12 + 강도 0.75 권장(참조 영상은 4-step @ 0.75, 12 steps, res_multistep 사용). " +
      "pod의 ComfyUI/models/loras에 해당 파일이 있어야 합니다(setup-minimax-h3-pod.sh가 함께 받습니다).",
    patches: [],
  },
  {
    key: "turbo_strength",
    label: "Turbo Strength",
    type: "number",
    defaultValue: 1,
    min: 0,
    max: 1.5,
    step: 0.05,
    group: "lora",
    help: "Turbo LoRA 강도(stack_data의 str)입니다. 8-step 권장 1.0, 4-step 권장 0.75. 0이면 선택돼 있어도 켜지 않습니다.",
    patches: [],
  },
  {
    key: "cache_reuse_threshold",
    label: "Cache Reuse Threshold",
    type: "number",
    defaultValue: 0.05,
    min: 0,
    max: 0.3,
    step: 0.01,
    group: "advanced",
    help: "MiniMaxH3Cache(node 1512:2722/2723)의 reuse_threshold입니다. 원본 0.05. 높이면 중간 step 재사용이 늘어 빨라지지만 디테일이 뭉개질 수 있고, 0이면 재사용을 사실상 끄므로 최고 품질(가장 느림)입니다.",
    patches: [
      { nodeId: "1512:2722", input: "reuse_threshold" },
      { nodeId: "1512:2723", input: "reuse_threshold" },
    ],
  },
  {
    key: "shift_video",
    label: "Video Sigma Shift",
    type: "number",
    defaultValue: 12,
    min: 1,
    max: 20,
    step: 0.5,
    group: "advanced",
    help: "ModelSamplingMiniMaxH3의 video shift(node 1512:2691/2692)입니다. 원본 기본값 12. 낮추면 motion이 안정적이지만 밋밋해질 수 있습니다.",
    patches: [
      { nodeId: "1512:2691", input: "shift_video" },
      { nodeId: "1512:2692", input: "shift_video" },
    ],
  },
  {
    key: "shift_audio",
    label: "Audio Sigma Shift",
    type: "number",
    defaultValue: 3,
    min: 1,
    max: 10,
    step: 0.5,
    group: "advanced",
    help: "ModelSamplingMiniMaxH3의 audio shift(node 1512:2691/2692)입니다. 원본 기본값 3.",
    patches: [
      { nodeId: "1512:2691", input: "shift_audio" },
      { nodeId: "1512:2692", input: "shift_audio" },
    ],
  },
];

const BUILTIN_VIDEO_PIPELINES: VideoPipelineDefinition[] = [
  {
    id: "dasiwa-minimax-h3-i2va",
    label: "MiniMax H3 (DaSiWa) - I2V + audio",
    description:
      "DaSiWa MythicAlchemy MiniMax H3 이미지→비디오+오디오 워크플로우(원본 영상에서 캡처한 실행 그래프 그대로). REF2VA Hybrid 체크포인트 + Qwen3-VL 32B(nvfp4) 인코더 + MysticXXX v3 LoRA(0.9, baked). Turbo LoRA 컨트롤로 lightx2v 8-step/4-step distill을 켜면 저스텝 고속 생성이 가능합니다. ComfyUI 0.30.0+ 와 ComfyUI-DaSiWa-Nodes / ComfyUI-KJNodes가 설치된 pod가 필요합니다(onechat_ltx25_h100_002 세팅 완료). 프롬프트는 MiniMax Director 형식(integrated_multimodal_description …)을 쓰면 원본과 같은 스타일로 동작하며, negative prompt는 지원하지 않습니다.",
    workflowPath: "workflows/dasiwa-minimax-h3-i2va.json",
    mode: "i2v",
    // DaSiWa_EnhancedVideoCombine muxes the audio-VAE output into the file, so
    // every clip carries generated sound; the separate sound toggle is moot.
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(dasiwaMinimaxH3I2vaControls),
    controls: dasiwaMinimaxH3I2vaControls,
    stackLoraToggles: [
      {
        selectKey: "turbo_lora",
        strengthKey: "turbo_strength",
        offValue: MMH3_TURBO_OFF,
        nodeId: "2678",
        loraByOption: MMH3_TURBO_LORAS,
      },
    ],
  },
  {
    id: "ltx25-i2v-two-stage",
    label: "LTX-2.5 - I2V (two-stage, high quality)",
    description:
      "공식 Lightricks LTX-2.5 이미지→비디오 2-stage distilled 워크플로우(bf16). 1차 생성 후 latent x2 업스케일 + 재샘플로 고해상도(예: 960×544 → ~1920×1088), 오디오까지 함께 생성됩니다. bf16 기준 80GB급 GPU 권장.",
    workflowPath: "workflows/ltx25-i2v-two-stage.json",
    mode: "i2v",
    // CreateVideo (node 5518:4849) muxes the LTXV-audio-VAE output into the file,
    // so every clip carries generated sound; the separate sound toggle is moot.
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(ltx25I2vControls),
    controls: ltx25I2vControls,
  },
  {
    id: "ltx25-t2v-two-stage",
    label: "LTX-2.5 - T2V (two-stage, high quality)",
    description:
      "공식 Lightricks LTX-2.5 텍스트→비디오 2-stage distilled 워크플로우(bf16). 시작 이미지 없이 프롬프트만으로 생성하며, 1차 생성 후 latent x2 업스케일 + 재샘플로 고해상도(예: 960×544 → ~1920×1088), 오디오까지 함께 생성됩니다. bf16 기준 80GB급 GPU 권장.",
    workflowPath: "workflows/ltx25-t2v-two-stage.json",
    mode: "t2v",
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(ltx25T2vControls),
    controls: ltx25T2vControls,
  },
  {
    id: "sulphur-ltx23-i2v-distilled-fast",
    label: "Sulphur LTX 2.3 - I2V (distilled, fast)",
    description: "RunPod Video Sulphur LTX 2.3 image-to-video distilled workflow",
    workflowPath: "workflows/sulphur_ltx23_i2v_distilled.json",
    mode: "i2v",
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(sulphurI2vDistilledControls),
    controls: sulphurI2vDistilledControls,
    loraSlots: [faceFidelitySlot("44")],
  },
  {
    id: "sulphur-ltx23-i2v-base-high-quality",
    label: "Sulphur LTX 2.3 - I2V (base, high quality)",
    description: "RunPod Video Sulphur LTX 2.3 image-to-video base workflow",
    workflowPath: "workflows/sulphur_ltx23_i2v_base.json",
    mode: "i2v",
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(sulphurI2vBaseControls),
    controls: sulphurI2vBaseControls,
    loraSlots: [faceFidelitySlot("44")],
  },
  {
    id: "sulphur-ltx23-t2v-distilled-fast",
    label: "Sulphur LTX 2.3 - T2V (distilled, fast)",
    description: "RunPod Video Sulphur LTX 2.3 text-to-video distilled workflow",
    workflowPath: "workflows/sulphur_ltx23_t2v_distilled.json",
    mode: "t2v",
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(sulphurT2vDistilledControls),
    controls: sulphurT2vDistilledControls,
    loraSlots: [faceFidelitySlot("44")],
  },
  {
    id: "sulphur-ltx23-t2v-base-high-quality",
    label: "Sulphur LTX 2.3 - T2V (base, high quality)",
    description: "RunPod Video Sulphur LTX 2.3 text-to-video base workflow",
    workflowPath: "workflows/sulphur_ltx23_t2v_base.json",
    mode: "t2v",
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(sulphurT2vBaseControls),
    controls: sulphurT2vBaseControls,
    loraSlots: [faceFidelitySlot("44")],
  },
  {
    id: "10eros-i2v-triple-pass",
    label: "10Eros - I2V (triple-pass, experimental)",
    description: "RunPod Video 10Eros image-to-video triple-pass workflow",
    workflowPath: "workflows/10Eros_10SNodes_TripleSample_I2V.json",
    mode: "i2v",
    experimental: true,
    // Renders audio through the LTXV audio VAE path and muxes it into the final
    // VHS_VideoCombine output, so the video always carries sound.
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(erosControls),
    controls: erosControls,
    loraSlots: [faceFidelitySlot("646")],
  },
  {
    id: "krea2-pornmaster-ltx23-i2v",
    label: "PornMaster-krea2 (LTX 2.3) - I2V + audio",
    description:
      "RunPod Video reconstruction of the PornMaster-krea2 LTX 2.3 image-to-video workflow (baked NSFW LoRA stack, two-pass upscale + RTX super resolution).",
    workflowPath: "workflows/krea2-pornmaster-ltx23-i2v.json",
    mode: "i2v",
    experimental: true,
    // Decodes audio through the LTXV audio VAE and muxes it into the final
    // VHS_VideoCombine output (node 597), so the video always carries sound.
    embedsAudio: true,
    canvas: NO_CANVAS_SUPPORT,
    defaults: defaultsFromControls(krea2Controls),
    controls: krea2Controls,
    loraSlots: [faceFidelitySlot("810:646")],
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
