// SeeDance 2.5 (BytePlus ModelArk) shared types + helpers.
//
// The SeeDance generation screen talks to BytePlus ModelArk directly with the
// `SEEDANCE_API_KEY` (an `ark-…` key) read server-side from the environment.
// ModelArk's video API is text-command driven: the generation parameters
// (ratio / resolution / duration / seed / camera lock / watermark) are appended
// to the prompt text as `--flag value` tokens rather than sent as JSON fields.
// See `buildSeedancePromptText` below. Reference images are attached as extra
// entries in the request `content` array with a `role` (first_frame /
// last_frame / reference_image).
//
// Endpoint + model id are overridable via env so the same screen keeps working
// if BytePlus renames the model or the account lives in another region:
//   SEEDANCE_BASE_URL  (default https://ark.ap-southeast.bytepluses.com/api/v3)
//   SEEDANCE_MODEL     (default seedance-2.5)

export type SeedanceMode = "i2v" | "t2v";

export type SeedanceResolution = "480p" | "720p" | "1080p";

export type SeedanceRatio =
  | "adaptive"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16"
  | "21:9";

export interface SeedanceParams {
  mode: SeedanceMode;
  prompt: string;
  resolution: SeedanceResolution;
  ratio: SeedanceRatio;
  duration: number; // seconds, 4..30
  cameraFixed: boolean;
  watermark: boolean;
  cleanFrame: boolean; // append a "no on-screen text/subtitles/logo" clause
  seed: number | null;
  // Data URIs (data:image/...;base64,...) or public https URLs.
  firstFrame: string | null;
  lastFrame: string | null;
  references: string[]; // extra identity-reference images (role: reference_image)
}

export const SEEDANCE_DURATION_MIN = 4;
export const SEEDANCE_DURATION_MAX = 30;
export const SEEDANCE_MAX_REFERENCES = 4;

export const SEEDANCE_RESOLUTIONS: SeedanceResolution[] = ["480p", "720p", "1080p"];

export const SEEDANCE_RATIOS: SeedanceRatio[] = [
  "adaptive",
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
  "21:9",
];

export const DEFAULT_SEEDANCE_PARAMS: SeedanceParams = {
  mode: "i2v",
  prompt: "",
  resolution: "720p",
  ratio: "adaptive",
  duration: 5,
  cameraFixed: false,
  watermark: false,
  cleanFrame: true,
  seed: null,
  firstFrame: null,
  lastFrame: null,
  references: [],
};

export function clampSeedanceDuration(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_SEEDANCE_PARAMS.duration;
  return Math.min(Math.max(n, SEEDANCE_DURATION_MIN), SEEDANCE_DURATION_MAX);
}

// Clause appended when `cleanFrame` is on, so the model avoids burning captions,
// subtitles, logos or watermarks into the frame.
const CLEAN_FRAME_CLAUSE = "禁止：任何文字、字幕、LOGO或水印";

/**
 * Build the ModelArk prompt text: the user's description followed by the
 * `--flag value` command tokens ModelArk parses for generation control.
 * `adaptive` ratio is omitted so the model derives the aspect from the first
 * frame image (its intended meaning); an explicit ratio is always sent.
 */
export function buildSeedancePromptText(params: SeedanceParams): string {
  const segments: string[] = [];
  const base = params.prompt.trim();
  if (base) segments.push(base);
  if (params.cleanFrame) segments.push(CLEAN_FRAME_CLAUSE);

  const flags: string[] = [];
  flags.push(`--resolution ${params.resolution}`);
  if (params.ratio !== "adaptive") {
    flags.push(`--ratio ${params.ratio}`);
  } else if (params.mode === "t2v") {
    // Text-to-video has no source frame to adapt to; fall back to 16:9.
    flags.push("--ratio 16:9");
  } else {
    flags.push("--ratio adaptive");
  }
  flags.push(`--duration ${clampSeedanceDuration(params.duration)}`);
  if (params.cameraFixed) flags.push("--camerafixed true");
  flags.push(`--watermark ${params.watermark ? "true" : "false"}`);
  if (params.seed != null && Number.isFinite(params.seed)) {
    flags.push(`--seed ${Math.trunc(params.seed)}`);
  }

  return [segments.join("。 "), flags.join(" ")].filter(Boolean).join(" ");
}

