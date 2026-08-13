"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, HelpCircle, Sparkles } from "lucide-react";
import type {
  CivitaiGenerationRecommendation,
  CivitaiMetadataReport,
  GenerationParams,
} from "@/lib/types";
import { Button } from "@/components/ui/button";

interface Props {
  report?: CivitaiMetadataReport;
  recommendations?: CivitaiGenerationRecommendation[];
  language: "ko" | "en";
  onApply: (params: Partial<GenerationParams>) => void;
}

const STATUS_STYLE = {
  confirmed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  inferred: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  missing: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  conflict: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300",
} as const;

const STATUS_LABEL = {
  confirmed: { ko: "확인됨", en: "Confirmed" },
  inferred: { ko: "추정됨", en: "Inferred" },
  missing: { ko: "누락됨", en: "Missing" },
  conflict: { ko: "불일치", en: "Conflict" },
} as const;

const GOAL_LABEL = {
  closest: { ko: "원본 근접", en: "Closest" },
  literal: { ko: "메타데이터 직역", en: "Literal" },
  stable: { ko: "안정성", en: "Stable" },
  quality: { ko: "품질 우선", en: "Quality" },
} as const;

const FIELD_COPY: Record<string, { ko: [string, string]; en: [string, string] }> = {
  prompt: { ko: ["프롬프트", "이미지에 포함할 대상, 구도, 화풍을 지정합니다. 문구와 가중치가 조금만 달라도 결과가 크게 바뀔 수 있습니다."], en: ["Prompt", "Describes subjects, composition, and style. Small wording or weight changes can substantially alter the result."] },
  negative_prompt: { ko: ["네거티브 프롬프트", "이미지에서 피할 특징을 지정합니다. 모델에 따라 효과와 문법이 달라질 수 있습니다."], en: ["Negative prompt", "Describes features to avoid. Its effect and syntax can vary between model families."] },
  model: { ko: ["체크포인트", "생성에 사용한 기본 모델입니다. 같은 이름이 아니라 동일한 파일 해시가 일치해야 원본 재현 가능성이 높습니다."], en: ["Checkpoint", "The base model used for generation. Matching the exact file hash matters more than matching only its name."] },
  seed: { ko: ["시드", "초기 노이즈를 정하는 값입니다. 백엔드, RNG 방식, 모델 또는 해상도가 달라지면 같은 시드도 다른 이미지가 됩니다."], en: ["Seed", "Selects the initial noise. The same seed differs when the backend, RNG, model, or resolution changes."] },
  steps: { ko: ["스텝", "노이즈를 제거하는 반복 횟수입니다. 너무 낮으면 미완성이고 너무 높으면 변화가 적거나 과도하게 선명해질 수 있습니다."], en: ["Steps", "The number of denoising iterations. Too few may look unfinished; excessive steps may add little or overcook details."] },
  cfg: { ko: ["CFG 스케일", "프롬프트를 따르는 강도입니다. 모델별 권장 범위가 다르며 높은 값은 색 번짐이나 과포화를 만들 수 있습니다."], en: ["CFG scale", "Controls prompt adherence. Recommended ranges vary by model; high values can cause artifacts or oversaturation."] },
  sampler: { ko: ["샘플러", "노이즈 제거 알고리즘입니다. 같은 스텝과 시드라도 샘플러가 다르면 구도와 디테일이 달라집니다."], en: ["Sampler", "The denoising algorithm. Changing it alters composition and detail even with the same seed and steps."] },
  scheduler: { ko: ["스케줄러", "각 스텝에 노이즈를 배분하는 방식입니다. 누락되면 Automatic, Normal, Karras 중 무엇을 썼는지 알 수 없습니다."], en: ["Scheduler", "Controls noise allocation across steps. If absent, it is unknown whether Automatic, Normal, Karras, or another schedule was used."] },
  clip_skip: { ko: ["CLIP Skip", "텍스트 인코더의 어느 레이어 출력을 사용할지 정합니다. 특히 애니메이션 계열 모델의 스타일과 프롬프트 해석에 영향을 줍니다."], en: ["CLIP Skip", "Selects which text-encoder layer output to use. It strongly affects prompt interpretation in many anime models."] },
  final_size: { ko: ["최종 이미지 크기", "사이트에 게시된 최종 픽셀 크기입니다. 최초 생성 크기나 Hires 전 크기와 같다는 보장은 없습니다."], en: ["Final image size", "The published pixel dimensions. They may not be the first-pass size before Hires or post-processing."] },
  base_size: { ko: ["1차 생성 크기", "확산 모델이 처음 이미지를 만든 해상도입니다. 최종 크기만 있으면 Hires 배율을 정확히 복원할 수 없습니다."], en: ["First-pass size", "The resolution used for the initial diffusion pass. A final size alone cannot reveal the exact Hires scale."] },
  hires: { ko: ["Hires/업스케일 과정", "2차 디테일 보정 여부와 배율, 스텝, 업스케일러, denoise를 포함합니다. 원본 느낌 재현에 매우 중요합니다."], en: ["Hires/upscale workflow", "Includes second-pass use, scale, steps, upscaler, and denoise. These are critical for reproducing the source look."] },
  vae: { ko: ["VAE", "latent와 실제 RGB 이미지 사이를 변환합니다. 다른 VAE를 사용하면 전체 색상, 대비, 채도가 달라지거나 이미지가 깨질 수 있습니다."], en: ["VAE", "Converts between latent data and RGB pixels. A different VAE can shift color, contrast, saturation, or corrupt the image."] },
  backend: { ko: ["생성 백엔드", "ComfyUI, A1111, Forge처럼 실제 생성에 사용한 프로그램입니다. 구현 차이 때문에 같은 설정도 결과가 다를 수 있습니다."], en: ["Generation backend", "The program used to generate, such as ComfyUI, A1111, or Forge. Implementation differences can change results."] },
  workflow: { ko: ["ComfyUI 워크플로", "사용한 노드 그래프, 노드 버전, 연결 순서입니다. Version: ComfyUI만으로는 실제 워크플로를 복원할 수 없습니다."], en: ["ComfyUI workflow", "The node graph, versions, and connections. A ComfyUI version label alone cannot reconstruct this workflow."] },
  noise: { ko: ["노이즈/RNG 구현", "초기 노이즈를 CPU 또는 GPU에서 만드는 방식과 난수 구현입니다. 같은 시드 재현 여부에 직접 영향을 줍니다."], en: ["Noise/RNG implementation", "How initial noise is produced on CPU or GPU. It directly affects whether the same seed reproduces the same result."] },
  postprocess: { ko: ["후처리/색상 보정", "ADetailer, 얼굴 보정, 업스케일, 색상 보정 등 생성 이후 적용된 작업입니다."], en: ["Post-processing/color correction", "Work applied after generation, such as ADetailer, face restoration, upscaling, or color correction."] },
};

