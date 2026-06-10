"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface ModelAsset {
  path: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
  civitai_url: string | null;
  tags: string[];
}

interface ModelsResponse {
  checkpointAssets: ModelAsset[];
  loraAssets: ModelAsset[];
  embeddingAssets: ModelAsset[];
  vaeAssets: ModelAsset[];
}

interface CivitaiImportModel {
  id: number;
  modelId: number;
  name: string;
  version: string;
  type: string;
  civitaiUrl: string;
  baseModel: string;
  trainedWords: string[];
  tags: string[];
  nsfw: boolean;
  thumbnailUrl: string | null;
  primaryFile: {
    name: string;
    sizeKB: number | null;
    sha256: string | null;
    format: string;
    precision: string;
    inferredName: string;
  } | null;
}

const GROUPS = [
  { id: "checkpoints", label: "Checkpoints", folder: "checkpoints", key: "checkpointAssets" },
  { id: "loras", label: "LoRA", folder: "loras", key: "loraAssets" },
  { id: "embeddings", label: "Embeddings", folder: "embeddings", key: "embeddingAssets" },
  { id: "vae", label: "VAE", folder: "vae", key: "vaeAssets" },
] as const;

function ModelInitial({ asset }: { asset: ModelAsset }) {
  if (asset.thumbnail_url) {
    return (
      <img
        src={asset.thumbnail_url}
        alt={asset.name}
        className="h-20 w-20 rounded-md object-cover"
      />
    );
  }

  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold text-muted-foreground">
      {asset.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function formatSize(sizeKB: number | null) {
  if (!sizeKB) return "";
  if (sizeKB >= 1024 * 1024) return `${(sizeKB / 1024 / 1024).toFixed(2)} GB`;
  if (sizeKB >= 1024) return `${(sizeKB / 1024).toFixed(1)} MB`;
  return `${Math.round(sizeKB)} KB`;
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function EditableAsset({
  asset,
  folder,
  onSaved,
}: {
  asset: ModelAsset;
  folder: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [version, setVersion] = useState(asset.version);
  const [baseModel, setBaseModel] = useState(asset.base_model);
  const [thumbnailUrl, setThumbnailUrl] = useState(asset.thumbnail_url ?? "");
  const [civitaiUrl, setCivitaiUrl] = useState(asset.civitai_url ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [civitaiModel, setCivitaiModel] = useState<CivitaiImportModel | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingCivitai, setFetchingCivitai] = useState(false);
  const [message, setMessage] = useState("");
  const currentTags = parseTags(tags);

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const res = await fetch("/api/models", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `${folder}/${asset.path}`,
          metadata: {
            name,
            version,
            base_model: baseModel,
            thumbnail_url: thumbnailUrl || null,
            civitai_url: civitaiUrl || null,
            tags: parseTags(tags),
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to save model metadata");
      setMessage("저장 완료");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const applyCivitaiMetadata = async () => {
    setFetchingCivitai(true);
    setMessage("");
    try {
      const res = await fetch("/api/models/civitai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: civitaiUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Civitai 조회 실패");

      const model = data.model as CivitaiImportModel;
      setCivitaiModel(model);
      setName(model.name || model.primaryFile?.inferredName || name);
      setVersion(model.version || version);
      setBaseModel(model.baseModel || baseModel);
      setThumbnailUrl(model.thumbnailUrl ?? thumbnailUrl);
      setCivitaiUrl(model.civitaiUrl || civitaiUrl);
      setTags(model.tags.join(", "));
      setMessage("Civitai 정보가 입력되었습니다. 확인 후 저장하세요.");
    } catch (error) {
      setCivitaiModel(null);
      setMessage(error instanceof Error ? error.message : "Civitai 조회 실패");
    } finally {
      setFetchingCivitai(false);
    }
  };

  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-3 md:grid-cols-[5rem_minmax(0,1fr)] xl:grid-cols-[5rem_minmax(0,1fr)_6.5rem]">
      <div className="md:pt-1">
        <ModelInitial asset={{ ...asset, name, thumbnail_url: thumbnailUrl || null }} />
      </div>

      <div className="min-w-0 space-y-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold">{name}</h3>
            {version && <Badge variant="secondary">{version}</Badge>}
            {baseModel && <Badge variant="outline">{baseModel}</Badge>}
            {civitaiModel?.type && <Badge variant="outline">{civitaiModel.type}</Badge>}
            {civitaiModel?.nsfw && <Badge variant="destructive">NSFW</Badge>}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {asset.path}
          </div>
        </div>

        {currentTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {currentTags.slice(0, 12).map((tag) => (
              <Badge key={tag} variant="outline" className="h-5 rounded-md">
                {tag}
              </Badge>
            ))}
            {currentTags.length > 12 && (
              <Badge variant="secondary" className="h-5 rounded-md">
                +{currentTags.length - 12}
              </Badge>
            )}
          </div>
        )}

        {civitaiModel?.primaryFile?.name && (
          <div className="text-xs text-muted-foreground">
            {civitaiModel.primaryFile.name}
            {civitaiModel.primaryFile.sizeKB
              ? ` · ${formatSize(civitaiModel.primaryFile.sizeKB)}`
              : ""}
            {civitaiModel.trainedWords.length > 0
              ? ` · Trigger: ${civitaiModel.trainedWords.slice(0, 3).join(", ")}`
              : ""}
          </div>
        )}

        <div className="grid gap-2 xl:grid-cols-4">
          <div className="xl:col-span-2">
            <Label className="mb-1 block text-xs text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Version</Label>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} className="h-8" />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Base Model</Label>
            <Input value={baseModel} onChange={(e) => setBaseModel(e.target.value)} className="h-8" />
          </div>
          <div className="xl:col-span-2">
            <Label className="mb-1 block text-xs text-muted-foreground">Thumbnail URL</Label>
            <Input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} className="h-8" />
          </div>
          <div className="xl:col-span-2">
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="style, lycoris, artist"
              className="h-8"
            />
          </div>
        </div>

        <form
          className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_6.5rem]"
          onSubmit={(event) => {
            event.preventDefault();
            applyCivitaiMetadata();
          }}
        >
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Civitai URL</Label>
            <Input
              value={civitaiUrl}
              onChange={(e) => setCivitaiUrl(e.target.value)}
              placeholder="https://civitai.red/models/...?...modelVersionId=..."
              className="h-8"
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={fetchingCivitai || !civitaiUrl.trim()}
            className="self-end"
          >
            {fetchingCivitai ? "Fetching..." : "Fill"}
          </Button>
        </form>

        {message && (
          <div className="text-xs text-muted-foreground">
            {message}
          </div>
        )}
      </div>

      <Button onClick={save} disabled={saving || !name.trim()} className="self-start xl:mt-1">
        {saving ? "Saving..." : "Save"}
      </Button>
    </div>
  );
}

export function ModelManagement() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then(setModels)
      .catch(() => setModels(null));
  }, [refreshKey]);

  const counts = useMemo(
    () => ({
      checkpoints: models?.checkpointAssets.length ?? 0,
      loras: models?.loraAssets.length ?? 0,
      embeddings: models?.embeddingAssets.length ?? 0,
      vae: models?.vaeAssets.length ?? 0,
    }),
    [models]
  );

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <header className="border-b border-border px-5 py-4">
        <h1 className="text-lg font-semibold">Model Management</h1>
        <p className="text-xs text-muted-foreground">
          체크포인트, LoRA, embedding, VAE의 표시 이름, 버전, 썸네일을 관리합니다.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto p-5">
        <Tabs defaultValue="checkpoints">
          <TabsList>
            {GROUPS.map((group) => (
              <TabsTrigger key={group.id} value={group.id}>
                {group.label} {counts[group.id]}
              </TabsTrigger>
            ))}
          </TabsList>

          {GROUPS.map((group) => {
            const assets = models?.[group.key] ?? [];

            return (
              <TabsContent key={group.id} value={group.id} className="mt-4 space-y-3">
                {assets.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    등록된 {group.label} 파일이 없습니다.
                  </div>
                ) : (
                  assets.map((asset) => (
                    <EditableAsset
                      key={[
                        asset.path,
                        asset.name,
                        asset.version,
                        asset.base_model,
                        asset.thumbnail_url ?? "",
                        asset.civitai_url ?? "",
                        asset.tags.join(","),
                      ].join(":")}
                      asset={asset}
                      folder={group.folder}
                      onSaved={() => setRefreshKey((key) => key + 1)}
                    />
                  ))
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      </main>
    </div>
  );
}
