"use client";

import { useCallback, useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { getModelConfig } from "@/lib/types";
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
import { ModelMediaThumbnail } from "@/components/model-media-thumbnail";
import { ModelRiskBadge, type ModelRisk } from "@/components/model-risk-badge";
import { FieldHelp } from "@/components/field-help";

export interface LocalModelAsset {
  path: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
  exists?: boolean;
  missing_required_files?: string[];
  risk?: ModelRisk | null;
}

function AssetThumbnail({
  asset,
  className = "h-12 w-12",
}: {
  asset: LocalModelAsset | undefined;
  className?: string;
}) {
  return (
    <ModelMediaThumbnail
      src={asset?.thumbnail_url}
      alt={asset?.name ?? "Model"}
      fallback={asset?.name.slice(0, 2).toUpperCase() ?? "M"}
      className={`${className} shrink-0`}
    />
  );
}

function AssetText({ asset }: { asset: LocalModelAsset }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-sm font-medium text-primary">{asset.name}</span>
        <ModelRiskBadge risk={asset.risk} size={14} className="shrink-0" />
      </div>
      <div className="truncate text-xs text-muted-foreground">
        {[
          asset.version,
          asset.base_model,
          asset.exists === false ? "현재 로컬에 없음" : "",
        ].filter(Boolean).join(" · ") || asset.path}
      </div>
    </div>
  );
}

