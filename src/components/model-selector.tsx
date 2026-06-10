"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { getModelConfig } from "@/lib/types";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface LocalModelAsset {
  path: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
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

function AssetChoiceButton({
  asset,
  placeholder,
  onClick,
}: {
  asset: LocalModelAsset | undefined;
  placeholder: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full min-w-0 flex-1 items-center gap-3 rounded-md border p-2 text-left shadow-sm transition-colors ${
        asset
          ? "border-primary/25 bg-card hover:border-primary/50 hover:bg-secondary/45"
          : "border-dashed border-border bg-card/70 text-muted-foreground hover:border-primary/60 hover:bg-secondary/70"
      }`}
    >
      <AssetThumbnail asset={asset} className="h-12 w-12" />
      {asset ? (
        <AssetText asset={asset} />
      ) : (
        <div className="min-w-0">
          <div className="text-sm font-medium">{placeholder}</div>
          <div className="text-xs text-muted-foreground">Click to choose</div>
        </div>
      )}
    </button>
  );
}

function AssetPickerDialog({
  title,
  description,
  assets,
  selectedPath,
  open,
  onOpenChange,
  onSelect,
}: {
  title: string;
  description: string;
  assets: LocalModelAsset[];
  selectedPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: LocalModelAsset) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredAssets = assets.filter((asset) => {
    const haystack = [
      asset.name,
      asset.version,
      asset.base_model,
      asset.path,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[88vh] max-w-[96vw] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[86rem]">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <div className="flex gap-1">
            {["All", "Featured", "Recent", "Mine"].map((label, index) => (
              <button
                key={label}
                type="button"
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                  index === 0
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search model name, version, base model..."
            className="ml-auto h-9 max-w-sm text-xs"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {filteredAssets.length === 0 ? (
            <div className="flex h-full min-h-72 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
              표시할 모델이 없습니다.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredAssets.map((asset) => {
                const selected = asset.path === selectedPath;

                return (
                  <div
                    key={asset.path}
                    className={`overflow-hidden rounded-md border bg-card ${
                      selected ? "border-primary ring-2 ring-primary/25" : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(asset)}
                      className="block w-full text-left"
                    >
                      <div className="relative aspect-[4/3] bg-muted">
                        {asset.thumbnail_url ? (
                          <img
                            src={asset.thumbnail_url}
                            alt={asset.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl font-semibold text-muted-foreground">
                            {asset.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <Badge className="absolute left-2 top-2 bg-background/80 text-foreground backdrop-blur">
                          {asset.base_model || "Local"}
                        </Badge>
                      </div>
                    </button>
                    <div className="space-y-3 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {asset.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[asset.version, asset.path].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <Button
                        className="w-full"
                        variant={selected ? "secondary" : "default"}
                        onClick={() => onSelect(asset)}
                      >
                        {selected ? "Selected" : "Select"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type PickerTarget =
  | { type: "checkpoint" }
  | { type: "lora"; index: number }
  | { type: "lora-new" }
  | { type: "embedding"; index: number }
  | { type: "embedding-new" }
  | null;

function LoraScaleSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid min-w-28 gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">Weight</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {value.toFixed(1)}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(nextValue) =>
          onChange(Array.isArray(nextValue) ? nextValue[0] ?? value : nextValue)
        }
        min={0}
        max={2}
        step={0.1}
      />
    </div>
  );
}

export function ModelSelector() {
  const { params, setParams } = useStore();
  const currentModel = getModelConfig(params.model);
  const isLocal = currentModel.provider === "comfyui";
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
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

  const refreshLocalModels = useCallback(() => {
    fetch("/api/models", { cache: "no-store" })
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

  useEffect(() => {
    refreshLocalModels();
  }, [refreshLocalModels]);

  const addEmptyLora = () => {
    setParams({ loras: [...params.loras, { path: "", scale: 0.8 }] });
  };

  const addLora = () => {
    if (isLocal && localModels.loraAssets.length > 0) {
      setPickerTarget({ type: "lora-new" });
      return;
    }

    addEmptyLora();
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

  const addEmptyEmbedding = () => {
    setParams({ embeddings: [...params.embeddings, { path: "", tokens: "" }] });
  };

  const addEmbedding = () => {
    if (isLocal && localModels.embeddingAssets.length > 0) {
      setPickerTarget({ type: "embedding-new" });
      return;
    }

    addEmptyEmbedding();
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

  const selectedCheckpoint = findAsset(
    localModels.checkpointAssets,
    params.model_name
  );

  useEffect(() => {
    if (localModels.checkpointAssets.length > 0 && !selectedCheckpoint) {
      setParams({ model_name: localModels.checkpointAssets[0].path });
    }
  }, [localModels.checkpointAssets, selectedCheckpoint, setParams]);

  const pickerAssets =
    pickerTarget?.type === "checkpoint"
      ? localModels.checkpointAssets
      : pickerTarget?.type === "lora" || pickerTarget?.type === "lora-new"
        ? localModels.loraAssets
        : pickerTarget?.type === "embedding" ||
            pickerTarget?.type === "embedding-new"
          ? localModels.embeddingAssets
          : [];

  const pickerSelectedPath =
    pickerTarget?.type === "checkpoint"
      ? params.model_name
      : pickerTarget?.type === "lora"
        ? params.loras[pickerTarget.index]?.path ?? ""
        : pickerTarget?.type === "embedding"
          ? params.embeddings[pickerTarget.index]?.path ?? ""
          : "";

  const pickerTitle =
    pickerTarget?.type === "checkpoint"
      ? "Select Checkpoint"
      : pickerTarget?.type === "lora" || pickerTarget?.type === "lora-new"
        ? "Select LoRA"
        : "Select Embedding";

  const handlePickerSelect = (asset: LocalModelAsset) => {
    if (pickerTarget?.type === "checkpoint") {
      setParams({ model_name: asset.path });
    }

    if (pickerTarget?.type === "lora") {
      updateLora(pickerTarget.index, "path", asset.path);
    }

    if (pickerTarget?.type === "lora-new") {
      setParams({ loras: [...params.loras, { path: asset.path, scale: 0.8 }] });
    }

    if (pickerTarget?.type === "embedding") {
      updateEmbedding(pickerTarget.index, "path", asset.path);
    }

    if (pickerTarget?.type === "embedding-new") {
      setParams({
        embeddings: [...params.embeddings, { path: asset.path, tokens: "" }],
      });
    }

    setPickerTarget(null);
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <Label className="text-xs text-muted-foreground">
            Base Model
          </Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={refreshLocalModels}
          >
            Refresh
          </Button>
        </div>
        {localModels.checkpointAssets.length > 0 ? (
          <AssetChoiceButton
            asset={selectedCheckpoint}
            placeholder="Select checkpoint"
            onClick={() => setPickerTarget({ type: "checkpoint" })}
          />
        ) : (
          <Input
            placeholder="checkpoint.safetensors"
            value={params.model_name}
            onChange={(e) => setParams({ model_name: e.target.value })}
            className="h-9 text-xs"
          />
        )}
      </div>

      {(currentModel.supports.lora || currentModel.supports.embeddings) && (
        <div className="grid gap-3 rounded-md border border-border bg-card/85 p-3 shadow-sm xl:grid-cols-2">
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
                <p className="rounded-md border border-dashed border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  + Add로 LoRA를 추가하세요.
                </p>
              )}
              {params.loras.map((lora, i) => (
                <div key={i} className="space-y-2 rounded-md border border-border bg-background/60 p-2">
                  {isLocal && localModels.loraAssets.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_2rem]">
                      <AssetChoiceButton
                        asset={findAsset(localModels.loraAssets, lora.path)}
                        placeholder="Select LoRA"
                        onClick={() => setPickerTarget({ type: "lora", index: i })}
                      />
                      <LoraScaleSlider
                        value={lora.scale}
                        onChange={(value) => updateLora(i, "scale", value)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 self-end p-0 text-destructive"
                        onClick={() => removeLora(i)}
                      >
                        ×
                      </Button>
                    </div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_2rem]">
                      <Input
                        placeholder={
                          isLocal ? "my-lora.safetensors" : "huggingface/lora-name"
                        }
                        value={lora.path}
                        onChange={(e) => updateLora(i, "path", e.target.value)}
                        className="h-8 min-w-0 text-xs"
                      />
                      <LoraScaleSlider
                        value={lora.scale}
                        onChange={(value) => updateLora(i, "scale", value)}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 self-end p-0 text-destructive"
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
                <p className="rounded-md border border-dashed border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
                  + Add로 embedding을 추가하세요.
                </p>
              )}
              {params.embeddings.map((embedding, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex gap-2">
                    {isLocal && localModels.embeddingAssets.length > 0 ? (
                      <AssetChoiceButton
                        asset={findAsset(localModels.embeddingAssets, embedding.path)}
                        placeholder="Select embedding"
                        onClick={() =>
                          setPickerTarget({ type: "embedding", index: i })
                        }
                      />
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

      <AssetPickerDialog
        title={pickerTitle}
        description="썸네일, 이름, 버전 기준으로 사용할 모델을 선택하세요."
        assets={pickerAssets}
        selectedPath={pickerSelectedPath}
        open={pickerTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPickerTarget(null);
        }}
        onSelect={handlePickerSelect}
      />
    </div>
  );
}
