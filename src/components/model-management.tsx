"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  Check,
  Download,
  ExternalLink,
  FileDown,
  FileUp,
  Grid3X3,
  Heart,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Star,
  Tag,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  exists?: boolean;
}

interface ModelsResponse {
  checkpointAssets: ModelAsset[];
  loraAssets: ModelAsset[];
  embeddingAssets: ModelAsset[];
  vaeAssets: ModelAsset[];
  upscaleModelAssets: ModelAsset[];
  videoModelAssets: ModelAsset[];
  textEncoderAssets: ModelAsset[];
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
  { id: "text_encoders", label: "Text Encoders", folder: "text_encoders", key: "textEncoderAssets" },
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

type TagSortMode = "abc" | "count";

interface ModelTagFilter {
  label: string;
  count: number;
}

const MODEL_FAVORITE_TAGS_KEY = "model-favorite-tags";

function loadFavoriteTags() {
  if (typeof window === "undefined") return [];

  try {
    const saved = window.localStorage.getItem(MODEL_FAVORITE_TAGS_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function TagFilterButton({
  tag,
  selected,
  favorite,
  onToggle,
  onToggleFavorite,
}: {
  tag: ModelTagFilter;
  selected: boolean;
  favorite: boolean;
  onToggle: (tag: ModelTagFilter) => void;
  onToggleFavorite: (tag: ModelTagFilter) => void;
}) {
  return (
    <div
      className={cn(
        "group inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-1 text-xs transition-colors",
        favorite
          ? "border-primary/35 bg-primary/10 shadow-sm"
          : "border-border bg-background/70",
        selected && "border-primary bg-primary text-primary-foreground"
      )}
    >
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 text-left"
        onClick={() => onToggle(tag)}
        aria-pressed={selected}
      >
        <span className="min-w-0 truncate font-medium">{tag.label}</span>
        <span
          className={cn(
            "shrink-0 text-[10px]",
            selected ? "text-primary-foreground/75" : "text-muted-foreground"
          )}
        >
          {tag.count}
        </span>
      </button>
      <button
        type="button"
        className={cn(
          "shrink-0 rounded-sm p-0.5 transition-colors",
          selected
            ? "text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground"
            : favorite
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
        onClick={() => onToggleFavorite(tag)}
        aria-label={`${favorite ? "Unfavorite" : "Favorite"} ${tag.label}`}
        title={`${favorite ? "Unfavorite" : "Favorite"} ${tag.label}`}
      >
        <Star className={cn("h-3.5 w-3.5", favorite && "fill-current")} />
      </button>
    </div>
  );
}

function ModelTagSidebar({
  tags,
  selectedTags,
  favoriteTags,
  totalModels,
  filteredModels,
  onReset,
  onToggleTag,
  onToggleFavorite,
}: {
  tags: ModelTagFilter[];
  selectedTags: string[];
  favoriteTags: string[];
  totalModels: number;
  filteredModels: number;
  onReset: () => void;
  onToggleTag: (tag: ModelTagFilter) => void;
  onToggleFavorite: (tag: ModelTagFilter) => void;
}) {
  const [sortMode, setSortMode] = useState<TagSortMode>("abc");

  const sortedTags = useMemo(() => {
    const compareTags = (a: ModelTagFilter, b: ModelTagFilter) => {
      if (sortMode === "count" && a.count !== b.count) {
        return b.count - a.count;
      }

      return a.label.localeCompare(b.label);
    };

    return tags
      .map((tag) => ({
        ...tag,
        favorite: favoriteTags.includes(tag.label),
      }))
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return compareTags(a, b);
      });
  }, [favoriteTags, sortMode, tags]);

  return (
    <aside className="sticky top-4 max-h-[calc(100vh-7rem)] min-h-0 self-start overflow-hidden rounded-md border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-secondary/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Tags</div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="xs"
              variant={sortMode === "abc" ? "default" : "outline"}
              onClick={() => setSortMode("abc")}
              aria-pressed={sortMode === "abc"}
            >
              abc
            </Button>
            <Button
              type="button"
              size="xs"
              variant={sortMode === "count" ? "default" : "outline"}
              onClick={() => setSortMode("count")}
              aria-pressed={sortMode === "count"}
            >
              123
            </Button>
            <Button
              type="button"
              size="xs"
              variant={selectedTags.length === 0 ? "default" : "outline"}
              onClick={onReset}
            >
              All
            </Button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Grid3X3 className="h-3.5 w-3.5" />
          {filteredModels} / {totalModels}
          {selectedTags.length > 0 && (
            <span>with {selectedTags.length} tag filters</span>
          )}
        </div>
      </div>
      <div className="max-h-[calc(100vh-13rem)] space-y-2 overflow-y-auto p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <Tag className="h-3 w-3" />
            <span className="truncate">Model Tags</span>
          </div>
          <span className="text-[10px] text-muted-foreground">{tags.length}</span>
        </div>
        {sortedTags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {sortedTags.map((tag) => (
              <TagFilterButton
                key={tag.label}
                tag={tag}
                selected={selectedTags.includes(tag.label)}
                favorite={tag.favorite}
                onToggle={onToggleTag}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border px-2 py-3 text-xs text-muted-foreground">
            No model tags.
          </div>
        )}
      </div>
    </aside>
  );
}

function ModelCard({
  asset,
  onView,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelect,
  onDownloaded,
}: {
  asset: ModelAsset;
  onView: () => void;
  onDelete: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onDownloaded?: () => void;
}) {
  const [showAllTags, setShowAllTags] = useState(false);
  const [downloadState, setDownloadState] = useState<{
    status: "idle" | "downloading" | "error";
    percent: number | null;
    error?: string;
  }>({ status: "idle", percent: null });
  const visibleTags = showAllTags ? asset.tags : asset.tags.slice(0, 4);
  const sourceUrl = getSourceUrl(asset);
  const downloadFolder = asset.folder ?? "";
  // Catalog entries not yet on disk can be pulled locally when we have both a
  // source URL and a known target folder.
  const canDownload =
    asset.exists === false && Boolean(sourceUrl) && Boolean(downloadFolder);

  const handleDownload = useCallback(async () => {
    if (!sourceUrl || !downloadFolder) return;
    setDownloadState({ status: "downloading", percent: null });
    try {
      const response = await fetch("/api/models/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: downloadFolder, filename: asset.path, url: sourceUrl }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Download failed: HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let failure = "";
      let done = false;
      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as {
            type: string;
            percent?: number | null;
            error?: string;
          };
          if (event.type === "progress") {
            setDownloadState({
              status: "downloading",
              percent: typeof event.percent === "number" ? event.percent : null,
            });
          } else if (event.type === "complete") {
            done = true;
          } else if (event.type === "error") {
            failure = event.error || "Download failed";
            done = true;
          }
        }
      }

      if (failure) throw new Error(failure);
      setDownloadState({ status: "idle", percent: null });
      onDownloaded?.();
    } catch (error) {
      setDownloadState({
        status: "error",
        percent: null,
        error: error instanceof Error ? error.message : "Download failed",
      });
    }
  }, [asset.path, downloadFolder, onDownloaded, sourceUrl]);

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
            {canDownload && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={downloadState.status === "downloading"}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDownload();
                }}
              >
                {downloadState.status === "downloading" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {downloadState.percent != null ? `${downloadState.percent}%` : "…"}
                  </>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </>
                )}
              </Button>
            )}
            {downloadState.status === "error" && (
              <span
                className="truncate text-[11px] text-destructive"
                title={downloadState.error}
              >
                {downloadState.error}
              </span>
            )}
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
            {!selecting && (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="ml-auto h-7 w-7 shrink-0 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete();
                }}
                aria-label={`Delete ${asset.name}`}
                title="모델 삭제"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
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

interface DeleteTargetPod {
  id: string;
  label: string;
  kind: string;
  running: boolean;
}

interface DeleteOutcome {
  target: string;
  ok: boolean;
  message: string;
}

function DeleteModelDialog({
  asset,
  folder,
  open,
  onOpenChange,
  onDeleted,
}: {
  asset: ModelAsset;
  folder: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const hasLocalFile = asset.exists !== false;
  const [pods, setPods] = useState<DeleteTargetPod[] | null>(null);
  const [podsError, setPodsError] = useState("");
  const [deleteLocal, setDeleteLocal] = useState(hasLocalFile);
  const [selectedPodIds, setSelectedPodIds] = useState<Set<string>>(
    () => new Set()
  );
  const [deleting, setDeleting] = useState(false);
  const [results, setResults] = useState<DeleteOutcome[]>([]);

  // The dialog is mounted fresh per delete target (keyed/conditional render),
  // so initial state covers the reset and this effect only loads pod targets.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    Promise.all([
      fetchWithTimeout("/api/settings", { cache: "no-store" }).then(
        (res) => res.json() as Promise<{ runpodPods?: unknown }>
      ),
      fetchWithTimeout("/api/runpod/pods/running", { cache: "no-store" })
        .then(
          (res) =>
            res.json() as Promise<{ pods?: { id: string; running: boolean }[] }>
        )
        .catch(() => ({ pods: [] as { id: string; running: boolean }[] })),
    ])
      .then(([settings, running]) => {
        if (cancelled) return;

        const runningMap = new Map(
          (running.pods ?? []).map((pod) => [pod.id, Boolean(pod.running)])
        );
        const podList = Array.isArray(settings.runpodPods)
          ? (settings.runpodPods as {
              id?: string;
              label?: string;
              kind?: string;
            }[])
              .filter((pod) => typeof pod.id === "string" && pod.id)
              .map((pod) => ({
                id: pod.id as string,
                label: pod.label || (pod.id as string),
                kind: pod.kind === "video" ? "video" : "image",
                running: runningMap.get(pod.id as string) ?? false,
              }))
          : [];

        setPods(podList);
      })
      .catch((error) => {
        if (cancelled) return;
        setPods([]);
        setPodsError(
          error instanceof Error ? error.message : "RunPod 목록을 불러오지 못했습니다."
        );
      });

    return () => {
      cancelled = true;
    };
  }, [open, hasLocalFile]);

  const togglePod = (id: string) => {
    setSelectedPodIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const selectedTargetCount = (deleteLocal ? 1 : 0) + selectedPodIds.size;
  const finished = results.length > 0;

  const runDelete = async () => {
    setDeleting(true);
    const outcomes: DeleteOutcome[] = [];

    if (deleteLocal) {
      try {
        const res = await fetchWithTimeout("/api/models", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folder, path: asset.path }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };

        if (!res.ok) {
          throw new Error(data.error || "로컬 파일을 삭제하지 못했습니다.");
        }

        outcomes.push({ target: "로컬", ok: true, message: "삭제 완료" });
      } catch (error) {
        outcomes.push({
          target: "로컬",
          ok: false,
          message:
            error instanceof Error ? error.message : "로컬 파일을 삭제하지 못했습니다.",
        });
      }
    }

    for (const pod of pods ?? []) {
      if (!selectedPodIds.has(pod.id)) continue;

      try {
        const res = await fetchWithTimeout(
          `/api/runpod/pods/${encodeURIComponent(pod.id)}/models`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder, path: asset.path }),
          },
          90_000
        );
        const data = (await res.json().catch(() => ({}))) as { error?: string };

        if (!res.ok) {
          throw new Error(data.error || "RunPod에서 삭제하지 못했습니다.");
        }

        outcomes.push({ target: pod.label, ok: true, message: "삭제 완료" });
      } catch (error) {
        outcomes.push({
          target: pod.label,
          ok: false,
          message:
            error instanceof Error
              ? error.message
              : "RunPod에서 삭제하지 못했습니다.",
        });
      }
    }

    setResults(outcomes);
    setDeleting(false);

    if (outcomes.some((outcome) => outcome.ok)) {
      onDeleted();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="border border-border bg-card sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>모델 삭제</DialogTitle>
          <DialogDescription className="break-all">
            {folder}/{asset.path} 파일을 삭제할 위치를 선택하세요. 삭제된 파일은 복구할 수
            없습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
          <label
            className={cn(
              "flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2",
              hasLocalFile ? "cursor-pointer" : "opacity-60"
            )}
          >
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                checked={deleteLocal}
                disabled={!hasLocalFile || deleting || finished}
                onChange={(event) => setDeleteLocal(event.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <div>
                <div className="text-sm font-semibold">로컬 파일</div>
                <div className="text-xs text-muted-foreground">
                  {hasLocalFile
                    ? "ComfyUI models 폴더에서 파일과 카탈로그 메타데이터를 삭제합니다."
                    : "로컬에 파일이 없습니다."}
                </div>
              </div>
            </div>
          </label>

          {pods === null ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              RunPod 목록을 불러오는 중...
            </div>
          ) : pods.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
              {podsError || "등록된 RunPod이 없습니다."}
            </div>
          ) : (
            pods.map((pod) => (
              <label
                key={pod.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border border-border bg-background/70 px-3 py-2",
                  pod.running ? "cursor-pointer" : "opacity-60"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={selectedPodIds.has(pod.id)}
                    disabled={!pod.running || deleting || finished}
                    onChange={() => togglePod(pod.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <div>
                    <div className="text-sm font-semibold">{pod.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {pod.running
                        ? "실행 중인 pod의 models 폴더에서 파일을 삭제합니다."
                        : "pod이 실행 중이 아니어서 삭제할 수 없습니다."}
                    </div>
                  </div>
                </div>
                <Badge
                  variant={pod.running ? "secondary" : "outline"}
                  className="shrink-0 rounded-md"
                >
                  {pod.running ? "Running" : "Stopped"}
                </Badge>
              </label>
            ))
          )}

          {results.length > 0 && (
            <div className="grid gap-1.5 rounded-md border border-border bg-background/70 p-3">
              {results.map((result) => (
                <div
                  key={result.target}
                  className={cn(
                    "flex items-center justify-between gap-3 text-xs",
                    result.ok ? "text-foreground" : "text-destructive"
                  )}
                >
                  <span className="font-semibold">{result.target}</span>
                  <span className="min-w-0 truncate" title={result.message}>
                    {result.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            {finished ? "닫기" : "취소"}
          </Button>
          {!finished && (
            <Button
              type="button"
              variant="destructive"
              onClick={runDelete}
              disabled={deleting || selectedTargetCount === 0}
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {selectedTargetCount > 1
                ? `${selectedTargetCount}곳에서 삭제`
                : "삭제"}
            </Button>
          )}
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
  const [deleteOpen, setDeleteOpen] = useState(false);
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
            onClick={() => setDeleteOpen(true)}
            disabled={saving || loadingSource}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving || loadingSource}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={save}
              disabled={saving || loadingSource || !name.trim()}
            >
              {saving ? "Saving" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      {deleteOpen && (
        <DeleteModelDialog
          asset={asset}
          folder={folder}
          open
          onOpenChange={setDeleteOpen}
          onDeleted={() => {
            setDeleteOpen(false);
            onDeleted();
            onOpenChange(false);
          }}
        />
      )}
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [favoriteTags, setFavoriteTags] = useState<string[]>(loadFavoriteTags);
  const [viewing, setViewing] = useState<{
    asset: ModelAsset;
    folder: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    asset: ModelAsset;
    folder: string;
  } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      MODEL_FAVORITE_TAGS_KEY,
      JSON.stringify(favoriteTags)
    );
  }, [favoriteTags]);

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
        (models?.videoModelAssets.length ?? 0) +
        (models?.textEncoderAssets.length ?? 0),
      checkpoints: models?.checkpointAssets.length ?? 0,
      video_models: models?.videoModelAssets.length ?? 0,
      loras: models?.loraAssets.length ?? 0,
      embeddings: models?.embeddingAssets.length ?? 0,
      vae: models?.vaeAssets.length ?? 0,
      upscale_models: models?.upscaleModelAssets.length ?? 0,
      text_encoders: models?.textEncoderAssets.length ?? 0,
    }),
    [models]
  );

  // Unique file count across groups, mirroring the ALL tab's dedupe, so the
  // sidebar's filtered/total ratio stays consistent.
  const totalModelCount = useMemo(() => {
    const seen = new Set<string>();

    GROUPS.forEach((group) => {
      (models?.[group.key] ?? []).forEach((asset) => {
        seen.add(`${asset.folder ?? group.folder}/${asset.path}`);
      });
    });

    return seen.size;
  }, [models]);

  const allTags = useMemo(() => {
    const tagCountMap = new Map<string, number>();

    GROUPS.forEach((group) => {
      (models?.[group.key] ?? []).forEach((asset) => {
        asset.tags.forEach((tag) => {
          tagCountMap.set(tag, (tagCountMap.get(tag) ?? 0) + 1);
        });
      });
    });

    return Array.from(tagCountMap.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [models]);

  const assetGroups = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        assets: (models?.[group.key] ?? []).filter(
          (asset) =>
            selectedTags.length === 0 ||
            selectedTags.some((tag) => asset.tags.includes(tag))
        ),
      })),
    [models, selectedTags]
  );

  const toggleTagFilter = (tag: ModelTagFilter) => {
    setSelectedTags((current) =>
      current.includes(tag.label)
        ? current.filter((item) => item !== tag.label)
        : [...current, tag.label]
    );
  };

  const toggleFavoriteTag = (tag: ModelTagFilter) => {
    setFavoriteTags((current) =>
      current.includes(tag.label)
        ? current.filter((item) => item !== tag.label)
        : [...current, tag.label]
    );
  };

  const catalogAssets = GROUPS.flatMap((group) =>
    (models?.[group.key] ?? []).map((asset) => ({
      asset,
      folder: asset.folder ?? group.folder,
    }))
  );

  const allAssets = useMemo(() => {
    // A checkpoint can be listed by both the checkpoints and video_models
    // groups; the ALL tab must render each file once.
    const seen = new Set<string>();

    return assetGroups
      .flatMap((group) =>
        group.assets.map((asset) => ({
          asset,
          folder: asset.folder ?? group.folder,
        }))
      )
      .filter(({ asset, folder }) => {
        const key = `${folder}/${asset.path}`;

        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [assetGroups]);
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

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0">
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
                        onDelete={() => setDeleteTarget({ asset, folder })}
                        onDownloaded={refreshModels}
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
                          onDelete={() =>
                            setDeleteTarget({
                              asset,
                              folder: asset.folder ?? group.folder,
                            })
                          }
                          onDownloaded={refreshModels}
                        />
                      ))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </div>

          <ModelTagSidebar
            tags={allTags}
            selectedTags={selectedTags}
            favoriteTags={favoriteTags}
            totalModels={totalModelCount}
            filteredModels={allAssets.length}
            onReset={() => setSelectedTags([])}
            onToggleTag={toggleTagFilter}
            onToggleFavorite={toggleFavoriteTag}
          />
        </div>
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
      {deleteTarget && (
        <DeleteModelDialog
          key={`delete:${deleteTarget.folder}:${assetKey(deleteTarget.asset)}`}
          asset={deleteTarget.asset}
          folder={deleteTarget.folder}
          open
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onDeleted={() => setRefreshKey((key) => key + 1)}
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

