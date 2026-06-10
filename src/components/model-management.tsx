"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Edit3, ExternalLink, RefreshCw, Sparkles, Tags } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface EditableMetadata {
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
  civitai_url: string | null;
  tags: string[];
}

const GROUPS = [
  { id: "checkpoints", label: "Checkpoints", folder: "checkpoints", key: "checkpointAssets" },
  { id: "loras", label: "LoRA", folder: "loras", key: "loraAssets" },
  { id: "embeddings", label: "Embeddings", folder: "embeddings", key: "embeddingAssets" },
  { id: "vae", label: "VAE", folder: "vae", key: "vaeAssets" },
] as const;

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function assetKey(asset: ModelAsset) {
  return [
    asset.path,
    asset.name,
    asset.version,
    asset.base_model,
    asset.thumbnail_url ?? "",
    asset.civitai_url ?? "",
    asset.tags.join(","),
  ].join(":");
}

function ModelThumb({
  asset,
  className = "",
}: {
  asset: ModelAsset;
  className?: string;
}) {
  if (asset.thumbnail_url) {
    return (
      <img
        src={asset.thumbnail_url}
        alt={asset.name}
        className={`rounded-md object-cover ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-md border border-primary/15 bg-secondary text-sm font-bold text-secondary-foreground ${className}`}
    >
      {asset.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function TagPill({
  active = false,
  children,
  onClick,
}: {
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "bg-card text-muted-foreground ring-1 ring-border hover:bg-secondary hover:text-secondary-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ModelCard({
  asset,
  onEdit,
}: {
  asset: ModelAsset;
  onEdit: () => void;
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTags = showAllTags ? asset.tags : asset.tags.slice(0, 4);

  return (
    <article className="group grid min-h-40 grid-cols-[6rem_minmax(0,1fr)] gap-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md focus-within:border-primary/25 focus-within:shadow-md">
      <ModelThumb asset={asset} className="h-28 w-full shadow-sm" />

      <div className="flex min-w-0 flex-col">
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold leading-5 text-foreground">
                {asset.name}
              </h3>
              <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                {asset.path}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2 opacity-0 shadow-none transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={onEdit}
            >
              <Edit3 className="h-4 w-4" />
              <span className="ml-1 hidden sm:inline">Edit</span>
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {asset.version && (
              <Badge
                variant="secondary"
                className="rounded-md border border-primary/10 bg-secondary text-secondary-foreground"
              >
                {asset.version}
              </Badge>
            )}
            {asset.base_model && (
              <Badge
                variant="outline"
                className="rounded-md border-accent/35 bg-accent/15 text-accent-foreground"
              >
                {asset.base_model}
              </Badge>
            )}
            {asset.civitai_url && (
              <Badge
                variant="outline"
                className="rounded-md border-primary/25 bg-primary/10 text-primary"
              >
                Civitai
              </Badge>
            )}
          </div>
        </div>

        <div className="mt-auto pt-3">
          {visibleTags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="h-5 rounded-md bg-background text-[10px]"
                >
                  {tag}
                </Badge>
              ))}
              {asset.tags.length > visibleTags.length && (
                <button
                  type="button"
                  onClick={() => setShowAllTags(true)}
                  className="h-5 rounded-md bg-primary/10 px-1.5 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/15"
                >
                  +{asset.tags.length - visibleTags.length}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Tags className="h-3.5 w-3.5" />
              No tags
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/70 p-10 text-center text-sm font-medium text-muted-foreground">
      No {label} files found.
    </div>
  );
}

function ModelEditDialog({
  asset,
  folder,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: ModelAsset;
  folder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [version, setVersion] = useState(asset.version);
  const [baseModel, setBaseModel] = useState(asset.base_model);
  const [thumbnailUrl, setThumbnailUrl] = useState(asset.thumbnail_url ?? "");
  const [civitaiUrl, setCivitaiUrl] = useState(asset.civitai_url ?? "");
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [loadingCivitai, setLoadingCivitai] = useState(false);
  const [message, setMessage] = useState("");

  const saveMetadata = async (metadata: EditableMetadata) => {
    const res = await fetch("/api/models", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: `${folder}/${asset.path}`,
        metadata,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to save model metadata");
    }
  };

  const currentMetadata = (): EditableMetadata => ({
    name,
    version,
    base_model: baseModel,
    thumbnail_url: thumbnailUrl || null,
    civitai_url: civitaiUrl || null,
    tags: parseTags(tags),
  });

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      await saveMetadata(currentMetadata());
      setMessage("Saved.");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const loadCivitaiInfo = async () => {
    const trimmedUrl = civitaiUrl.trim();
    if (!trimmedUrl) {
      setMessage("Enter a Civitai URL first.");
      return;
    }

    setLoadingCivitai(true);
    setMessage("");
    try {
      const res = await fetch(
        `/api/models/civitai?url=${encodeURIComponent(trimmedUrl)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as {
        name?: string;
        version?: string;
        base_model?: string;
        thumbnail_url?: string | null;
        tags?: string[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "Failed to load Civitai info");
      }

      const metadata: EditableMetadata = {
        name: data.name || name,
        version: data.version || version,
        base_model: data.base_model || baseModel,
        thumbnail_url: data.thumbnail_url || thumbnailUrl || null,
        civitai_url: trimmedUrl,
        tags: data.tags ?? parseTags(tags),
      };

      setName(metadata.name);
      setVersion(metadata.version);
      setBaseModel(metadata.base_model);
      setThumbnailUrl(metadata.thumbnail_url ?? "");
      setTags(metadata.tags.join(", "));

      await saveMetadata(metadata);
      setMessage("Loaded and saved Civitai metadata.");
      onSaved();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Failed to load Civitai metadata."
      );
    } finally {
      setLoadingCivitai(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-3xl">
        <DialogHeader className="border-b border-border bg-secondary/50 px-5 py-4">
          <DialogTitle>Edit model metadata</DialogTitle>
          <DialogDescription className="truncate">{asset.path}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(90vh-9rem)] gap-5 overflow-y-auto bg-background/70 px-5 py-4 md:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <ModelThumb
              asset={{ ...asset, name, thumbnail_url: thumbnailUrl || null }}
              className="aspect-square w-full shadow-sm"
            />
            {asset.civitai_url && (
              <a
                href={asset.civitai_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Civitai
              </a>
            )}
          </div>

          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem]">
              <div>
                <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Name
                </Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                  Version
                </Label>
                <Input value={version} onChange={(e) => setVersion(e.target.value)} />
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Base Model
              </Label>
              <Input value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Thumbnail URL
              </Label>
              <Input
                value={thumbnailUrl}
                onChange={(e) => setThumbnailUrl(e.target.value)}
              />
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Tags
              </Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="style, character, realism"
              />
            </div>

            <div>
              <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Civitai URL
              </Label>
              <div className="flex gap-2">
                <Input
                  value={civitaiUrl}
                  onChange={(e) => setCivitaiUrl(e.target.value)}
                  placeholder="https://civitai.com/models/..."
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={loadCivitaiInfo}
                  disabled={loadingCivitai || saving || !civitaiUrl.trim()}
                >
                  {loadingCivitai ? "Loading" : "Load info"}
                </Button>
              </div>
            </div>

            {message && (
              <div className="rounded-md border border-primary/15 bg-secondary/70 px-3 py-2 text-xs font-medium text-secondary-foreground">
                {message}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving || loadingCivitai}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={saving || loadingCivitai || !name.trim()}
          >
            {saving ? "Saving" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ModelManagement() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [selectedTag, setSelectedTag] = useState("all");
  const [editing, setEditing] = useState<{
    asset: ModelAsset;
    folder: string;
  } | null>(null);

  const refreshModels = useCallback(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setModels(data);
        setError("");
      })
      .catch((err) => {
        setModels(null);
        setError(err instanceof Error ? err.message : "Failed to load models");
      });
  }, []);

  useEffect(() => {
    refreshModels();
  }, [refreshKey, refreshModels]);

  const counts = useMemo(
    () => ({
      all:
        (models?.checkpointAssets.length ?? 0) +
        (models?.loraAssets.length ?? 0) +
        (models?.embeddingAssets.length ?? 0) +
        (models?.vaeAssets.length ?? 0),
      checkpoints: models?.checkpointAssets.length ?? 0,
      loras: models?.loraAssets.length ?? 0,
      embeddings: models?.embeddingAssets.length ?? 0,
      vae: models?.vaeAssets.length ?? 0,
    }),
    [models]
  );

  const allTags = useMemo(() => {
    const tags = GROUPS.flatMap((group) =>
      (models?.[group.key] ?? []).flatMap((asset) => asset.tags)
    );

    return Array.from(new Set(tags)).sort((a, b) => a.localeCompare(b));
  }, [models]);

  const assetGroups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        assets: (models?.[group.key] ?? []).filter((asset) =>
          selectedTag === "all" ? true : asset.tags.includes(selectedTag)
        ),
      })),
    [models, selectedTag]
  );

  const allAssets = useMemo(
    () =>
      assetGroups.flatMap((group) =>
        group.assets.map((asset) => ({
          asset,
          folder: group.folder,
        }))
      ),
    [assetGroups]
  );

  return (
    <div className="flex h-screen flex-1 flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-card">
        <div className="flex items-start justify-between gap-4 px-6 py-5">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-foreground shadow-sm">
                <Sparkles className="h-4 w-4" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-foreground">
                Model Management
              </h1>
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              Manage local checkpoints, LoRA, embeddings, and VAE metadata.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshModels}
            className="shrink-0"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        <Tabs defaultValue="all">
          <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
            <TabsList>
              <TabsTrigger value="all">ALL {counts.all}</TabsTrigger>
              {GROUPS.map((group) => (
                <TabsTrigger key={group.id} value={group.id}>
                  {group.label} {counts[group.id]}
                </TabsTrigger>
              ))}
            </TabsList>

            {allTags.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                <span className="mr-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Tags
                </span>
                <TagPill active={selectedTag === "all"} onClick={() => setSelectedTag("all")}>
                  ALL
                </TagPill>
                {allTags.map((tag) => (
                  <TagPill
                    key={tag}
                    active={selectedTag === tag}
                    onClick={() => setSelectedTag(tag)}
                  >
                    {tag}
                  </TagPill>
                ))}
              </div>
            )}
          </div>

          <TabsContent value="all" className="mt-4">
            {allAssets.length === 0 ? (
              <EmptyState label="model" />
            ) : (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {allAssets.map(({ asset, folder }) => (
                  <ModelCard
                    key={`${folder}:${assetKey(asset)}`}
                    asset={asset}
                    onEdit={() => setEditing({ asset, folder })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {assetGroups.map((group) => (
            <TabsContent key={group.id} value={group.id} className="mt-4">
              {group.assets.length === 0 ? (
                <EmptyState label={group.label} />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {group.assets.map((asset) => (
                    <ModelCard
                      key={assetKey(asset)}
                      asset={asset}
                      onEdit={() => setEditing({ asset, folder: group.folder })}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {editing && (
        <ModelEditDialog
          key={assetKey(editing.asset)}
          asset={editing.asset}
          folder={editing.folder}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={() => setRefreshKey((key) => key + 1)}
        />
      )}
    </div>
  );
}
