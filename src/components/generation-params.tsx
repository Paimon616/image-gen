"use client";

import { useStore } from "@/lib/store";
import { IMAGE_SIZES } from "@/lib/types";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

export function GenerationParams() {
  const { params, setParams } = useStore();

  const addLora = () => {
    setParams({ loras: [...params.loras, { path: "", scale: 0.8 }] });
  };

  const updateLora = (index: number, field: "path" | "scale", value: string | number) => {
    const updated = params.loras.map((l, i) =>
      i === index ? { ...l, [field]: value } : l
    );
    setParams({ loras: updated });
  };

  const removeLora = (index: number) => {
    setParams({ loras: params.loras.filter((_, i) => i !== index) });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs text-muted-foreground mb-2 block">Image Size</Label>
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

      <Separator />

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
          <span className="text-xs font-mono">{params.guidance_scale.toFixed(1)}</span>
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

      <Separator />

      <div>
        <div className="flex justify-between items-center mb-2">
          <Label className="text-xs text-muted-foreground">LoRA</Label>
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={addLora}>
            + Add
          </Button>
        </div>
        {params.loras.map((lora, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <Input
              placeholder="huggingface/lora-name"
              value={lora.path}
              onChange={(e) => updateLora(i, "path", e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <Input
              type="number"
              value={lora.scale}
              onChange={(e) => updateLora(i, "scale", parseFloat(e.target.value) || 0)}
              className="h-8 text-xs w-16"
              min={0}
              max={1}
              step={0.1}
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive"
              onClick={() => removeLora(i)}
            >
              ×
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