const RECOMMENDATION_COPY: Record<string, { ko: [string, string, string?]; en: [string, string, string?] }> = {
  "closest-estimate": {
    ko: ["원본 근접 추정", "누락된 Hires 과정을 임의로 만들지 않고 안정적인 1차 해상도에서 생성합니다.", "게시된 최종 크기가 더 크다면 생성 후 별도 업스케일을 권장합니다."],
    en: ["Closest reconstruction estimate", "Uses a conservative first-pass size without inventing a denoising Hires pass.", "Upscale the clean result separately if the published final size is larger."],
  },
  "literal-metadata": {
    ko: ["메타데이터 그대로", "누락된 Hires 과정을 추정하지 않고 공개된 최종 해상도와 값을 그대로 사용합니다.", "큰 해상도를 한 번에 생성하면 색상 변화, 피사체 중복 또는 latent 붕괴가 발생할 수 있습니다."],
    en: ["Literal metadata", "Uses the published final dimensions without inventing a Hires stage.", "A large single pass can produce color shifts, duplicated subjects, or latent collapse."],
  },
  "stable-generation": {
    ko: ["안정적인 생성", "Hires 재확산을 끄고 보수적인 기본 해상도를 사용해 노이즈와 실패 가능성을 줄입니다. CLIP Skip은 원본값을 유지합니다."],
    en: ["Stable generation", "Disables denoising Hires and uses a conservative native resolution for predictable output."],
  },
  "quality-priority": {
    ko: ["품질 우선", "Illustrious에 안정적인 DPM++ 2M Karras를 사용하고 노이즈를 유발한 Hires 재확산은 끕니다. CLIP Skip은 원본값을 유지합니다.", "더 큰 결과가 필요하면 완성된 이미지를 별도로 업스케일하는 편이 안전합니다."],
    en: ["Quality priority", "Uses a strong native-resolution sampler recipe without a second denoising pass.", "Upscale the finished image separately when a larger output is required."],
  },
};

