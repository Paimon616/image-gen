"use client";

import { useStore } from "@/lib/store";
import { AVAILABLE_MODELS, getModelConfig } from "@/lib/types";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export function ModelSelector() {
  const { params, setParams } = useStore();
  const currentModel = getModelConfig(params.model);

  const handleSelect = (modelId: string) => {
    const model = getModelConfig(modelId);
    setParams({
      model: modelId,
      num_inference_steps: model.defaults.num_inference_steps,
      guidance_scale: model.defaults.guidance_scale,
    });
  };

  return (
    <div>
      <Label className="text-xs text-muted-foreground mb-2 block">Model</Label>
      <div className="space-y-1.5">
        {AVAILABLE_MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => handleSelect(model.id)}
            className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
              params.model === model.id
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50 hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{model.name}</span>
              <div className="flex gap-1">
                {model.supports.custom_model && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Custom
                  </Badge>
                )}
                {model.supports.lora && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    LoRA
                  </Badge>
                )}
                {model.supports.embeddings && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Embed
                  </Badge>
                )}
                {model.supports.face_id && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Face
                  </Badge>
                )}
                {model.supports.ip_adapter && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    Style
                  </Badge>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {model.description}
            </p>
          </button>
        ))}
      </div>

      {/* Compatibility warnings */}
      {params.style_image && !currentModel.supports.ip_adapter && (
        <p className="text-xs text-yellow-500 mt-2">
          {currentModel.name} doesn&apos;t support style reference — it will be ignored
        </p>
      )}
      {params.character_image && !currentModel.supports.face_id && (
        <p className="text-xs text-yellow-500 mt-2">
          {currentModel.name} doesn&apos;t support character reference — it will be ignored
        </p>
      )}
      {params.loras.length > 0 && !currentModel.supports.lora && (
        <p className="text-xs text-yellow-500 mt-2">
          {currentModel.name} doesn&apos;t support LoRA — they will be ignored
        </p>
      )}
      {params.embeddings.length > 0 && !currentModel.supports.embeddings && (
        <p className="text-xs text-yellow-500 mt-2">
          {currentModel.name} doesn&apos;t support embeddings — they will be ignored
        </p>
      )}
    </div>
  );
}
