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
}

interface ModelsResponse {
  checkpointAssets: ModelAsset[];
  loraAssets: ModelAsset[];
  embeddingAssets: ModelAsset[];
}

interface CivitaiImportFile {
  id: number;
  name: string;
  primary: boolean;
  sizeKB: number | null;
  sha256: string | null;
  format: string;
  precision: string;
  localPath: string | null;
  isDownloaded: boolean;
}

interface CivitaiImportModel {
  id: number;
  modelId: number;
  name: string;
  version: string;
  type: string;
  folder: string;
  baseModel: string;
  trainedWords: string[];
  nsfw: boolean;
  thumbnailUrl: string | null;
  files: CivitaiImportFile[];
}

const GROUPS = [
  { id: "checkpoints", label: "Checkpoints", folder: "checkpoints", key: "checkpointAssets" },
  { id: "loras", label: "LoRA", folder: "loras", key: "loraAssets" },
  { id: "embeddings", label: "Embeddings", folder: "embeddings", key: "embeddingAssets" },
] as const;

function ModelInitial({ asset }: { asset: ModelAsset }) {
  if (asset.thumbnail_url) {
    return (
      <img
        src={asset.thumbnail_url}
        alt={asset.name}
        className="h-16 w-16 rounded-md object-cover"
      />
    );
  }

  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold text-muted-foreground">
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

function CivitaiImportPanel({ onImported }: { onImported: () => void }) {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState<CivitaiImportModel | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");

  const selectedFile =
    model?.files.find((file) => file.id === selectedFileId) ??
    model?.files.find((file) => file.primary) ??
    model?.files[0] ??
    null;

  const inspect = async () => {
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/models/civitai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, action: "preview" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Civitai 조회 실패");

      setModel(data.model);
      const primaryFile =
        data.model.files.find((file: CivitaiImportFile) => file.primary) ??
        data.model.files[0] ??
        null;
      setSelectedFileId(primaryFile?.id ?? null);
    } catch (error) {
      setModel(null);
      setSelectedFileId(null);
      setMessage(error instanceof Error ? error.message : "Civitai 조회 실패");
    } finally {
      setLoading(false);
    }
  };

  const download = async () => {
    if (!selectedFile) return;

    setDownloading(true);
    setMessage("");
    try {
      const res = await fetch("/api/models/civitai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          action: "download",
          fileId: selectedFile.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "다운로드 실패");

      setModel(data.model);
      setMessage(
        data.result.downloaded
          ? `${data.result.folder}/${data.result.path} 저장 완료`
          : `${data.result.folder}/${data.result.path} 이미 보유 중`
      );
      onImported();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "다운로드 실패");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="mb-5 rounded-md border border-border p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">Civitai URL Import</h2>
        <p className="text-xs text-muted-foreground">
          civitai.red 또는 civitai.com 모델 URL을 붙여 넣어 metadata를 가져오고 ComfyUI 폴더로 다운로드합니다.
        </p>
      </div>

      <form
        className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_8rem]"
        onSubmit={(event) => {
          event.preventDefault();
          inspect();
        }}
      >
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://civitai.red/models/827184/wai-illustrious-sdxl?modelVersionId=1761560"
        />
        <Button type="submit" disabled={loading || !url.trim()}>
          {loading ? "Fetching..." : "Fetch"}
        </Button>
      </form>

      {model && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[6rem_minmax(0,1fr)]">
          {model.thumbnailUrl ? (
            <img
              src={model.thumbnailUrl}
              alt={model.name}
              className="h-24 w-24 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground">
              No Image
            </div>
          )}

          <div className="min-w-0 space-y-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-semibold">{model.name}</h3>
                <Badge variant="secondary">{model.version}</Badge>
                <Badge variant="outline">{model.type}</Badge>
                {model.nsfw && <Badge variant="destructive">NSFW</Badge>}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Base: {model.baseModel || "Unknown"} · Target: ComfyUI/models/{model.folder}
              </p>
              {model.trainedWords.length > 0 && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  Trigger: {model.trainedWords.join(", ")}
                </p>
              )}
            </div>

            {model.files.length > 0 ? (
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_8rem]">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  value={selectedFile?.id ?? ""}
                  onChange={(event) => setSelectedFileId(Number(event.target.value))}
                >
                  {model.files.map((file) => (
                    <option key={file.id} value={file.id}>
                      {file.name}
                      {file.primary ? " · primary" : ""}
                      {file.sizeKB ? ` · ${formatSize(file.sizeKB)}` : ""}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  onClick={download}
                  disabled={downloading || !selectedFile || selectedFile.isDownloaded}
                >
                  {selectedFile?.isDownloaded
                    ? "Downloaded"
                    : downloading
                      ? "Downloading..."
                      : "Download"}
                </Button>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
                다운로드 가능한 모델 파일이 없습니다.
              </div>
            )}

            {selectedFile && (
              <div className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                <div className="truncate">File: {selectedFile.name}</div>
                <div>
                  Status:{" "}
                  {selectedFile.isDownloaded
                    ? `보유 중 (${selectedFile.localPath})`
                    : "로컬 파일 없음"}
                </div>
                {[selectedFile.format, selectedFile.precision, selectedFile.sha256]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}

      {message && (
        <div className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      )}
    </section>
  );
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
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
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
          },
        }),
      });

      if (!res.ok) throw new Error("Failed to save model metadata");
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 rounded-md border border-border p-3 xl:grid-cols-[4rem_minmax(0,1fr)_8rem]">
      <ModelInitial asset={{ ...asset, name, thumbnail_url: thumbnailUrl || null }} />
      <div className="grid gap-2 xl:grid-cols-2">
        <div>
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
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">Thumbnail URL</Label>
          <Input value={thumbnailUrl} onChange={(e) => setThumbnailUrl(e.target.value)} className="h-8" />
        </div>
        <div className="truncate text-xs text-muted-foreground xl:col-span-2">
          {asset.path}
        </div>
      </div>
      <Button onClick={save} disabled={saving || !name.trim()} className="self-end">
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
    }),
    [models]
  );

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden">
      <header className="border-b border-border px-5 py-4">
        <h1 className="text-lg font-semibold">Model Management</h1>
        <p className="text-xs text-muted-foreground">
          체크포인트, LoRA, embedding의 표시 이름, 버전, 썸네일을 관리합니다.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto p-5">
        <CivitaiImportPanel onImported={() => setRefreshKey((key) => key + 1)} />

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
