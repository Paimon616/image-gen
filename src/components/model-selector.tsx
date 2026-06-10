"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { AVAILABLE_MODELS, getModelConfig } from "@/lib/types";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface LocalModelAsset {
  path: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
}

function assetLabel(asset: LocalModelAsset) {
  return asset.version ? `${asset.name} (${asset.version})` : asset.name;
}

function AssetThumbnail({
  asset,
  className = "h-12 w-12",
}: {
  asset: LocalModelAsset | undefined;
  className?: string;
}) {
  if (asset?.thumbnail_url) {
    return (
      <img
        src={asset.thumbnail_url}
        alt={asset.name}
        className={`${className} shrink-0 rounded-md object-cover`}
      />
    );
  }

  return (
    <div
      className={`${className} flex shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-medium text-muted-foreground`}
    >
      {asset?.name.slice(0, 2).toUpperCase() ?? "M"}
    </div>
  );
}

function AssetText({ asset }: { asset: LocalModelAsset }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-primary">{asset.name}</div>
      <div className="truncate text-xs text-muted-foreground">
        {[asset.version, asset.base_model].filter(Boolean).join(" · ") || asset.path}
      </div>
    </div>
  );
}

export function ModelSelector() {
  const { params, setParams } = useStore();
  const currentModel = getModelConfig(params.model);
  const isLocal = currentModel.provider === "comfyui";
  const [localModels, setLocalModels] = useState<{
    checkpoints: string[];
    loras: string[];
    embeddings: string[];
    checkpointAssets: LocalModelAsset[];
    loraAssets: LocalModelAsset[];
    embeddingAssets: LocalModelAsset[];
  }>({
    checkpoints: [],
    loras: [],
    embeddings: [],
    checkpointAssets: [],
    loraAssets: [],
    embeddingAssets: [],
  });

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) =>
        setLocalModels({
          checkpoints: data.checkpoints ?? [],
          loras: data.loras ?? [],
          embeddings: data.embeddings ?? [],
          checkpointAssets: data.checkpointAssets ?? [],
          loraAssets: data.loraAssets ?? [],
          embeddingAssets: data.embeddingAssets ?? [],
        })
      )
      .catch(() => {});
  }, []);

  const handleSelect = (modelId: string) => {
    const model = getModelConfig(modelId);
    const modelName =
      model.provider === "comfyui"
        ? localModels.checkpoints[0] ?? "sd_xl_base_1.0.safetensors"
        : model.id === "fal-ai/lora"
          ? "stabilityai/stable-diffusion-xl-base-1.0"
          : params.model_name;

    setParams({
      model: modelId,
      model_name: modelName,
      num_inference_steps: model.defaults.num_inference_steps,
      guidance_scale: model.defaults.guidance_scale,
    });
  };

  const addLora = () => {
    setParams({ loras: [...params.loras, { path: "", scale: 0.8 }] });
  };

  const updateLora = (index: number, field: "path" | "scale", value: string | number) => {
    const updated = params.loras.map((lora, i) =>
      i === index ? { ...lora, [field]: value } : lora
    );
    setParams({ loras: updated });
  };

  const removeLora = (index: number) => {
    setParams({ loras: params.loras.filter((_, i) => i !== index) });
  };

  const addEmbedding = () => {
    setParams({ embeddings: [...params.embeddings, { path: "", tokens: "" }] });
  };

  const updateEmbedding = (
    index: number,
    field: "path" | "tokens",
    value: string
  ) => {
    const updated = params.embeddings.map((embedding, i) =>
      i === index ? { ...embedding, [field]: value } : embedding
    );
    setParams({ embeddings: updated });
  };

  const removeEmbedding = (index: number) => {
    setParams({ embeddings: params.embeddings.filter((_, i) => i !== index) });
  };

  const findAsset = (assets: LocalModelAsset[], path: string) =>
    assets.find((asset) => asset.path === path);

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground block">Model</Label>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {AVAILABLE_MODELS.map((model) => (
          <button
            key={model.id}
            type="button"
            onClick={() => handleSelect(model.id)}
            className={`min-w-max rounded-md border px-3 py-2 text-left transition-colors ${
              params.model === model.id
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground/50 hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{model.name}</span>
              {model.provider === "comfyui" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  Local
                </Badge>
              )}
              {model.supports.lora && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  LoRA
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-48 truncate">
              {model.description}
            </p>
          </button>
        ))}
      </div>

      {currentModel.provider === "comfyui" && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Base Model
          </Label>
          {localModels.checkpointAssets.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {localModels.checkpointAssets.map((checkpoint) => (
                <button
                  key={checkpoint.path}
                  type="button"
                  onClick={() => setParams({ model_name: checkpoint.path })}
                  className={`flex min-w-0 items-center gap-3 rounded-md border p-2 text-left transition-colors ${
                    params.model_name === checkpoint.path
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-muted-foreground/50 hover:bg-muted/40"
                  }`}
                >
                  <AssetThumbnail asset={checkpoint} className="h-14 w-14" />
                  <AssetText asset={checkpoint} />
                </button>
              ))}
            </div>
          ) : (
            <Input
              placeholder="checkpoint.safetensors"
              value={params.model_name}
              onChange={(e) => setParams({ model_name: e.target.value })}
              className="h-9 text-xs"
            />
          )}
        </div>
      )}

      {currentModel.supports.custom_model && currentModel.provider !== "comfyui" && (
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Base Model
          </Label>
          <Input
            placeholder="Hugging Face repo or checkpoint URL"
            value={params.model_name}
            onChange={(e) => setParams({ model_name: e.target.value })}
            className="h-9 text-xs"
          />
        </div>
      )}

      {(currentModel.supports.lora || currentModel.supports.embeddings) && (
        <div className="grid gap-3 rounded-md border border-border p-3 xl:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">LoRA</Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={addLora}
                disabled={!currentModel.supports.lora}
              >
                + Add
              </Button>
            </div>
            <div className="space-y-2">
              {params.loras.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  + Add로 LoRA를 추가하세요.
                </p>
              )}
              {params.loras.map((lora, i) => (
                <div key={i} className="space-y-2 rounded-md border border-border p-2">
                  {isLocal && localModels.loraAssets.length > 0 ? (
                    <>
                      {lora.path && findAsset(localModels.loraAssets, lora.path) && (
                        <div className="flex items-center gap-3">
                          <AssetThumbnail
                            asset={findAsset(localModels.loraAssets, lora.path)}
                          />
                          <AssetText
                            asset={findAsset(localModels.loraAssets, lora.path)!}
                          />
                        </div>
                      )}
                      <div className="flex gap-2">
                        <select
                          value={lora.path}
                          onChange={(e) => updateLora(i, "path", e.target.value)}
                          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <option value="">Select LoRA...</option>
                          {localModels.loraAssets.map((localLora) => (
                            <option key={localLora.path} value={localLora.path}>
                              {assetLabel(localLora)}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          value={lora.scale}
                          onChange={(e) =>
                            updateLora(i, "scale", parseFloat(e.target.value) || 0)
                          }
                          className="h-8 w-16 text-xs"
                          min={0}
                          max={2}
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
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        placeholder={
                          isLocal ? "my-lora.safetensors" : "huggingface/lora-name"
                        }
                        value={lora.path}
                        onChange={(e) => updateLora(i, "path", e.target.value)}
                        className="h-8 min-w-0 flex-1 text-xs"
                      />
                      <Input
                        type="number"
                        value={lora.scale}
                        onChange={(e) =>
                          updateLora(i, "scale", parseFloat(e.target.value) || 0)
                        }
                        className="h-8 w-16 text-xs"
                        min={0}
                        max={2}
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
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">Embeddings</Label>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={addEmbedding}
                disabled={!currentModel.supports.embeddings}
              >
                + Add
              </Button>
            </div>
            <div className="space-y-2">
              {params.embeddings.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  + Add로 embedding을 추가하세요.
                </p>
              )}
              {params.embeddings.map((embedding, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex gap-2">
                    {isLocal && localModels.embeddings.length > 0 ? (
                      <select
                        value={embedding.path}
                        onChange={(e) =>
                          updateEmbedding(i, "path", e.target.value)
                        }
                        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">Select embedding...</option>
                        {localModels.embeddingAssets.map((localEmbedding) => (
                          <option key={localEmbedding.path} value={localEmbedding.path}>
                            {assetLabel(localEmbedding)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        placeholder={
                          isLocal
                            ? "embedding file name"
                            : "embedding .safetensors URL or repo path"
                        }
                        value={embedding.path}
                        onChange={(e) =>
                          updateEmbedding(i, "path", e.target.value)
                        }
                        className="h-8 min-w-0 flex-1 text-xs"
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-destructive"
                      onClick={() => removeEmbedding(i)}
                    >
                      ×
                    </Button>
                  </div>
                  <Input
                    placeholder="tokens, comma separated"
                    value={embedding.tokens}
                    onChange={(e) => updateEmbedding(i, "tokens", e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
