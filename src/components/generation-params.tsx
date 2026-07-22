"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  getHiresPreset,
  getModelConfig,
  IMAGE_SIZE_CONSTRAINTS,
  normalizeImageDimension,
} from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FieldHelp } from "@/components/field-help";
import {
  AssetChoiceButton,
  AssetPickerDialog,
  type LocalModelAsset,
} from "@/components/model-selector";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SAMPLER_PRESETS = [
  { label: "Euler a", sampler: "euler_ancestral", scheduler: "normal" },
  { label: "Euler", sampler: "euler", scheduler: "normal" },
  { label: "Heun", sampler: "heun", scheduler: "normal" },
  { label: "LMS", sampler: "lms", scheduler: "normal" },
  { label: "DDIM", sampler: "ddim", scheduler: "normal" },
  { label: "DPM++ 2M Karras", sampler: "dpmpp_2m", scheduler: "karras" },
  { label: "DPM++ SDE Karras", sampler: "dpmpp_sde", scheduler: "karras" },
  { label: "DPM++ 2M SDE Karras", sampler: "dpmpp_2m_sde", scheduler: "karras" },
  { label: "UniPC", sampler: "uni_pc", scheduler: "normal" },
] as const;
const ASPECT_PRESETS = [
  { id: "free", label: "Free", labelKo: "자유", width: null, height: null },
  { id: "square", label: "Square", labelKo: "정사각", width: 1024, height: 1024 },
  { id: "3:2", label: "3:2", labelKo: "3:2", width: 1152, height: 768 },
  { id: "2:3", label: "2:3", labelKo: "2:3", width: 768, height: 1152 },
] as const;

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

function getAspectRatioLabel(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height);

  return `${width / divisor}:${height / divisor}`;
}

