"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FileDown,
  FileUp,
  Heart,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Tags,
  Trash2,
  X,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { ModelMediaThumbnail } from "@/components/model-media-thumbnail";
import { CopyLinkButton } from "@/components/copy-link-button";
import { ModelRiskBadge, type ModelRisk } from "@/components/model-risk-badge";
import { LicenseBadges } from "@/components/civitai-license-badges";
import type { CivitaiLicenseInfo } from "@/lib/types";

interface ModelAsset {
  path: string;
  folder?: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
  civitai_url: string | null;
  source_url: string | null;
  tags: string[];
  risk?: ModelRisk | null;
  license?: CivitaiLicenseInfo | null;
}

interface ModelsResponse {
  checkpointAssets: ModelAsset[];
  loraAssets: ModelAsset[];
  embeddingAssets: ModelAsset[];
  vaeAssets: ModelAsset[];
  upscaleModelAssets: ModelAsset[];
  videoModelAssets: ModelAsset[];
  catalog: Record<string, EditableMetadata>;
}

interface EditableMetadata {
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
  civitai_url: string | null;
  source_url: string | null;
  tags: string[];
  risk?: ModelRisk | null;
  license?: CivitaiLicenseInfo | null;
}

interface SourceInfo {
  repo_id?: string;
  name?: string;
  author?: string;
  sha?: string;
  last_modified?: string;
  pipeline_tag?: string;
  library_name?: string;
  downloads?: number | null;
  likes?: number | null;
  base_model?: string;
  license?: string;
  datasets?: string[];
  tags?: string[];
  trigger_words?: string[];
  description?: string;
  files?: {
    name: string;
    size: number | null;
  }[];
  file_size_total?: number | null;
  source_url?: string;
  error?: string;
}

const GROUPS = [
  { id: "checkpoints", label: "Checkpoints", folder: "checkpoints", key: "checkpointAssets" },
  { id: "video_models", label: "Video Models", folder: "checkpoints", key: "videoModelAssets" },
  { id: "loras", label: "LoRA", folder: "loras", key: "loraAssets" },
  { id: "embeddings", label: "Embeddings", folder: "embeddings", key: "embeddingAssets" },
  { id: "vae", label: "VAE", folder: "vae", key: "vaeAssets" },
  { id: "upscale_models", label: "Upscalers", folder: "upscale_models", key: "upscaleModelAssets" },
] as const;

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function assetKey(asset: ModelAsset) {
  return [
    asset.folder ?? "",
    asset.path,
    asset.name,
    asset.version,
    asset.base_model,
    asset.thumbnail_url ?? "",
    asset.civitai_url ?? "",
    asset.source_url ?? "",
    asset.tags.join(","),
  ].join(":");
}

function catalogKey(folder: string, asset: ModelAsset) {
  return `${folder}/${asset.path}`;
}

function metadataFromAsset(asset: ModelAsset): EditableMetadata {
  return {
    name: asset.name,
    version: asset.version,
    base_model: asset.base_model,
    thumbnail_url: asset.thumbnail_url,
    civitai_url: asset.civitai_url,
    source_url: asset.source_url,
    tags: asset.tags,
  };
}

function getSourceUrl(asset: Pick<ModelAsset, "source_url" | "civitai_url">) {
  return asset.source_url || asset.civitai_url || "";
}

