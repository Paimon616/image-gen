"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  getHiresPreset,
  getModelConfig,
  IMAGE_SIZE_CONSTRAINTS,
  IMAGE_SIZES,
  normalizeImageDimension,
} from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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

export function GenerationParams() {
  const { params, setParams, language } = useStore();
  const ko = language === "ko";
  const currentModel = getModelConfig(params.model);
  const isLocal = currentModel.provider === "comfyui";
  const isWebUi = params.backend === "a1111" || params.backend === "forge";
  const [draftSize, setDraftSize] = useState<
    Partial<Record<"width" | "height", string>>
  >({});
  const [localModels, setLocalModels] = useState<{
    vaes: string[];
    upscaleModels: string[];
    controlnets: string[];
  }>({ vaes: [], upscaleModels: [], controlnets: [] });
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
  const selectedPreset = IMAGE_SIZES.find(
    (size) => size.width === params.width && size.height === params.height
  );
  const aspectRatioLabel = getAspectRatioLabel(params.width, params.height);
  const sizeInput = {
    width: draftSize.width ?? String(params.width),
    height: draftSize.height ?? String(params.height),
  };

  const updateImageSize = (dimension: "width" | "height", value: string) => {
    setDraftSize((current) => ({ ...current, [dimension]: value }));

    if (!value.trim()) return;

    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
      setParams({ [dimension]: numericValue });
    }
  };

  const commitImageSize = (dimension: "width" | "height") => {
    const normalizedValue = normalizeImageDimension(sizeInput[dimension]);

    setDraftSize((current) => ({
      ...current,
      [dimension]: undefined,
    }));
    setParams({ [dimension]: normalizedValue });
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
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-card p-3 shadow-sm">
        <Label className="mb-2 block text-xs text-muted-foreground">Generation backend</Label>
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
            <Label className="text-xs text-muted-foreground">Size</Label>
            <span className="text-xs font-mono text-muted-foreground">
              {selectedPreset?.label ?? "Custom"} · {aspectRatioLabel}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {IMAGE_SIZES.map((size) => (
              <button
                key={size.label}
                type="button"
                onClick={() => {
                  setDraftSize({});
                  setParams({ width: size.width, height: size.height });
                }}
                className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                  params.width === size.width && params.height === size.height
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-border bg-card/70 text-foreground hover:border-primary/40 hover:bg-secondary/70"
                }`}
              >
                {size.label}
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
            </div>
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Images</Label>
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

      <details
        open
        className="group overflow-hidden rounded-md border border-border bg-card/85 shadow-sm"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between border-b border-border px-3 py-2 text-sm font-medium">
          <span>Advanced</span>
          <span className="text-muted-foreground transition-transform group-open:rotate-180">
            ⌃
          </span>
        </summary>

        <div className="space-y-4 p-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-xs text-muted-foreground">CFG Scale</Label>
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
              <Label className="text-xs text-muted-foreground mb-2 block">
                Sampler
              </Label>
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
                <Label className="text-xs text-muted-foreground">Steps</Label>
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
              <Label className="text-xs text-muted-foreground mb-2 block">Seed</Label>
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
                <Label className="text-xs text-muted-foreground">CLIP Skip</Label>
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
              <Label className="text-xs text-muted-foreground mb-2 block">VAE</Label>
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

          <div className="rounded-md border border-border bg-card p-3 shadow-sm">
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
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {hiresEnabled ? `${params.hires_upscale}× ON` : "OFF"}
                </span>
                <input
                  type="checkbox"
                  checked={hiresEnabled}
                  onChange={(e) =>
                    setParams({
                      hires_upscale: e.target.checked
                        ? params.hires_upscale > 1
                          ? params.hires_upscale
                          : 2
                        : 1,
                    })
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {ko
                ? "모델 업스케일 후 저 denoise로 디테일을 보강하는 2단계 refine입니다."
                : "A two-pass refine: model upscale, then low-denoise detail enhancement."}
            </p>

            <div className="mt-3 space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-2 block">
                  Upscaler
                </Label>
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
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Scale
                      </Label>
                      <Input
                        type="number"
                        min={1}
                        max={4}
                        step={0.05}
                        value={params.hires_upscale}
                        onChange={(e) =>
                          setParams({
                            hires_upscale: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="h-8 text-xs"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Steps
                      </Label>
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
                      <Label className="text-xs text-muted-foreground mb-2 block">
                        Denoise
                      </Label>
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
          </div>

          {isWebUi && (
            <div className="rounded-md border border-border bg-card p-3 shadow-sm">
              <label className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  ADetailer (auto face fix)
                </span>
                <input
                  type="checkbox"
                  checked={params.adetailer_enabled}
                  onChange={(e) =>
                    setParams({ adetailer_enabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-primary"
                />
              </label>

              {params.adetailer_enabled && (
                <div className="mt-3 space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      Detection model
                    </Label>
                    {webuiOptions.adetailerModels.length > 0 ? (
                      <select
                        value={params.adetailer_model}
                        onChange={(e) =>
                          setParams({ adetailer_model: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {webuiOptions.adetailerModels.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        placeholder="face_yolov8n.pt"
                        value={params.adetailer_model}
                        onChange={(e) =>
                          setParams({ adetailer_model: e.target.value })
                        }
                        className="h-8 text-xs"
                      />
                    )}
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      Face prompt (blank = reuse main prompt)
                    </Label>
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
                    <div className="flex justify-between items-center mb-2">
                      <Label className="text-xs text-muted-foreground">
                        ADetailer denoise
                      </Label>
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

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 shadow-sm">
              <Label className="text-xs text-muted-foreground">Prompt Weighting</Label>
              <span className="text-xs text-muted-foreground">
                ComfyUI prompt syntax
              </span>
            </div>
          </div>

          <div className="rounded-md border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">ControlNets</Label>
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
    </div>
  );
}
