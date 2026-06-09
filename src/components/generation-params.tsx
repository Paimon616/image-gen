"use client";

import { useStore } from "@/lib/store";
import { getModelConfig, IMAGE_SIZES } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function GenerationParams() {
  const { params, setParams } = useStore();
  const currentModel = getModelConfig(params.model);

  return (
    <div className="space-y-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <Label className="text-xs text-muted-foreground mb-2 block">Size</Label>
          <div className="grid grid-cols-3 gap-1.5">
            {IMAGE_SIZES.map((size) => (
              <button
                key={size.label}
                type="button"
                onClick={() => setParams({ width: size.width, height: size.height })}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="flex justify-between items-center mb-2">
            <Label className="text-xs text-muted-foreground">Steps</Label>
            <span className="text-xs font-mono">{params.num_inference_steps}</span>
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
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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

        {currentModel.provider === "fal" && (
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Format</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {(["jpeg", "png"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => setParams({ output_format: format })}
                  className={`text-xs py-1.5 px-2 rounded-md border uppercase transition-colors ${
                    params.output_format === format
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-muted-foreground/50"
                  }`}
                >
                  {format}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Label className="text-xs text-muted-foreground">Prompt Weighting</Label>
          <Switch
            size="sm"
            checked={params.prompt_weighting}
            onCheckedChange={(checked) => setParams({ prompt_weighting: checked })}
            disabled={!currentModel.supports.custom_model}
          />
        </div>

        {currentModel.provider === "fal" && (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <Label className="text-xs text-muted-foreground">Safety Checker</Label>
            <Switch
              size="sm"
              checked={params.enable_safety_checker}
              onCheckedChange={(checked) =>
                setParams({ enable_safety_checker: checked })
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