function parseSeedInput(value: string) {
  if (!value.trim()) return null;

  const seed = Number(value);

  return Number.isFinite(seed) ? Math.floor(seed) : null;
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function GenerationParams({ section = "output" }: {
  section?: "output" | "advanced" | "upscaler" | "adetailer";
}) {
  const { params, setParams, language } = useStore();
  const ko = language === "ko";
  const currentModel = getModelConfig(params.model);
  const isLocal = currentModel.provider === "comfyui";
  const isWebUi = params.backend === "a1111" || params.backend === "forge";
  const [draftSize, setDraftSize] = useState<
    Partial<Record<"width" | "height", string>>
  >({});
  const [aspectMode, setAspectMode] = useState<(typeof ASPECT_PRESETS)[number]["id"]>(
    () => {
      if (params.width === params.height) return "square";
      if (params.width * 2 === params.height * 3) return "3:2";
      if (params.width * 3 === params.height * 2) return "2:3";
      return "free";
    }
  );
  const [draftHiresScale, setDraftHiresScale] = useState<string | null>(null);
  const [adetailerPickerOpen, setAdetailerPickerOpen] = useState(false);
  const [adetailerLoraPickerIndex, setAdetailerLoraPickerIndex] = useState<number | null>(null);
  const [localModels, setLocalModels] = useState<{
    vaes: string[];
    checkpointModels: LocalModelAsset[];
    loraModels: LocalModelAsset[];
    upscaleModels: string[];
    controlnets: string[];
  }>({ vaes: [], checkpointModels: [], loraModels: [], upscaleModels: [], controlnets: [] });
  const [webuiOptions, setWebuiOptions] = useState<{
    upscalers: string[];
    adetailerModels: string[];
  }>({ upscalers: [], adetailerModels: [] });

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) =>
        setLocalModels({
          vaes: data.vaes ?? [],
          checkpointModels: data.checkpointAssets ?? [],
          loraModels: data.loraAssets ?? [],
          upscaleModels: data.upscale_models ?? [],
          controlnets: data.controlnets ?? [],
        })
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isWebUi) return;

    let active = true;
    fetch(`/api/webui/options?backend=${params.backend}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        setWebuiOptions({
          upscalers: data.upscalers ?? [],
          adetailerModels: data.adetailerModels ?? [],
        });
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isWebUi, params.backend]);

  useEffect(() => {
    if (!params.vae_name || localModels.vaes.length === 0) return;
    if (localModels.vaes.includes(params.vae_name)) return;

    setParams({ vae_name: "" });
  }, [localModels.vaes, params.vae_name, setParams]);

  // Auto-apply the model-family hires preset when the checkpoint changes.
  // Skip the first render so restored/imported hires values are preserved.
  const presetModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (presetModelRef.current === null) {
      presetModelRef.current = params.model_name;
      return;
    }
    if (presetModelRef.current === params.model_name) return;

    presetModelRef.current = params.model_name;
    const preset = getHiresPreset(params.model_name);
    setParams({ hires_steps: preset.steps, hires_denoise: preset.denoise });
  }, [params.model_name, setParams]);

  const controlnets = params.controlnets ?? [];
  const hiresEnabled = params.hires_upscale > 1;
  const hiresPreset = getHiresPreset(params.model_name);
  const selectedSamplerValue = `${params.sampler_name}:${params.scheduler}`;
  const selectedPreset = ASPECT_PRESETS.find((size) => size.id === aspectMode)!;
  const adetailerModels = isWebUi
    ? webuiOptions.adetailerModels
    : ["bbox/face_yolov8n_v2.pt", "bbox/face_yolov8m.pt"];
  const aspectRatioLabel = getAspectRatioLabel(params.width, params.height);
  const adetailerCheckpointAsset = localModels.checkpointModels.find(
    (model) => model.path === (params.adetailer_checkpoint || params.model_name)
  );
  const sizeInput = {
    width: draftSize.width ?? String(params.width),
    height: draftSize.height ?? String(params.height),
  };

  const getAspectSize = (dimension: "width" | "height", value: number) => {
    const ratio =
      aspectMode === "square"
        ? ([1, 1] as const)
        : aspectMode === "3:2"
          ? ([3, 2] as const)
          : aspectMode === "2:3"
            ? ([2, 3] as const)
            : null;

    if (!ratio) return { [dimension]: normalizeImageDimension(value) };

    const [widthRatio, heightRatio] = ratio;
    const dimensionRatio = dimension === "width" ? widthRatio : heightRatio;
    const unitStep = IMAGE_SIZE_CONSTRAINTS.step;
    const minUnits = Math.ceil(
      Math.max(
        IMAGE_SIZE_CONSTRAINTS.min / (widthRatio * unitStep),
        IMAGE_SIZE_CONSTRAINTS.min / (heightRatio * unitStep)
      )
    );
    const maxUnits = Math.floor(
      Math.min(
        IMAGE_SIZE_CONSTRAINTS.max / (widthRatio * unitStep),
        IMAGE_SIZE_CONSTRAINTS.max / (heightRatio * unitStep)
      )
    );
    const units = clampNumber(
      Math.round(value / (dimensionRatio * unitStep)),
      minUnits,
      maxUnits
    );

    return {
      width: units * widthRatio * unitStep,
      height: units * heightRatio * unitStep,
    };
  };

  const updateImageSize = (dimension: "width" | "height", value: string) => {
    setDraftSize((current) => ({ ...current, [dimension]: value }));
    if (!value.trim()) return;

    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) setParams(getAspectSize(dimension, numericValue));
  };

  const commitImageSize = (dimension: "width" | "height") => {
    const size = getAspectSize(dimension, Number(sizeInput[dimension]));
    setDraftSize({});
    setParams(size);
  };

  const updateImageSizeFromSlider = (
    dimension: "width" | "height",
    value: number | readonly number[]
  ) => {
    const numericValue = typeof value === "number" ? value : value[0];
    setDraftSize({});
    setParams(getAspectSize(dimension, numericValue));
  };

  const commitHiresScale = () => {
    if (draftHiresScale === null) return;

    const numericValue = Number(draftHiresScale);
    setDraftHiresScale(null);
    if (!Number.isFinite(numericValue)) return;

    setParams({
      hires_upscale: Math.round(clampNumber(numericValue, 1, 4) * 100) / 100,
    });
  };
  const addControlNet = () => {
    if (controlnets.length >= 4) return;
    setParams({
      controlnets: [
        ...controlnets,
        {
          model: localModels.controlnets[0] ?? "",
          image: null,
          strength: 0.8,
          start_percent: 0,
          end_percent: 1,
        },
      ],
    });
  };

  const updateControlNet = (
    index: number,
    update: Partial<(typeof controlnets)[number]>
  ) => {
    setParams({
      controlnets: controlnets.map((controlnet, i) =>
        i === index ? { ...controlnet, ...update } : controlnet
      ),
    });
  };

  const removeControlNet = (index: number) => {
    setParams({ controlnets: controlnets.filter((_, i) => i !== index) });
  };

  return (
    <>
      {section === "output" && (<>
      <div>
        <FieldHelp className="mb-2" label={ko ? "생성 백엔드" : "Generation backend"} help={ko ? "이미지 생성을 실행할 로컬 엔진을 선택합니다." : "Choose the local engine that runs image generation."} />
        <select
          value={params.backend}
          onChange={(e) =>
            setParams({ backend: e.target.value as "comfyui" | "a1111" | "forge" })
          }
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="comfyui">ComfyUI (Krea / Wan / workflows)</option>
          <option value="a1111">AUTOMATIC1111 v1.10.0 (Civitai SD 1.5 / SDXL)</option>
          <option value="forge">ForgeUI (Forge / Illustrious compatibility)</option>
        </select>
        {isWebUi && params.generation_mode === "pose_reference" && (
          <p className="mt-2 text-xs text-amber-600">
            Pose Reference requires the ComfyUI backend.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <FieldHelp label={ko ? "최종 크기" : "Final size"} help={ko ? "결과 이미지의 가로·세로 크기와 화면 비율을 설정합니다." : "Set the final width, height, and aspect ratio."} />
            <span className="text-xs font-mono text-muted-foreground">
              {selectedPreset ? (ko ? selectedPreset.labelKo : selectedPreset.label) : (ko ? "자유" : "Free")} · {aspectRatioLabel}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {ASPECT_PRESETS.map((size) => (
              <button
                key={ko ? size.labelKo : size.label}
                type="button"
                onClick={() => {
                  setDraftSize({});
                  setAspectMode(size.id);
                  if (size.width && size.height) setParams({ width: size.width, height: size.height });
                }}
                className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                  size.id === aspectMode
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-card/70 text-foreground hover:border-primary/40 hover:bg-secondary/70"
                }`}
              >
                {ko ? size.labelKo : size.label}
              </button>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2">
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">
                W
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                min={IMAGE_SIZE_CONSTRAINTS.min}
                max={IMAGE_SIZE_CONSTRAINTS.max}
                step={IMAGE_SIZE_CONSTRAINTS.step}
                value={sizeInput.width}
                onChange={(e) => updateImageSize("width", e.target.value)}
                onBlur={() => commitImageSize("width")}
                className="h-8 text-sm"
              />
              <Slider className="mt-2" value={[params.width]} onValueChange={(value) => updateImageSizeFromSlider("width", value)} min={IMAGE_SIZE_CONSTRAINTS.min} max={IMAGE_SIZE_CONSTRAINTS.max} step={IMAGE_SIZE_CONSTRAINTS.step} />
            </div>
            <span className="pb-2 text-xs text-muted-foreground">×</span>
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">
                H
              </Label>
              <Input
                type="number"
                inputMode="numeric"
                min={IMAGE_SIZE_CONSTRAINTS.min}
                max={IMAGE_SIZE_CONSTRAINTS.max}
                step={IMAGE_SIZE_CONSTRAINTS.step}
                value={sizeInput.height}
                onChange={(e) => updateImageSize("height", e.target.value)}
                onBlur={() => commitImageSize("height")}
                className="h-8 text-sm"
              />
              <Slider className="mt-2" value={[params.height]} onValueChange={(value) => updateImageSizeFromSlider("height", value)} min={IMAGE_SIZE_CONSTRAINTS.min} max={IMAGE_SIZE_CONSTRAINTS.max} step={IMAGE_SIZE_CONSTRAINTS.step} />
            </div>
          </div>
        </div>

        <div>
          <FieldHelp className="mb-2" label={ko ? "이미지 수" : "Images"} help={ko ? "한 번에 생성할 이미지 매수를 선택합니다." : "Choose how many images to generate per request."} />
          <div className="grid grid-cols-4 gap-1.5">
            {[1, 2, 3, 4].map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setParams({ num_images: count })}
                className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                  params.num_images === count
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-card/70 text-foreground hover:border-primary/40 hover:bg-secondary/70"
                }`}
              >
                {count}
              </button>
            ))}
          </div>
        </div>
      </div>

      </>)}

      {section === "advanced" && (
      <details
        open
        className="contents"
      >
        <summary className="hidden">
          <span>Advanced</span>
          <span className="text-muted-foreground transition-transform group-open:rotate-180">
            ⌃
          </span>
        </summary>

        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="flex justify-between items-center mb-2">
                <FieldHelp label="CFG Scale" help={ko ? "프롬프트를 따르는 강도입니다. 너무 높으면 결과가 부자연스러울 수 있습니다." : "Controls prompt adherence; very high values can look unnatural."} />
                <Input
                  type="number"
                  min={1}
                  max={20}
                  step={0.1}
                  value={params.guidance_scale}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (!Number.isFinite(value)) return;
                    setParams({
                      guidance_scale: roundToTenth(clampNumber(value, 1, 20)),
                    });
                  }}
                  className="h-7 w-20 px-2 text-right text-xs font-mono"
                />
              </div>
              <Slider
                value={[params.guidance_scale]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setParams({ guidance_scale: roundToTenth(val) });
                }}
                min={1}
                max={20}
                step={0.1}
              />
            </div>

            <div>
              <FieldHelp className="mb-2" label={ko ? "샘플러" : "Sampler"} help={ko ? "노이즈를 이미지로 변환하는 샘플링 알고리즘을 선택합니다." : "Choose the sampling algorithm that turns noise into an image."} />
              <select
                value={selectedSamplerValue}
                onChange={(e) => {
                  const [sampler_name, scheduler] = e.target.value.split(":");
                  setParams({ sampler_name, scheduler });
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {SAMPLER_PRESETS.map((preset) => (
                  <option
                    key={`${preset.sampler}:${preset.scheduler}`}
                    value={`${preset.sampler}:${preset.scheduler}`}
                  >
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="flex justify-between items-center mb-2">
                <FieldHelp label={ko ? "스텝" : "Steps"} help={ko ? "이미지를 정제하는 반복 횟수입니다. 높을수록 생성 시간이 늘어납니다." : "Number of refinement iterations; more steps take longer."} />
                <Input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={params.num_inference_steps}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (!Number.isFinite(value)) return;
                    setParams({
                      num_inference_steps: Math.round(
                        clampNumber(value, 1, 100)
                      ),
                    });
                  }}
                  className="h-7 w-20 px-2 text-right text-xs font-mono"
                />
              </div>
              <Slider
                value={[params.num_inference_steps]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setParams({ num_inference_steps: Math.round(val) });
                }}
                min={1}
                max={100}
                step={1}
              />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <FieldHelp className="mb-2" label={ko ? "시드" : "Seed"} help={ko ? "같은 결과를 재현하기 위한 난수 값입니다. 비워두면 무작위로 생성합니다." : "Random value used to reproduce a result; leave empty for a random seed."} />
              <Input
                type="number"
                min={-1}
                step={1}
                placeholder="Random / -1"
                value={params.seed ?? ""}
                onChange={(e) =>
                  setParams({
                    seed: parseSeedInput(e.target.value),
                  })
                }
                className="h-8 text-sm"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <FieldHelp label="CLIP Skip" help={ko ? "프롬프트 해석에 사용할 CLIP 레이어 깊이를 조정합니다." : "Adjusts the CLIP layer depth used to interpret the prompt."} />
                <Input
                  type="number"
                  min={1}
                  max={12}
                  step={0.1}
                  value={params.clip_skip}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    if (!Number.isFinite(value)) return;
                    setParams({
                      clip_skip: roundToTenth(clampNumber(value, 1, 12)),
                    });
                  }}
                  className="h-7 w-20 px-2 text-right text-xs font-mono"
                  disabled={!isLocal}
                />
              </div>
              <Slider
                value={[params.clip_skip]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setParams({ clip_skip: roundToTenth(val) });
                }}
                min={1}
                max={12}
                step={0.1}
                disabled={!isLocal}
              />
            </div>

            <div>
              <FieldHelp className="mb-2" label="VAE" help={ko ? "잠재 이미지를 최종 색상과 픽셀로 변환하는 모델을 선택합니다." : "Choose the model that decodes latents into final colors and pixels."} />
              {isLocal && localModels.vaes.length > 0 ? (
                <select
                  value={params.vae_name}
                  onChange={(e) => setParams({ vae_name: e.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">Automatic</option>
                  {localModels.vaes.map((vae) => (
                    <option key={vae} value={vae}>
                      {vae}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  placeholder={isLocal ? "vae file name" : "Local ComfyUI only"}
                  value={params.vae_name}
                  onChange={(e) => setParams({ vae_name: e.target.value })}
                  className="h-8 text-xs"
                  disabled={!isLocal}
                />
              )}
            </div>

          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex items-center justify-between py-1">
              <FieldHelp label={ko ? "프롬프트 가중치" : "Prompt Weighting"} help={ko ? "괄호와 숫자로 특정 단어나 구문의 영향력을 높이거나 낮춥니다." : "Use parentheses and numeric weights to adjust the influence of prompt terms."} />
              <span className="text-xs text-muted-foreground">
                ComfyUI prompt syntax
              </span>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <FieldHelp label="ControlNet" help={ko ? "참조 이미지의 포즈, 윤곽선, 깊이 같은 구조 정보를 생성에 추가합니다. 최대 4개를 조합할 수 있습니다." : "Adds pose, edge, or depth guidance from reference images; up to four can be combined."} />
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {controlnets.length}/4
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  로컬 ComfyUI workflow에 ControlNet conditioning을 연결합니다.
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={addControlNet}
                disabled={!isLocal || controlnets.length >= 4}
              >
                + Add
              </Button>
            </div>

            <div className="space-y-2">
              {controlnets.length === 0 && (
                <button
                  type="button"
                  onClick={addControlNet}
                  disabled={!isLocal}
                  className="w-full rounded-md border border-dashed border-border bg-background/60 px-3 py-5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Add ControlNet
                </button>
              )}

              {controlnets.map((controlnet, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border bg-background/60 p-2">
                  <div className="flex gap-2">
                    {localModels.controlnets.length > 0 ? (
                      <select
                        value={controlnet.model}
                        onChange={(e) =>
                          updateControlNet(i, { model: e.target.value })
                        }
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">Select ControlNet...</option>
                        {localModels.controlnets.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        placeholder="controlnet model file"
                        value={controlnet.model}
                        onChange={(e) =>
                          updateControlNet(i, { model: e.target.value })
                        }
                        className="h-8 min-w-0 flex-1 text-xs"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() => removeControlNet(i)}
                    >
                      ×
                    </Button>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem]">
                    <Input
                      placeholder="reference image URL or local filename"
                      value={controlnet.image ?? ""}
                      onChange={(e) =>
                        updateControlNet(i, { image: e.target.value || null })
                      }
                      className="h-8 text-xs"
                    />
                    <Input
                      type="number"
                      value={controlnet.strength}
                      onChange={(e) =>
                        updateControlNet(i, {
                          strength: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-8 text-xs"
                      min={0}
                      max={2}
                      step={0.1}
                    />
                    <Input
                      type="number"
                      value={controlnet.start_percent}
                      onChange={(e) =>
                        updateControlNet(i, {
                          start_percent: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-8 text-xs"
                      min={0}
                      max={1}
                      step={0.05}
                    />
                    <Input
                      type="number"
                      value={controlnet.end_percent}
                      onChange={(e) =>
                        updateControlNet(i, {
                          end_percent: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-8 text-xs"
                      min={0}
                      max={1}
                      step={0.05}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>
      )}

      {section === "upscaler" && (
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold">
                  {ko ? "업스케일러 · Hires fix" : "Upscaler · Hires fix"}
                </span>
                <TooltipProvider delay={120}>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          tabIndex={0}
                          aria-label={ko ? "업스케일러 도움말" : "Upscaler help"}
                          className="inline-flex cursor-help items-center text-muted-foreground transition-colors hover:text-foreground"
                        />
                      }
                    >
                      <HelpCircle width={14} height={14} />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[340px]">
                      <div className="space-y-1.5 py-0.5 text-left leading-snug">
                        <p className="font-semibold">
                          {ko
                            ? "2단계 업스케일 (Hires fix)"
                            : "Two-pass upscale (Hires fix)"}
                        </p>
                        <p className="opacity-90">
                          {ko
                            ? "낮은 해상도로 먼저 생성한 뒤 고해상도로 다시 그려 디테일을 살리는 2단계 방식입니다."
                            : "Generate at a lower resolution first, then re-render larger to add detail."}
                        </p>
                        <ul className="space-y-1 opacity-90">
                          <li>
                            <span className="font-medium">Upscaler</span>
                            {ko
                              ? " — 1차 확대에 쓸 모델. 4x-UltraSharp 같은 ESRGAN 계열은 선명하고 latent 방식은 부드럽습니다."
                              : " — model for the first enlargement. ESRGAN types (e.g. 4x-UltraSharp) are sharp; latent is softer."}
                          </li>
                          <li>
                            <span className="font-medium">Scale</span>
                            {ko
                              ? " — 최종 배율. 1이면 refine을 끕니다. 보통 1.5~2×."
                              : " — final multiplier. 1 disables the refine. Usually 1.5–2×."}
                          </li>
                          <li>
                            <span className="font-medium">Steps</span>
                            {ko
                              ? " — 2차 패스 샘플링 스텝. 보통 base의 절반(10~15)."
                              : " — sampling steps for the second pass. Usually half of base (10–15)."}
                          </li>
                          <li>
                            <span className="font-medium">Denoise</span>
                            {ko
                              ? " — 2차 패스에서 원본을 얼마나 다시 그릴지. 낮으면(0.3~0.4) 원본 유지, 높으면(0.5+) 디테일은 늘지만 형태가 바뀝니다."
                              : " — how much the second pass repaints. Low (0.3–0.4) keeps the original; high (0.5+) adds detail but drifts."}
                          </li>
                        </ul>
                        <p className="opacity-90">
                          {ko
                            ? "적정 denoise는 업스케일러 종류와 모델 계열에 따라 다릅니다. 체크포인트를 바꾸면 계열별 추천값이 자동 적용됩니다."
                            : "The ideal denoise depends on the upscaler type and model family. Switching checkpoints auto-applies the family preset."}
                        </p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <span className="text-xs font-mono text-muted-foreground">
                {params.hires_upscale}?
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {ko
                ? "모델 업스케일 후 저 denoise로 디테일을 보강하는 2단계 refine입니다."
                : "A two-pass refine: model upscale, then low-denoise detail enhancement."}
            </p>

            {hiresEnabled && (
            <div className="mt-3 space-y-3">
              <div>
                <FieldHelp className="mb-2" label={ko ? "업스케일 모델" : "Upscaler"} help={ko ? "1차 이미지를 확대할 모델입니다. ESRGAN은 선명하고 latent 방식은 부드러운 결과를 만듭니다." : "Model used for enlargement; ESRGAN is sharper while latent methods are softer."} />
                {isWebUi ? (
                  webuiOptions.upscalers.length > 0 ? (
                    <select
                      value={params.upscale_model_name}
                      onChange={(e) =>
                        setParams({ upscale_model_name: e.target.value })
                      }
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <option value="">Off</option>
                      {webuiOptions.upscalers.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      placeholder="e.g. 4x-UltraSharp (start the WebUI to list)"
                      value={params.upscale_model_name}
                      onChange={(e) =>
                        setParams({ upscale_model_name: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  )
                ) : isLocal && localModels.upscaleModels.length > 0 ? (
                  <select
                    value={params.upscale_model_name}
                    onChange={(e) =>
                      setParams({ upscale_model_name: e.target.value })
                    }
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <option value="">Off</option>
                    {localModels.upscaleModels.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    placeholder={
                      isLocal ? "upscale model file" : "Local ComfyUI only"
                    }
                    value={params.upscale_model_name}
                    onChange={(e) =>
                      setParams({ upscale_model_name: e.target.value })
                    }
                    className="h-8 text-xs"
                    disabled={!isLocal}
                  />
                )}
              </div>

              {hiresEnabled && (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <FieldHelp className="mb-2" label={ko ? "확대 배율" : "Scale"} help={ko ? "최종 이미지의 확대 배율입니다. 높을수록 메모리와 처리 시간이 증가합니다." : "Final enlargement ratio; higher values use more memory and time."} />
                      <Input
                        type="number"
                        min={1}
                        max={4}
                        step={0.05}
                        value={draftHiresScale ?? String(params.hires_upscale)}
                        onChange={(e) => setDraftHiresScale(e.target.value)}
                        onBlur={commitHiresScale}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                          if (e.key === "Escape") setDraftHiresScale(null);
                        }}
                        className="h-8 text-xs"
                      />
                    </div>

                    <div>
                      <FieldHelp className="mb-2" label={ko ? "2차 스텝" : "Steps"} help={ko ? "확대 후 디테일을 다시 그리는 반복 횟수입니다. 보통 기본 스텝의 절반 정도가 적당합니다." : "Iterations used after upscaling; about half the base steps is usually enough."} />
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={params.hires_steps}
                        onChange={(e) =>
                          setParams({
                            hires_steps: Math.max(
                              0,
                              Math.round(Number(e.target.value) || 0)
                            ),
                          })
                        }
                        className="h-8 text-xs"
                      />
                    </div>

                    <div>
                      <FieldHelp className="mb-2" label={ko ? "2차 변형 강도" : "Denoise"} help={ko ? "업스케일 단계에서 원본을 얼마나 다시 그릴지 정합니다. 높으면 디테일이 늘지만 구도가 달라질 수 있습니다." : "Controls redraw strength during upscaling; higher values add detail but may drift."} />
                      <Input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={params.hires_denoise}
                        onChange={(e) =>
                          setParams({
                            hires_denoise: clampNumber(
                              Number(e.target.value) || 0,
                              0,
                              1
                            ),
                          })
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
                    <span className="text-[11px] text-muted-foreground">
                      {ko
                        ? `추천 (${hiresPreset.familyLabel}) · steps ${hiresPreset.steps} · denoise ${hiresPreset.denoise}`
                        : `Recommended (${hiresPreset.familyLabel}) · steps ${hiresPreset.steps} · denoise ${hiresPreset.denoise}`}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() =>
                        setParams({
                          hires_steps: hiresPreset.steps,
                          hires_denoise: hiresPreset.denoise,
                        })
                      }
                    >
                      {ko ? "적용" : "Apply"}
                    </Button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>

      )}

      {section === "adetailer" && (<>
          {(isWebUi || isLocal) && (
            <div>

              {params.adetailer_enabled && (
                <div className="mt-3 space-y-3">
                  <div>
                    <FieldHelp className="mb-2" label={ko ? "얼굴 생성 모델" : "Face generation model"} help={ko ? "감지된 얼굴을 다시 그릴 체크포인트입니다. 비워두면 메인 모델을 사용합니다." : "Checkpoint used to redraw detected faces; leave blank to use the main model."} />
                    {isLocal ? (
                      <div className="space-y-2">
                        <AssetChoiceButton
                          asset={adetailerCheckpointAsset}
                          placeholder={ko ? "얼굴 생성 모델 선택" : "Select face generation model"}
                          onClick={() => setAdetailerPickerOpen(true)}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {params.adetailer_checkpoint
                              ? (ko ? "별도 체크포인트 사용" : "Using a separate checkpoint")
                              : (ko ? "메인 생성 모델 사용 중" : "Using main generation model")}
                          </span>
                          {params.adetailer_checkpoint && (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => setParams({ adetailer_checkpoint: "" })}
                            >
                              {ko ? "메인 모델 사용" : "Use main model"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <Input
                        placeholder={ko ? "비우면 메인 모델 사용" : "Blank = use main model"}
                        value={params.adetailer_checkpoint}
                        onChange={(e) => setParams({ adetailer_checkpoint: e.target.value })}
                        className="h-8 text-xs"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <FieldHelp label="ADetailer LoRA" help={ko ? "얼굴을 다시 그리는 동안에만 적용할 LoRA로, 나머지 영역에는 영향을 주지 않습니다." : "LoRA applied only while redrawing faces without affecting the rest of the image."} />
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => setAdetailerLoraPickerIndex(-1)}
                        disabled={!isLocal || localModels.loraModels.length === 0}
                      >
                        + {ko ? "LoRA 추가" : "Add LoRA"}
                      </Button>
                    </div>
                    {params.adetailer_loras.map((lora, index) => {
                      const asset = localModels.loraModels.find(
                        (model) => model.path === lora.path
                      );
                      return (
                        <div key={lora.path + index} className="space-y-2 rounded-md border border-border p-2">
                          <AssetChoiceButton
                            asset={asset}
                            placeholder={lora.path || (ko ? "LoRA 선택" : "Select LoRA")}
                            onClick={() => setAdetailerLoraPickerIndex(index)}
                          />
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={-2}
                              max={2}
                              step={0.05}
                              value={lora.scale}
                              onChange={(e) =>
                                setParams({
                                  adetailer_loras: params.adetailer_loras.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? { ...item, scale: clampNumber(Number(e.target.value) || 0, -2, 2) }
                                      : item
                                  ),
                                })
                              }
                              className="h-8 flex-1 text-xs"
                            />
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                setParams({
                                  adetailer_loras: params.adetailer_loras.filter((_, itemIndex) => itemIndex !== index),
                                })
                              }
                            >
                              {ko ? "삭제" : "Remove"}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div>
                    <FieldHelp className="mb-2" label={ko ? "감지 모델" : "Detection model"} help={ko ? "이미지에서 얼굴 영역을 찾는 모델입니다. 작은 얼굴이 많다면 정밀한 모델을 선택하세요." : "Model that locates faces; use a more precise model for many small faces."} />
                    {adetailerModels.length > 0 ? (
                      <select
                        value={
                          isLocal && !adetailerModels.includes(params.adetailer_model)
                            ? "bbox/face_yolov8n_v2.pt"
                            : params.adetailer_model
                        }
                        onChange={(e) =>
                          setParams({ adetailer_model: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {adetailerModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        placeholder={isLocal ? "bbox/face_yolov8m.pt" : "face_yolov8n.pt"}
                        value={params.adetailer_model}
                        onChange={(e) =>
                          setParams({ adetailer_model: e.target.value })
                        }
                        className="h-8 text-xs"
                      />
                    )}
                  </div>

                  <div>
                    <FieldHelp className="mb-2" label={ko ? "얼굴 프롬프트" : "Face prompt"} help={ko ? "얼굴을 다시 그릴 때만 적용할 지시입니다. 비워두면 메인 프롬프트를 사용합니다." : "Instructions used only for face redraw; leave blank to reuse the main prompt."} />
                    <Input
                      placeholder="detailed face, beautiful detailed eyes"
                      value={params.adetailer_prompt}
                      onChange={(e) =>
                        setParams({ adetailer_prompt: e.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <FieldHelp className="mb-2" label={ko ? "얼굴 네거티브 프롬프트" : "Face negative prompt"} help={ko ? "얼굴 보정에서 제외할 특징입니다. 비워두면 메인 네거티브 프롬프트를 사용합니다." : "Features to suppress during face correction; leave blank to reuse the main negative prompt."} />
                    <Textarea
                      placeholder="lowres, bad anatomy, blurry, watermark"
                      value={params.adetailer_negative_prompt}
                      onChange={(e) => setParams({ adetailer_negative_prompt: e.target.value })}
                      className="min-h-20 resize-y text-xs"
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <FieldHelp label={ko ? "얼굴 보정 스텝" : "Steps"} help={ko ? "토글을 켜면 별도의 스텝 수를 사용하고, 끄면 메인 생성 스텝을 사용합니다." : "Enable to use separate face-correction steps; otherwise main steps are reused."} />
                        <Switch
                          size="sm"
                          checked={params.adetailer_use_steps}
                          onCheckedChange={(checked) => setParams({ adetailer_use_steps: checked })}
                          aria-label="Use custom ADetailer steps"
                        />
                      </label>
                      <Input
                        type="number"
                        min={1}
                        max={150}
                        value={params.adetailer_steps}
                        disabled={!params.adetailer_use_steps}
                        onChange={(e) => setParams({ adetailer_steps: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                        className="h-8 text-xs"
                      />
                      {!params.adetailer_use_steps && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {(ko ? "메인 Steps " : "Uses main Steps ") + params.num_inference_steps}
                        </p>
                      )}
                    </div>
                    <div>
                      <FieldHelp className="mb-2" label={ko ? "감지 신뢰도" : "Confidence"} help={ko ? "얼굴로 인정할 최소 확률입니다. 낮추면 더 많이 감지하지만 오인식이 늘 수 있습니다." : "Minimum face probability; lower values detect more but may add false positives."} />
                      <Input type="number" min={0} max={1} step={0.05} value={params.adetailer_confidence} onChange={(e) => setParams({ adetailer_confidence: clampNumber(Number(e.target.value) || 0, 0, 1) })} className="h-8 text-xs" />
                    </div>
                    <div>
                      <FieldHelp className="mb-2" label={ko ? "마스크 흐림" : "Mask blur"} help={ko ? "보정 경계를 부드럽게 만들어 원본과 자연스럽게 섞이게 합니다." : "Softens correction edges so they blend naturally with the original."} />
                      <Input type="number" min={0} max={100} value={params.adetailer_mask_blur} onChange={(e) => setParams({ adetailer_mask_blur: Math.max(0, Math.round(Number(e.target.value) || 0)) })} className="h-8 text-xs" />
                    </div>
                  </div>

                  <label className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                    <FieldHelp label={ko ? "마스크 영역만 보정" : "Inpaint only masked"} help={ko ? "얼굴 마스크 안쪽만 다시 그려 주변 배경과 의상이 바뀌는 것을 줄입니다." : "Redraws only inside face masks to reduce changes to clothing and background."} />
                    <Switch checked={params.adetailer_inpaint_only_masked} onCheckedChange={(checked) => setParams({ adetailer_inpaint_only_masked: checked })} aria-label="Inpaint only masked area" />
                  </label>

                  {isWebUi && (
                    <div>
                      <FieldHelp className="mb-2" label={ko ? "노이즈 배율" : "Noise multiplier"} help={ko ? "얼굴 보정에 추가할 노이즈 양입니다. 높으면 변화가 커지고 낮으면 원본을 더 보존합니다." : "Noise added during correction; higher values change more, lower values preserve more."} />
                      <Input type="number" min={0.5} max={1.5} step={0.01} value={params.adetailer_noise_multiplier} onChange={(e) => setParams({ adetailer_noise_multiplier: clampNumber(Number(e.target.value) || 1, 0.5, 1.5) })} className="h-8 text-xs" />
                    </div>
                  )}


                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <FieldHelp label={ko ? "얼굴 변형 강도" : "ADetailer denoise"} help={ko ? "얼굴을 얼마나 새로 그릴지 조절합니다. 너무 높으면 인물이 달라질 수 있습니다." : "Controls how strongly faces are redrawn; very high values may change identity."} />
                      <span className="text-xs font-mono">
                        {params.adetailer_denoise.toFixed(2)}
                      </span>
                    </div>
                    <Slider
                      value={[params.adetailer_denoise]}
                      onValueChange={(v) => {
                        const val = Array.isArray(v) ? v[0] : v;
                        setParams({
                          adetailer_denoise: Math.round(val * 100) / 100,
                        });
                      }}
                      min={0.1}
                      max={0.75}
                      step={0.05}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
      <AssetPickerDialog
        title={ko ? "ADetailer 얼굴 생성 모델 선택" : "Select ADetailer face model"}
        description={
          ko
            ? "얼굴 영역을 다시 생성할 체크포인트를 선택하세요."
            : "Choose the checkpoint used to regenerate detected faces."
        }
        assets={localModels.checkpointModels}
        selectedPath={params.adetailer_checkpoint || params.model_name}
        open={adetailerPickerOpen}
        onOpenChange={setAdetailerPickerOpen}
        onSelect={(asset) => {
          setParams({
            adetailer_checkpoint:
              asset.path === params.model_name ? "" : asset.path,
          });
          setAdetailerPickerOpen(false);
        }}
      />

      <AssetPickerDialog
        title={ko ? "ADetailer LoRA 선택" : "Select ADetailer LoRA"}
        description={
          ko
            ? "얼굴 영역을 다시 생성할 때만 적용할 LoRA를 선택하세요."
            : "Choose a LoRA applied only while regenerating detected faces."
        }
        assets={localModels.loraModels}
        selectedPath={
          adetailerLoraPickerIndex !== null && adetailerLoraPickerIndex >= 0
            ? params.adetailer_loras[adetailerLoraPickerIndex]?.path ?? ""
            : ""
        }
        open={adetailerLoraPickerIndex !== null}
        onOpenChange={(open) => {
          if (!open) setAdetailerLoraPickerIndex(null);
        }}
        onSelect={(asset) => {
          if (adetailerLoraPickerIndex === null) return;
          const nextLora = { path: asset.path, scale: 0.8 };
          setParams({
            adetailer_loras:
              adetailerLoraPickerIndex >= 0
                ? params.adetailer_loras.map((lora, index) =>
                    index === adetailerLoraPickerIndex
                      ? { ...lora, path: asset.path }
                      : lora
                  )
                : [...params.adetailer_loras, nextLora],
          });
          setAdetailerLoraPickerIndex(null);
        }}
      />
      </>)}
    </>
  );
}
