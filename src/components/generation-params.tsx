"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import {
  getModelConfig,
  IMAGE_SIZE_CONSTRAINTS,
  IMAGE_SIZES,
  normalizeImageDimension,
} from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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

export function GenerationParams() {
  const { params, setParams } = useStore();
  const currentModel = getModelConfig(params.model);
  const isLocal = currentModel.provider === "comfyui";
  const [draftSize, setDraftSize] = useState<
    Partial<Record<"width" | "height", string>>
  >({});
  const [localModels, setLocalModels] = useState<{
    vaes: string[];
    controlnets: string[];
  }>({ vaes: [], controlnets: [] });

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) =>
        setLocalModels({
          vaes: data.vaes ?? [],
          controlnets: data.controlnets ?? [],
        })
      )
      .catch(() => {});
  }, []);

  const controlnets = params.controlnets ?? [];
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
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-muted-foreground/50"
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
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:border-muted-foreground/50"
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
        className="group overflow-hidden rounded-md border border-border bg-card/30"
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
                <span className="text-xs font-mono">
                  {params.guidance_scale.toFixed(1)}
                </span>
              </div>
              <Slider
                value={[params.guidance_scale]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setParams({ guidance_scale: val });
                }}
                min={1}
                max={20}
                step={0.5}
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
                <span className="text-xs font-mono">
                  {params.num_inference_steps}
                </span>
              </div>
              <Slider
                value={[params.num_inference_steps]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setParams({ num_inference_steps: val });
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
                placeholder="Random"
                value={params.seed ?? ""}
                onChange={(e) =>
                  setParams({
                    seed: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                className="h-8 text-sm"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-xs text-muted-foreground">CLIP Skip</Label>
                <span className="text-xs font-mono">{params.clip_skip}</span>
              </div>
              <Slider
                value={[params.clip_skip]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setParams({ clip_skip: val });
                }}
                min={1}
                max={12}
                step={1}
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

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label className="text-xs text-muted-foreground">Prompt Weighting</Label>
              <span className="text-xs text-muted-foreground">
                ComfyUI prompt syntax
              </span>
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
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
                  className="w-full rounded-md border border-dashed border-border px-3 py-5 text-sm text-muted-foreground transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Add ControlNet
                </button>
              )}

              {controlnets.map((controlnet, i) => (
                <div key={i} className="grid gap-2 rounded-md border border-border p-2">
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