export interface SeedanceContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
  role?: "first_frame" | "last_frame" | "reference_image";
}

/**
 * Assemble the ModelArk `content` array from resolved params. Image parts are
 * only added in i2v mode; t2v sends the text part alone.
 */
export function buildSeedanceContent(params: SeedanceParams): SeedanceContentPart[] {
  const content: SeedanceContentPart[] = [
    { type: "text", text: buildSeedancePromptText(params) },
  ];

  if (params.mode === "i2v") {
    if (params.firstFrame) {
      content.push({
        type: "image_url",
        image_url: { url: params.firstFrame },
        role: "first_frame",
      });
    }
    if (params.lastFrame) {
      content.push({
        type: "image_url",
        image_url: { url: params.lastFrame },
        role: "last_frame",
      });
    }
    for (const ref of params.references) {
      if (!ref) continue;
      content.push({
        type: "image_url",
        image_url: { url: ref },
        role: "reference_image",
      });
    }
  }

  return content;
}

export interface SeedanceVideo {
  id: string;
  url: string;
  filename: string;
  timestamp: number;
  contentType: string;
  prompt: string;
  params: Omit<SeedanceParams, "firstFrame" | "lastFrame" | "references"> & {
    hasFirstFrame: boolean;
    hasLastFrame: boolean;
    referenceCount: number;
  };
  thumbnail?: string | null;
  // Client-only, present while queued / generating / errored.
  status?: SeedanceGenerationStatus;
}

export interface SeedanceGenerationStatus {
  state: "queued" | "generating" | "completed" | "canceled" | "error";
  progress: number; // 0..1
  message: string;
}

// UX helpers — camera-language and mood chips drawn from the SeeDance prompt
// methodology, so a user can compose a "person doing X" shot without knowing
// the vocabulary. Each chip inserts a short phrase into the prompt.
export interface SeedancePromptChip {
  label: { ko: string; en: string };
  insert: string;
}

export interface SeedancePromptChipGroup {
  title: { ko: string; en: string };
  chips: SeedancePromptChip[];
}

export const SEEDANCE_PROMPT_CHIPS: SeedancePromptChipGroup[] = [
  {
    title: { ko: "카메라 무빙", en: "Camera" },
    chips: [
      { label: { ko: "천천히 다가감", en: "Slow push-in" }, insert: "镜头缓缓推近" },
      { label: { ko: "천천히 물러남", en: "Slow pull-out" }, insert: "镜头缓缓拉远" },
      { label: { ko: "인물 따라가기", en: "Follow subject" }, insert: "镜头跟随人物移动" },
      { label: { ko: "360도 회전", en: "Orbit" }, insert: "环绕人物360度拍摄" },
      { label: { ko: "핸드헬드", en: "Handheld" }, insert: "手持跟拍，轻微晃动" },
      { label: { ko: "고정 샷", en: "Locked shot" }, insert: "固定机位，稳定构图" },
    ],
  },
  {
    title: { ko: "샷 크기", en: "Shot size" },
    chips: [
      { label: { ko: "클로즈업", en: "Close-up" }, insert: "面部特写" },
      { label: { ko: "상반신", en: "Medium" }, insert: "半身中景" },
      { label: { ko: "전신", en: "Full body" }, insert: "全身全景" },
      { label: { ko: "와이드", en: "Wide" }, insert: "远景环境镜头" },
    ],
  },
  {
    title: { ko: "분위기·조명", en: "Mood & light" },
    chips: [
      { label: { ko: "영화적", en: "Cinematic" }, insert: "电影感，高质感画面" },
      { label: { ko: "골든아워", en: "Golden hour" }, insert: "黄金时段暖色光线" },
      { label: { ko: "네온", en: "Neon" }, insert: "赛博朋克霓虹灯光" },
      { label: { ko: "부드러운 빛", en: "Soft light" }, insert: "柔和自然光，浅景深" },
      { label: { ko: "역광", en: "Backlight" }, insert: "侧逆光，丁达尔效应" },
      { label: { ko: "슬로우모션", en: "Slow motion" }, insert: "升格慢动作" },
    ],
  },
];