function sourceProvider(url: string) {
  if (/^https?:\/\/([^/]+\.)?huggingface\.co\//i.test(url)) return "huggingface";
  if (/^https?:\/\/([^/]+\.)?civitai\.(com|red)\//i.test(url)) return "civitai";
  return url ? "source" : "";
}

function sourceLabel(url: string) {
  const provider = sourceProvider(url);
  if (provider === "huggingface") return "Hugging Face";
  if (provider === "civitai") return "Civitai";
  return "Source";
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 20000
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function isCivitaiUrl(url: string) {
  return sourceProvider(url) === "civitai";
}

function formatCount(value: number | null | undefined) {
  if (typeof value !== "number") return "0";
  return new Intl.NumberFormat("en").format(value);
}

function formatBytes(value: number | null | undefined) {
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function ModelThumb({
  asset,
  className = "",
}: {
  asset: ModelAsset;
  className?: string;
}) {
  return (
    <ModelMediaThumbnail
      src={asset.thumbnail_url}
      alt={asset.name}
      fallback={asset.name.slice(0, 2).toUpperCase()}
      className={className}
      fallbackClassName="border-primary/15 bg-secondary text-sm font-bold text-secondary-foreground"
    />
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
  onView,
  selecting = false,
  selected = false,
  onToggleSelect,
}: {
  asset: ModelAsset;
  onView: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  const visibleTags = showAllTags ? asset.tags : asset.tags.slice(0, 4);
  const sourceUrl = getSourceUrl(asset);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={selecting ? onToggleSelect : onView}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (selecting) {
            onToggleSelect?.();
          } else {
            onView();
          }
        }
      }}
      className={`group relative grid min-h-40 cursor-pointer grid-cols-[6rem_minmax(0,1fr)] gap-3 rounded-lg border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md focus:outline-none focus-visible:border-primary/25 focus-visible:ring-3 focus-visible:ring-ring/20 focus-within:border-primary/25 focus-within:shadow-md ${
        selected
          ? "border-primary ring-3 ring-primary/15"
          : "border-border"
      }`}
    >
      {selecting && (
        <div className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card/95 p-1 shadow-sm">
          <input
            type="checkbox"
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onChange={onToggleSelect}
            aria-label={`Select ${asset.name}`}
            className="block h-4 w-4 accent-primary"
          />
        </div>
      )}
      <ModelThumb asset={asset} className="h-28 w-full shadow-sm" />

      <div className="flex min-w-0 flex-col">
        <div className="min-w-0">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <h3 className="truncate text-sm font-bold leading-5 text-foreground">
                  {asset.name}
                </h3>
                <ModelRiskBadge risk={asset.risk} size={14} className="shrink-0" />
              </div>
              <p className="mt-1 truncate text-xs font-medium text-muted-foreground">
                {asset.path}
              </p>
            </div>
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
            {sourceUrl && (
              <Badge
                variant="outline"
                className="rounded-md border-primary/25 bg-primary/10 text-primary"
              >
                {sourceLabel(sourceUrl)}
              </Badge>
            )}
          </div>

          {asset.license && (
            <LicenseBadges license={asset.license} language="ko" />
          )}
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
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowAllTags(true);
                  }}
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

          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                if (selecting) {
                  onToggleSelect?.();
                } else {
                  onView();
                }
              }}
            >
              {selecting ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {selected ? "Selected" : "Select"}
                </>
              ) : (
                <>
                  <Info className="h-3.5 w-3.5" />
                  Details
                </>
              )}
            </Button>
            {sourceUrl && (
              <>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open
                </a>
                <CopyLinkButton
                  url={sourceUrl}
                  showLabel
                  stopPropagation
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                />
              </>
            )}
          </div>
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

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  if (!value) return null;

  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-bold uppercase text-muted-foreground">
        {label}
      </div>
      <div className="min-w-0 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function CatalogImportDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [jsonText, setJsonText] = useState("");
  const [importingMode, setImportingMode] = useState<"merge" | "replace" | null>(
    null
  );
  const [message, setMessage] = useState("");

  const importCatalog = async (mode: "merge" | "replace") => {
    setImportingMode(mode);
    setMessage("");

    try {
      const catalog = JSON.parse(jsonText) as unknown;
      const res = await fetchWithTimeout("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, catalog }),
      });
      const data = (await res.json()) as {
        imported?: number;
        total?: number;
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "Failed to import model metadata.");
      }

      setMessage(
        `${data.imported ?? 0} entries imported. Total ${data.total ?? 0}.`
      );
      onImported();
    } catch (error) {
      setMessage(
        error instanceof SyntaxError
          ? "Invalid JSON."
          : error instanceof Error
            ? error.message
            : "Failed to import model metadata."
      );
    } finally {
      setImportingMode(null);
    }
  };

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setMessage("");
    setJsonText(await file.text());
    event.target.value = "";
  };

  const busy = Boolean(importingMode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-3xl">
        <DialogHeader className="border-b border-border bg-secondary/50 px-5 py-4">
          <DialogTitle>Import model metadata</DialogTitle>
          <DialogDescription>
            Paste a JSON catalog keyed by model path, or load a JSON file.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 bg-background/70 px-5 py-4">
          <div>
            <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
              JSON
            </Label>
            <Textarea
              value={jsonText}
              onChange={(event) => setJsonText(event.target.value)}
              className="min-h-72 resize-y font-mono text-xs"
              spellCheck={false}
              placeholder={`{
  "checkpoints/example.safetensors": {
    "name": "Example",
    "version": "v1",
    "base_model": "Illustrious",
    "thumbnail_url": null,
    "civitai_url": null,
    "source_url": null,
    "tags": ["style"]
  }
}`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Label className="inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-sm font-semibold shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary hover:text-secondary-foreground">
              <FileUp className="h-4 w-4" />
              JSON 선택
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={loadFile}
                disabled={busy}
              />
            </Label>

            {message && (
              <div className="min-w-0 rounded-md border border-primary/15 bg-secondary/70 px-3 py-2 text-xs font-medium text-secondary-foreground">
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
            disabled={busy}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => importCatalog("merge")}
            disabled={busy || !jsonText.trim()}
          >
            {importingMode === "merge" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileUp className="h-4 w-4" />
            )}
            추가하기
          </Button>
          <Button
            type="button"
            onClick={() => importCatalog("replace")}
            disabled={busy || !jsonText.trim()}
          >
            {importingMode === "replace" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            교체하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelDetailsDialog({
  asset,
  folder,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  asset: ModelAsset;
  folder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(asset.name);
  const [version, setVersion] = useState(asset.version);
  const [baseModel, setBaseModel] = useState(asset.base_model);
  const [thumbnailUrl, setThumbnailUrl] = useState(asset.thumbnail_url ?? "");
  const [sourceUrl, setSourceUrl] = useState(getSourceUrl(asset));
  const [tags, setTags] = useState(asset.tags.join(", "));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const provider = sourceProvider(sourceUrl);
  const [sourceInfo, setSourceInfo] = useState<SourceInfo | null>(null);
  const [message, setMessage] = useState("");
  const [editMessage, setEditMessage] = useState("");

  const saveMetadata = async (metadata: EditableMetadata) => {
    const res = await fetchWithTimeout("/api/models", {
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
    civitai_url: isCivitaiUrl(sourceUrl) ? sourceUrl : null,
    source_url: sourceUrl || null,
    tags: parseTags(tags),
  });

  const save = async () => {
    setSaving(true);
    setEditMessage("");
    try {
      await saveMetadata(currentMetadata());
      setEditMessage("Saved.");
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const deleteModel = async () => {
    setDeleting(true);
    setEditMessage("");
    try {
      const res = await fetchWithTimeout("/api/models", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder,
          path: asset.path,
        }),
      });
      const data = (await res.json()) as { error?: string };

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete model");
      }

      setConfirmDeleteOpen(false);
      onDeleted();
      onOpenChange(false);
    } catch (error) {
      setEditMessage(error instanceof Error ? error.message : "Failed to delete model.");
    } finally {
      setDeleting(false);
    }
  };

  const loadSourceInfo = async () => {
    const trimmedUrl = sourceUrl.trim();
    if (!trimmedUrl) {
      setEditMessage("Enter a source URL first.");
      return;
    }

    const currentProvider = sourceProvider(trimmedUrl);
    const endpoint =
      currentProvider === "huggingface"
        ? "/api/models/huggingface"
        : currentProvider === "civitai"
          ? "/api/models/civitai"
          : "";

    if (!endpoint) {
      setEditMessage("Only Hugging Face and Civitai URLs can be loaded.");
      return;
    }

    setLoadingSource(true);
    setEditMessage("");
    try {
      const res = await fetchWithTimeout(
        `${endpoint}?url=${encodeURIComponent(trimmedUrl)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as {
        name?: string;
        version?: string;
        base_model?: string;
        thumbnail_url?: string | null;
        tags?: string[];
        trigger_words?: string[];
        error?: string;
      };

      if (!res.ok) {
        throw new Error(data.error || "Failed to load source info");
      }

      const importedTags = Array.from(
        new Set([...(data.trigger_words ?? []), ...(data.tags ?? parseTags(tags))])
      );
      const metadata: EditableMetadata = {
        name: data.name || name,
        version: data.version || version,
        base_model: data.base_model || baseModel,
        thumbnail_url: data.thumbnail_url || thumbnailUrl || null,
        civitai_url: currentProvider === "civitai" ? trimmedUrl : null,
        source_url: trimmedUrl,
        tags: importedTags,
      };

      setName(metadata.name);
      setVersion(metadata.version);
      setBaseModel(metadata.base_model);
      setThumbnailUrl(metadata.thumbnail_url ?? "");
      setSourceUrl(metadata.source_url ?? "");
      setTags(metadata.tags.join(", "));

      await saveMetadata(metadata);
      setEditMessage(`Loaded and saved ${sourceLabel(trimmedUrl)} metadata.`);
      onSaved();
    } catch (error) {
      setEditMessage(
        error instanceof Error && error.name === "AbortError"
          ? "Timed out while loading source metadata."
          : error instanceof Error
            ? error.message
            : "Failed to load source metadata."
      );
    } finally {
      setLoadingSource(false);
    }
  };

  useEffect(() => {
    if (!open || provider !== "huggingface" || !sourceUrl) {
      return;
    }

    let cancelled = false;

    fetch(`/api/models/huggingface?url=${encodeURIComponent(sourceUrl)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const data = (await res.json()) as SourceInfo;

        if (!res.ok) {
          throw new Error(data.error || "Failed to load Hugging Face info");
        }

        if (!cancelled) {
          setSourceInfo(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "Failed to load Hugging Face metadata."
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, provider, sourceUrl]);

  const detailTags = sourceInfo?.tags?.length ? sourceInfo.tags : parseTags(tags);
  const triggerWords = sourceInfo?.trigger_words ?? [];
  const files = sourceInfo?.files?.slice(0, 8) ?? [];
  const loading = provider === "huggingface" && !sourceInfo && !message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-5xl">
        <DialogHeader className="border-b border-border bg-secondary/50 px-5 py-4">
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription className="truncate">{asset.path}</DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(90vh-8rem)] gap-5 overflow-y-auto bg-background/70 px-5 py-4 md:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <ModelThumb
              asset={{ ...asset, name, thumbnail_url: thumbnailUrl || null }}
              className="aspect-square w-full shadow-sm"
            />
            {sourceUrl && (
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-2 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open {sourceLabel(sourceUrl)}
                </a>
                <CopyLinkButton
                  url={sourceUrl}
                  showLabel
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-2 py-2 text-xs font-semibold text-muted-foreground hover:border-primary/30 hover:text-primary"
                />
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="grid gap-3 rounded-md border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-3">
              <MetadataRow label="Name" value={sourceInfo?.name || name} />
              <MetadataRow label="Version" value={version} />
              <MetadataRow
                label="Base Model"
                value={sourceInfo?.base_model || baseModel}
              />
              <MetadataRow label="Provider" value={sourceUrl ? sourceLabel(sourceUrl) : "Local"} />
              <MetadataRow label="Author" value={sourceInfo?.author} />
              <MetadataRow label="Pipeline" value={sourceInfo?.pipeline_tag} />
              <MetadataRow label="Library" value={sourceInfo?.library_name} />
              <MetadataRow label="License" value={sourceInfo?.license} />
              <MetadataRow
                label="Last Modified"
                value={
                  sourceInfo?.last_modified
                    ? new Date(sourceInfo.last_modified).toLocaleString()
                    : ""
                }
              />
            </div>

            {provider === "huggingface" && (
              <div className="rounded-md border border-border bg-card p-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold">Hugging Face info</h3>
                  {loading && (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading
                    </span>
                  )}
                </div>

                {message ? (
                  <div className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
                    {message}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="rounded-md">
                        <Download className="mr-1 h-3.5 w-3.5" />
                        {formatCount(sourceInfo?.downloads)} downloads
                      </Badge>
                      <Badge variant="outline" className="rounded-md">
                        <Heart className="mr-1 h-3.5 w-3.5" />
                        {formatCount(sourceInfo?.likes)} likes
                      </Badge>
                      {formatBytes(sourceInfo?.file_size_total) && (
                        <Badge variant="outline" className="rounded-md">
                          {formatBytes(sourceInfo?.file_size_total)}
                        </Badge>
                      )}
                    </div>

                    {sourceInfo?.description && (
                      <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {sourceInfo.description}
                      </p>
                    )}

                    {triggerWords.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">
                          Trigger Words
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {triggerWords.map((word) => (
                            <Badge key={word} variant="secondary" className="rounded-md">
                              {word}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {files.length > 0 && (
                      <div>
                        <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">
                          Files
                        </div>
                        <div className="grid gap-1.5">
                          {files.map((file) => (
                            <div
                              key={file.name}
                              className="flex min-w-0 items-center justify-between gap-3 rounded-md bg-background px-2 py-1.5 text-xs"
                            >
                              <span className="truncate font-medium">{file.name}</span>
                              <span className="shrink-0 text-muted-foreground">
                                {formatBytes(file.size)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <section className="rounded-md border border-border bg-card p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold">Metadata</h3>
                <span className="text-xs font-medium text-muted-foreground">
                  Update local catalog fields
                </span>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem]">
                  <div>
                    <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                      Version
                    </Label>
                    <Input
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <Label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                    Base Model
                  </Label>
                  <Input
                    value={baseModel}
                    onChange={(e) => setBaseModel(e.target.value)}
                  />
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
                    Source URL
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://huggingface.co/owner/model or https://civitai.com/models/..."
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      onClick={loadSourceInfo}
                      disabled={loadingSource || saving || !sourceUrl.trim()}
                    >
                      {loadingSource ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Loading
                        </span>
                      ) : (
                        "Load info"
                      )}
                    </Button>
                  </div>
                </div>

                {editMessage && (
                  <div className="rounded-md border border-primary/15 bg-secondary/70 px-3 py-2 text-xs font-medium text-secondary-foreground">
                    {editMessage}
                  </div>
                )}
              </div>
            </section>

            {detailTags.length > 0 && (
              <div>
                <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detailTags.map((tag) => (
                    <Badge key={tag} variant="outline" className="rounded-md bg-card">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="justify-between gap-2 sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={saving || loadingSource || deleting}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || loadingSource || deleting}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={saving || loadingSource || deleting || !name.trim()}
            >
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent className="border border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete model file?</DialogTitle>
            <DialogDescription>
              This will permanently remove {asset.path} from ComfyUI models and remove its local catalog metadata.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={deleteModel}
              disabled={deleting}
            >
              {deleting ? "Deleting" : "Delete file"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

export function ModelManagement() {
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [catalogImportOpen, setCatalogImportOpen] = useState(false);
  const [savingCatalog, setSavingCatalog] = useState(false);
  const [exportSelectionMode, setExportSelectionMode] = useState(false);
  const [selectedCatalogKeys, setSelectedCatalogKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedTag, setSelectedTag] = useState("all");
  const [viewing, setViewing] = useState<{
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

  const saveSelectedCatalogJson = async () => {
    setSavingCatalog(true);
    setError("");

    try {
      const selectedCatalog = catalogAssets.reduce<Record<string, EditableMetadata>>(
        (catalog, { asset, folder }) => {
          const key = catalogKey(folder, asset);

          if (selectedCatalogKeys.has(key)) {
            catalog[key] = models?.catalog?.[key] ?? metadataFromAsset(asset);
          }

          return catalog;
        },
        {}
      );

      if (Object.keys(selectedCatalog).length === 0) {
        throw new Error("Select at least one model metadata entry.");
      }

      const blob = new Blob([JSON.stringify(selectedCatalog, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);

      link.href = url;
      link.download = `model-catalog-selected-${date}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportSelectionMode(false);
      setSelectedCatalogKeys(new Set());
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to save model metadata."
      );
    } finally {
      setSavingCatalog(false);
    }
  };

  const startCatalogExport = () => {
    setError("");
    setExportSelectionMode(true);
    setSelectedCatalogKeys(new Set());
  };

  const cancelCatalogExport = () => {
    setError("");
    setExportSelectionMode(false);
    setSelectedCatalogKeys(new Set());
  };

  const toggleCatalogSelection = (key: string) => {
    setSelectedCatalogKeys((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  };

  useEffect(() => {
    refreshModels();
  }, [refreshKey, refreshModels]);

  const counts = useMemo(
    () => ({
      all:
        (models?.checkpointAssets.length ?? 0) +
        (models?.loraAssets.length ?? 0) +
        (models?.embeddingAssets.length ?? 0) +
        (models?.vaeAssets.length ?? 0) +
        (models?.upscaleModelAssets.length ?? 0) +
        (models?.videoModelAssets.length ?? 0),
      checkpoints: models?.checkpointAssets.length ?? 0,
      video_models: models?.videoModelAssets.length ?? 0,
      loras: models?.loraAssets.length ?? 0,
      embeddings: models?.embeddingAssets.length ?? 0,
      vae: models?.vaeAssets.length ?? 0,
      upscale_models: models?.upscaleModelAssets.length ?? 0,
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

  const catalogAssets = GROUPS.flatMap((group) =>
    (models?.[group.key] ?? []).map((asset) => ({
      asset,
      folder: asset.folder ?? group.folder,
    }))
  );

  const allAssets = useMemo(
    () =>
      assetGroups.flatMap((group) =>
        group.assets.map((asset) => ({
          asset,
          folder: asset.folder ?? group.folder,
        }))
      ),
    [assetGroups]
  );
  const selectedCatalogCount = selectedCatalogKeys.size;

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
              Manage local image models, video models, LoRA, embeddings, VAE, and upscaler metadata.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {exportSelectionMode ? (
              <>
                <Badge variant="secondary" className="h-7 rounded-md px-2.5">
                  선택 {selectedCatalogCount}
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelCatalogExport}
                  disabled={savingCatalog}
                >
                  <X className="h-4 w-4" />
                  취소
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={saveSelectedCatalogJson}
                  disabled={savingCatalog || selectedCatalogCount === 0}
                >
                  {savingCatalog ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                  확인
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={startCatalogExport}
                disabled={savingCatalog}
              >
                <FileDown className="h-4 w-4" />
                JSON 내보내기
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCatalogImportOpen(true)}
            >
              <FileUp className="h-4 w-4" />
              JSON 불러오기
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={refreshModels}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
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
                    selecting={exportSelectionMode}
                    selected={selectedCatalogKeys.has(catalogKey(folder, asset))}
                    onToggleSelect={() =>
                      toggleCatalogSelection(catalogKey(folder, asset))
                    }
                    onView={() => setViewing({ asset, folder })}
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
                      selecting={exportSelectionMode}
                      selected={selectedCatalogKeys.has(
                        catalogKey(asset.folder ?? group.folder, asset)
                      )}
                      onToggleSelect={() =>
                        toggleCatalogSelection(
                          catalogKey(asset.folder ?? group.folder, asset)
                        )
                      }
                      onView={() =>
                        setViewing({ asset, folder: asset.folder ?? group.folder })
                      }
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>

      {viewing && (
        <ModelDetailsDialog
          key={`${viewing.folder}:${assetKey(viewing.asset)}`}
          asset={viewing.asset}
          folder={viewing.folder}
          open
          onOpenChange={(open) => {
            if (!open) setViewing(null);
          }}
          onSaved={() => {
            setRefreshKey((key) => key + 1);
          }}
          onDeleted={() => {
            setViewing(null);
            setRefreshKey((key) => key + 1);
          }}
        />
      )}
      <CatalogImportDialog
        open={catalogImportOpen}
        onOpenChange={setCatalogImportOpen}
        onImported={() => setRefreshKey((key) => key + 1)}
      />
    </div>
  );
}