function HelpTooltip({ text, language }: { text: string; language: "ko" | "en" }) {
  return (
    <span className="group/help relative inline-flex align-middle">
      <button type="button" className="inline-flex rounded-full opacity-65 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring" aria-label={language === "ko" ? "자세한 설명" : "Detailed explanation"}>
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-72 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-relaxed text-popover-foreground shadow-lg group-hover/help:block group-focus-within/help:block">
        {text}
      </span>
    </span>
  );
}

function settingSummary(params: Partial<GenerationParams>, language: "ko" | "en") {
  const ko = language === "ko";
  const parts = [
    params.backend,
    params.width && params.height ? `${params.width}x${params.height}` : "",
    params.hires_upscale && params.hires_upscale > 1
      ? `Hires ${params.hires_upscale}x / ${params.upscale_model_name || (ko ? "기본값" : "default")}`
      : ko ? "Hires 없음" : "No Hires",
    params.hires_steps ? `Hires ${ko ? "스텝" : "steps"} ${params.hires_steps}` : "",
    params.denoise_strength !== undefined ? `Denoise ${params.denoise_strength}` : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

export function CivitaiMetadataAdvice({ report, recommendations, language, onApply }: Props) {
  if (!report) return null;
  const ko = language === "ko";
  const summary = ko
    ? report.reproducibility === "high"
      ? "생성에 중요한 정보가 대부분 포함되어 있습니다."
      : report.reproducibility === "medium"
        ? "일부 생성 과정이 누락되어 있어 원본과 정확히 일치하지 않을 수 있습니다."
        : "중요한 워크플로 정보가 누락되어 있습니다. 아래 설정은 원본값이 아니라 추천값일 수 있습니다."
    : report.summary;

  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3">
      <details className="group rounded-md border border-border bg-background/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
          <span className="inline-flex items-center gap-2">
            {report.reproducibility === "low" ? <AlertTriangle className="h-4 w-4 text-amber-500" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
            {ko ? "메타데이터 완전성" : "Metadata completeness"}
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{ko ? "재현 가능성" : "Reproducibility"}: {report.reproducibility.toUpperCase()}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          <p className="text-xs text-muted-foreground">{summary}</p>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">{ko ? "확인" : "Confirmed"} {report.confirmedCount}</span>
            <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-sky-700 dark:text-sky-300">{ko ? "추정" : "Inferred"} {report.inferredCount}</span>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300">{ko ? "누락" : "Missing"} {report.missingCount}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {report.fields.map((item) => {
              const copy = FIELD_COPY[item.key]?.[language] ?? [item.label, item.note ?? ""];
              return (
                <div key={item.key} className={`rounded-md border p-2 text-xs ${STATUS_STYLE[item.status]}`}>
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">{copy[0]}<HelpTooltip text={copy[1]} language={language} /></span>
                    <span className="text-[10px] uppercase">{STATUS_LABEL[item.status][language]}</span>
                  </div>
                  {item.value && <div className="mt-1 font-mono text-[11px]">{item.value}</div>}
                  {item.note && !ko && <p className="mt-1 opacity-80">{item.note}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </details>

      {recommendations && recommendations.length > 0 && (
        <details className="group rounded-md border border-border bg-background/60">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
            <span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />{ko ? "추천 생성 설정" : "Recommended generation settings"}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="grid gap-2 border-t border-border p-3 lg:grid-cols-2">
            {recommendations.map((recommendation, index) => {
              const copy = RECOMMENDATION_COPY[recommendation.id]?.[language];
              const title = copy?.[0] ?? recommendation.title;
              const description = copy?.[1] ?? recommendation.description;
              const caution = copy?.[2] ?? recommendation.caution;
              return (
                <article key={recommendation.id} className="rounded-md border border-border bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-medium"><span className="text-xs text-muted-foreground">#{index + 1}</span>{title}</div>
                      <span className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{GOAL_LABEL[recommendation.goal][language]}</span>
                    </div>
                    <Button type="button" size="sm" variant="outline" onClick={() => onApply(recommendation.params)}>{ko ? "적용" : "Apply"}</Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{description}</p>
                  <p className="mt-2 break-words font-mono text-[11px] text-foreground/80">{settingSummary(recommendation.params, language)}</p>
                  {caution && <p className="mt-2 flex gap-1.5 text-[11px] text-amber-600 dark:text-amber-400"><CircleHelp className="mt-0.5 h-3 w-3 shrink-0" />{caution}</p>}
                </article>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