export function AssetChoiceButton({
  asset,
  placeholder,
  fallbackLabel,
  fallbackDescription,
  onClick,
}: {
  asset: LocalModelAsset | undefined;
  placeholder: string;
  fallbackLabel?: string;
  fallbackDescription?: string;
  onClick: () => void;
}) {
  const hasFallback = Boolean(!asset && fallbackLabel?.trim());

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full min-w-0 flex-1 items-center gap-3 rounded-md border p-2 text-left shadow-sm transition-colors ${
        asset || hasFallback
          ? "border-primary/25 bg-card hover:border-primary/50 hover:bg-secondary/45"
          : "border-dashed border-border bg-card/70 text-muted-foreground hover:border-primary/60 hover:bg-secondary/70"
      }`}
    >
      <AssetThumbnail asset={asset} className="h-12 w-12" />
      {asset ? (
        <AssetText asset={asset} />
      ) : hasFallback ? (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-primary">
            {fallbackLabel}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {fallbackDescription ?? "Imported resource"}
          </div>
        </div>
      ) : (
        <div className="min-w-0">
          <div className="text-sm font-medium">{placeholder}</div>
          <div className="text-xs text-muted-foreground">Click to choose</div>
        </div>
      )}
    </button>
  );
}

type AssetLocationFilter = "all" | "local" | "runpod";

export function AssetPickerDialog({
  title,
  description,
  assets,
  selectedPath,
  open,
  onOpenChange,
  onSelect,
  runpodMode = false,
  runpodPaths = null,
}: {
  title: string;
  description: string;
  assets: LocalModelAsset[];
  selectedPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: LocalModelAsset) => void;
  // When the image generator targets a RunPod, the picker can filter its list
  // down to models that pod can actually load. `runpodPaths` holds the lowercased
  // filenames present on the pod (null while unknown / not a RunPod target).
  runpodMode?: boolean;
  runpodPaths?: Set<string> | null;
}) {
  const [query, setQuery] = useState("");
  const [locationFilter, setLocationFilter] = useState<AssetLocationFilter>(
    runpodMode ? "runpod" : "all"
  );

  // Reset to the mode-appropriate default whenever the picker opens or the
  // target (local vs RunPod) changes, so it never lingers on a stale filter.
  // Done during render (React's supported "reset on prop change" pattern)
  // rather than in an effect, which would cause a wasted extra render.
  const openStateKey = open ? (runpodMode ? "runpod" : "local") : "";
  const [lastOpenStateKey, setLastOpenStateKey] = useState(openStateKey);
  if (openStateKey !== lastOpenStateKey) {
    setLastOpenStateKey(openStateKey);
    if (open) setLocationFilter(runpodMode ? "runpod" : "all");
  }

  const isOnRunpod = (asset: LocalModelAsset) =>
    runpodPaths?.has(asset.path.replaceAll("\\", "/").toLowerCase()) ?? false;

  const locationFilters: Array<{ key: AssetLocationFilter; label: string }> = [
    { key: "all", label: "All" },
    { key: "local", label: "Local" },
    { key: "runpod", label: "RunPod" },
  ];

  const filteredAssets = assets.filter((asset) => {
    if (locationFilter === "local" && asset.exists === false) return false;
    if (locationFilter === "runpod" && !isOnRunpod(asset)) return false;

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
            {locationFilters.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setLocationFilter(key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  locationFilter === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
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
                    className={`relative overflow-hidden rounded-md border bg-card ${
                      selected ? "border-primary ring-2 ring-primary/25" : "border-border"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(asset)}
                      className="block w-full text-left"
                    >
                      <div className="relative aspect-[4/3] bg-muted">
                        <ModelMediaThumbnail
                          src={asset.thumbnail_url}
                          alt={asset.name}
                          fallback={asset.name.slice(0, 2).toUpperCase()}
                          className="h-full w-full"
                          fallbackClassName="text-3xl font-semibold"
                        />
                        <Badge className="absolute left-2 top-2 bg-background/80 text-foreground backdrop-blur">
                          {asset.base_model || "Unknown"}
                        </Badge>
                      </div>
                    </button>
                    <div className="absolute right-2 top-2 z-10">
                      <ModelRiskBadge risk={asset.risk} size={18} className="bg-background/85 backdrop-blur" />
                    </div>
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

const DEFAULT_LORA_SCALE = 0.8;

function roundToStep(value: number, step: number) {
  return Math.round(value / step) * step;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatScale(value: number) {
  return Number(value.toFixed(2)).toString();
}

function LoraScaleSlider({
  value,
  onChange,
  min = 0,
  max = 2,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  // A weight that came from outside the form (a Paimon patch, imported
  // metadata, a persisted snapshot from before the field existed) can be
  // missing or non-numeric. This renders mid-tree, so dereferencing it blindly
  // would take the whole page down instead of showing one wrong number.
  const scale = Number.isFinite(value) ? value : DEFAULT_LORA_SCALE;

  return (
    <div className="grid min-w-32 gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">Weight</span>
        <Input
          type="number"
          min={min}
          max={max}
          step={0.05}
          value={formatScale(scale)}
          onChange={(event) => {
            const nextValue = Number(event.target.value);
            if (!Number.isFinite(nextValue)) return;
            onChange(roundToStep(clampNumber(nextValue, min, max), 0.05));
          }}
          className="h-6 w-16 px-2 text-right text-[10px] font-mono"
        />
      </div>
      <Slider
        value={[scale]}
        onValueChange={(nextValue) =>
          onChange(
            roundToStep(
              Array.isArray(nextValue) ? nextValue[0] ?? scale : nextValue,
              0.05
            )
          )
        }
        min={min}
        max={max}
        step={0.05}
      />
    </div>
  );
}

function isKreaSliderLora(asset: LocalModelAsset | undefined, path: string) {
  const label = [asset?.name, asset?.base_model, asset?.path, path]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    (asset?.base_model.toLowerCase() === "krea 2" && label.includes("slider")) ||
    /realism.?slider|detail.?slider|detailer-krea2/i.test(label)
  );
}

export function ModelSelector({
  generationTarget = "local",
  runpodPodId = "",
}: {
  generationTarget?: "local" | "runpod";
  runpodPodId?: string;
} = {}) {
  const { params, setParams, language } = useStore();
  const ko = language === "ko";
  const currentModel = getModelConfig(params.model);
  const isLocal = currentModel.provider === "comfyui";
  const runpodMode = generationTarget === "runpod" && Boolean(runpodPodId);
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
  // Models physically present on the pod, resolved to picker assets server-side.
  const [runpodCatalog, setRunpodCatalog] = useState<{
    checkpoints: LocalModelAsset[];
    loras: LocalModelAsset[];
    embeddings: LocalModelAsset[];
  } | null>(null);
  const [localModels, setLocalModels] = useState<{
    checkpoints: string[];
    loras: string[];
    embeddings: string[];
    checkpointAssets: LocalModelAsset[];
    loraAssets: LocalModelAsset[];
    embeddingAssets: LocalModelAsset[];
    animaMissingRequiredFiles: string[];
  }>({
    checkpoints: [],
    loras: [],
    embeddings: [],
    checkpointAssets: [],
    loraAssets: [],
    embeddingAssets: [],
    animaMissingRequiredFiles: [],
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
          animaMissingRequiredFiles: data.animaMissingRequiredFiles ?? [],
        })
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshLocalModels();
  }, [refreshLocalModels]);

  useEffect(() => {
    window.addEventListener("local-models-changed", refreshLocalModels);

    return () => {
      window.removeEventListener("local-models-changed", refreshLocalModels);
    };
  }, [refreshLocalModels]);

  // Drop any stale pod catalog the moment the target (local vs RunPod, or which
  // pod) changes, so the "RunPod" filter never shows another pod's models while
  // the fresh list loads. Done during render, not in the fetch effect below.
  const runpodCatalogKey = runpodMode ? runpodPodId : "";
  const [loadedRunpodCatalogKey, setLoadedRunpodCatalogKey] =
    useState(runpodCatalogKey);
  if (runpodCatalogKey !== loadedRunpodCatalogKey) {
    setLoadedRunpodCatalogKey(runpodCatalogKey);
    setRunpodCatalog(null);
  }

  // When targeting a RunPod, pull every model physically present on the pod
  // (already resolved to picker assets server-side) so the list shows all of
  // them and the "RunPod" filter reflects what actually lives on the pod.
  useEffect(() => {
    if (!runpodMode) return;

    let cancelled = false;
    const toAssets = (items: unknown): LocalModelAsset[] =>
      (Array.isArray(items) ? items : [])
        .filter((item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object"
        )
        .map((item) => ({
          path: String(item.path ?? ""),
          name: String(item.name ?? item.path ?? ""),
          version: String(item.version ?? ""),
          base_model: String(item.base_model ?? ""),
          thumbnail_url:
            typeof item.thumbnail_url === "string" ? item.thumbnail_url : null,
          exists: false,
          risk: null,
        }))
        .filter((asset) => asset.path);

    fetch(`/api/runpod/pods/${encodeURIComponent(runpodPodId)}/model-catalog`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setRunpodCatalog({
          checkpoints: toAssets(data.checkpoints),
          loras: toAssets(data.loras),
          embeddings: toAssets(data.embeddings),
        });
        // The endpoint folds pod-catalog metadata into this machine's local
        // catalog; re-pull /api/models so those thumbnails/names show too.
        refreshLocalModels();
      })
      .catch(() => {
        if (!cancelled) setRunpodCatalog(null);
      });

    return () => {
      cancelled = true;
    };
  }, [runpodMode, runpodPodId, refreshLocalModels]);

  // Merge pod-only models (not present in the local list) into each picker list,
  // and build the lowercased path sets the "RunPod" filter checks against.
  const mergePodAssets = (
    localAssets: LocalModelAsset[],
    podAssets: LocalModelAsset[] | undefined
  ) => {
    if (!podAssets || podAssets.length === 0) return localAssets;
    const have = new Set(
      localAssets.map((asset) => asset.path.replaceAll("\\", "/").toLowerCase())
    );
    const extra = podAssets.filter(
      (asset) => !have.has(asset.path.replaceAll("\\", "/").toLowerCase())
    );
    if (extra.length === 0) return localAssets;
    return [...localAssets, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  };

  const checkpointAssets = mergePodAssets(
    localModels.checkpointAssets,
    runpodCatalog?.checkpoints
  );
  const loraAssets = mergePodAssets(localModels.loraAssets, runpodCatalog?.loras);
  const embeddingAssets = mergePodAssets(
    localModels.embeddingAssets,
    runpodCatalog?.embeddings
  );

  const toPathSet = (assets: LocalModelAsset[] | undefined) =>
    assets
      ? new Set(
          assets.map((asset) => asset.path.replaceAll("\\", "/").toLowerCase())
        )
      : null;
  const runpodPathSets = runpodCatalog
    ? {
        checkpoints: toPathSet(runpodCatalog.checkpoints),
        loras: toPathSet(runpodCatalog.loras),
        embeddings: toPathSet(runpodCatalog.embeddings),
      }
    : null;

  const addEmptyLora = () => {
    setParams({ loras: [...params.loras, { path: "", scale: DEFAULT_LORA_SCALE }] });
  };

  const addLora = () => {
    if (isLocal && loraAssets.length > 0) {
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
    if (isLocal && embeddingAssets.length > 0) {
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

  const selectedCheckpoint = findAsset(checkpointAssets, params.model_name);
  const selectedCheckpointMissingFiles =
    selectedCheckpoint?.missing_required_files ??
    (/anima/i.test(params.model_name) ? localModels.animaMissingRequiredFiles : []);

  useEffect(() => {
    if (
      localModels.checkpointAssets.length > 0 &&
      !params.model_name &&
      !selectedCheckpoint
    ) {
      setParams({ model_name: localModels.checkpointAssets[0].path });
    }
  }, [localModels.checkpointAssets, params.model_name, selectedCheckpoint, setParams]);

  const pickerAssets =
    pickerTarget?.type === "checkpoint"
      ? checkpointAssets
      : pickerTarget?.type === "lora" || pickerTarget?.type === "lora-new"
        ? loraAssets
        : pickerTarget?.type === "embedding" ||
            pickerTarget?.type === "embedding-new"
          ? embeddingAssets
          : [];

  const pickerRunpodPaths =
    pickerTarget?.type === "checkpoint"
      ? runpodPathSets?.checkpoints ?? null
      : pickerTarget?.type === "lora" || pickerTarget?.type === "lora-new"
        ? runpodPathSets?.loras ?? null
        : pickerTarget?.type === "embedding" ||
            pickerTarget?.type === "embedding-new"
          ? runpodPathSets?.embeddings ?? null
          : null;

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
      setParams({ loras: [...params.loras, { path: asset.path, scale: DEFAULT_LORA_SCALE }] });
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
          <FieldHelp label={ko ? "기본 모델" : "Base Model"} help={ko ? "이미지의 기본 화풍과 표현 능력을 결정하는 체크포인트입니다." : "The checkpoint that determines the image's base style and capabilities."} />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            onClick={() =>
              window.dispatchEvent(new Event("local-models-changed"))
            }
          >
            Refresh
          </Button>
        </div>
        {checkpointAssets.length > 0 ? (
          <AssetChoiceButton
            asset={selectedCheckpoint}
            placeholder="Select checkpoint"
            fallbackLabel={params.model_name}
            fallbackDescription="Imported checkpoint"
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
        {selectedCheckpointMissingFiles.length > 0 && (
          <div className="mt-2 rounded-md border border-dashed border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div className="font-semibold">
              This model requires missing local files.
            </div>
            <div className="mt-1 space-y-0.5">
              {selectedCheckpointMissingFiles.map((file) => (
                <div key={file} className="break-all font-mono">
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {(currentModel.supports.lora || currentModel.supports.embeddings) && (
        <div className="grid gap-4 border-t border-border pt-4">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <FieldHelp label="LoRA" help={ko ? "기본 모델에 특정 인물, 의상, 화풍이나 개념을 추가로 적용합니다. 강도로 영향 범위를 조절합니다." : "Adds a character, outfit, style, or concept to the base model; strength controls its influence."} />
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
                  {isLocal && loraAssets.length > 0 ? (
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_2rem]">
                      <AssetChoiceButton
                        asset={findAsset(loraAssets, lora.path)}
                        placeholder="Select LoRA"
                        fallbackLabel={lora.path}
                        fallbackDescription="Imported LoRA"
                        onClick={() => setPickerTarget({ type: "lora", index: i })}
                      />
                      <LoraScaleSlider
                        value={lora.scale}
                        onChange={(value) => updateLora(i, "scale", value)}
                        min={
                          isKreaSliderLora(
                            findAsset(loraAssets, lora.path),
                            lora.path
                          )
                            ? -5
                            : 0
                        }
                        max={
                          isKreaSliderLora(
                            findAsset(loraAssets, lora.path),
                            lora.path
                          )
                            ? 5
                            : 2
                        }
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
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_2rem]">
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
                        min={
                          isKreaSliderLora(
                            findAsset(loraAssets, lora.path),
                            lora.path
                          )
                            ? -5
                            : 0
                        }
                        max={
                          isKreaSliderLora(
                            findAsset(loraAssets, lora.path),
                            lora.path
                          )
                            ? 5
                            : 2
                        }
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
              <FieldHelp label={ko ? "임베딩" : "Embeddings"} help={ko ? "학습된 토큰을 프롬프트에 삽입해 특정 개념이나 네거티브 품질 보정을 적용합니다." : "Injects trained tokens into the prompt for specific concepts or negative-quality corrections."} />
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
                    {isLocal && embeddingAssets.length > 0 ? (
                      <AssetChoiceButton
                        asset={findAsset(embeddingAssets, embedding.path)}
                        placeholder="Select embedding"
                        fallbackLabel={embedding.path}
                        fallbackDescription={
                          embedding.tokens
                            ? `Imported embedding · ${embedding.tokens}`
                            : "Imported embedding"
                        }
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
        runpodMode={runpodMode}
        runpodPaths={pickerRunpodPaths}
        open={pickerTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPickerTarget(null);
        }}
        onSelect={handlePickerSelect}
      />
    </div>
  );
}
