"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Grid3X3,
  Image as ImageIcon,
  List,
  RotateCcw,
  Save,
  Table2,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { HistoryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const RESOURCE_LABELS: Record<string, string> = {
  checkpoint: "Checkpoint",
  lora: "LoRA",
  embedding: "Embedding",
  vae: "VAE",
  upscaler: "Upscaler",
  other: "Resource",
};

type ScrapViewMode = "image" | "detail" | "table";

const VIEW_OPTIONS: {
  value: ScrapViewMode;
  label: string;
  icon: typeof ImageIcon;
}[] = [
  { value: "image", label: "이미지 강조", icon: ImageIcon },
  { value: "detail", label: "상세 정보", icon: List },
  { value: "table", label: "테이블", icon: Table2 },
];

function trimText(value: string, max = 220) {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}...`;
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function resourceLabel(resource: HistoryEntry["resources"][number]) {
  const version = resource.versionName ? ` ${resource.versionName}` : "";

  return `${RESOURCE_LABELS[resource.type]}: ${resource.name}${version}`;
}

function normalizeUserTags(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

function imageSrc(entry: HistoryEntry) {
  return entry.localImageUrl || entry.imageUrl;
}

function entryTitle(entry: HistoryEntry) {
  if (entry.source === "generated") return "Generated Image";

  return entry.imageId ? `Civitai Image #${entry.imageId}` : "Civitai Image";
}

function visibleResources(entry: HistoryEntry) {
  return entry.resources.filter((resource) => resource.type !== "other");
}

function missingResourcesText(count: number, language: "ko" | "en") {
  if (language === "ko") {
    return `로컬 리소스 ${count}개를 찾을 수 없습니다.`;
  }

  return `${count} missing local resource${count > 1 ? "s" : ""}`;
}

function JsonDetails({ entry }: { entry: HistoryEntry }) {
  const payload = useMemo(() => JSON.stringify(entry, null, 2), [entry]);

  return (
    <details className="rounded-md border border-border bg-background/80 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-muted-foreground">
        All import data
      </summary>
      <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">
        {payload}
      </pre>
    </details>
  );
}

function EntryActions({
  entry,
  onReuse,
  onDelete,
  compact = false,
}: {
  entry: HistoryEntry;
  onReuse: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex gap-2", compact && "justify-end")}>
      <Button
        type="button"
        size={compact ? "icon-sm" : "sm"}
        className={cn(!compact && "min-w-0 flex-1")}
        onClick={(event) => {
          event.stopPropagation();
          onReuse(entry);
        }}
        aria-label={compact ? "Reuse" : undefined}
      >
        <RotateCcw className="h-4 w-4" />
        {!compact && "Reuse"}
      </Button>
      {entry.pageUrl && (
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={(event) => {
            event.stopPropagation();
            window.open(entry.pageUrl, "_blank", "noreferrer");
          }}
          aria-label="Open Civitai page"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        size="icon-sm"
        variant="destructive"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(entry);
        }}
        aria-label="Delete scrap entry"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function TagEditor({
  entry,
  draft,
  saving,
  onDraftChange,
  onSave,
  onRemoveTag,
}: {
  entry: HistoryEntry;
  draft: string;
  saving: boolean;
  onDraftChange: (value: string) => void;
  onSave: (entry: HistoryEntry) => void;
  onRemoveTag: (entry: HistoryEntry, tag: string) => void;
}) {
  const tags = normalizeUserTags(entry.userTags);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(entry);
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-muted-foreground">
        <Tag className="h-3 w-3" />
        My Tags
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.length > 0 ? (
          tags.map((tag) => (
            <Badge key={tag} variant="outline" className="rounded-md pr-1">
              <span className="max-w-32 truncate">{tag}</span>
              <button
                type="button"
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => onRemoveTag(entry, tag)}
                aria-label={`${tag} tag remove`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No personal tags</span>
        )}
      </div>
      <form className="flex gap-2" onSubmit={handleSubmit}>
        <Input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="태그 입력, 쉼표로 구분"
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={saving}>
          <Save className="h-3.5 w-3.5" />
          저장
        </Button>
      </form>
    </section>
  );
}

function ResourceBadges({ entry, max }: { entry: HistoryEntry; max?: number }) {
  const resources = visibleResources(entry);
  const visible = typeof max === "number" ? resources.slice(0, max) : resources;

  return (
    <div className="flex flex-wrap gap-1.5">
      {entry.params.model_name && (
        <Badge variant="outline" className="max-w-full rounded-md">
          <span className="truncate">{entry.params.model_name}</span>
        </Badge>
      )}
      {visible.map((resource, index) => (
        <Badge
          key={`${resource.name}-${index}`}
          variant="secondary"
          className="max-w-full rounded-md"
        >
          <span className="truncate">{resourceLabel(resource)}</span>
        </Badge>
      ))}
      {resources.length > visible.length && (
        <Badge variant="outline" className="rounded-md">
          +{resources.length - visible.length}
        </Badge>
      )}
    </div>
  );
}

function MissingResourcesNotice({ entry }: { entry: HistoryEntry }) {
  const language = useStore((state) => state.language);

  if (entry.missingResources.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
      {missingResourcesText(entry.missingResources.length, language)}
    </div>
  );
}

function ImagePreview({
  entry,
  className,
}: {
  entry: HistoryEntry;
  className?: string;
}) {
  const src = imageSrc(entry);

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-background", className)}>
      {src ? (
        <img
          src={src}
          alt=""
          className="aspect-square h-auto w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
          No image
        </div>
      )}
    </div>
  );
}

function ImageCard({
  entry,
  onOpen,
  onReuse,
  onDelete,
}: {
  entry: HistoryEntry;
  onOpen: (entry: HistoryEntry) => void;
  onReuse: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  const tags = normalizeUserTags(entry.userTags).slice(0, 3);

  return (
    <article
      className="group relative min-w-0 cursor-pointer overflow-hidden rounded-md border border-border bg-card shadow-sm transition-colors hover:border-primary/45"
      onClick={() => onOpen(entry)}
    >
      <ImagePreview entry={entry} className="rounded-none border-0" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10 opacity-100">
        <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
          <Badge variant="secondary" className="rounded-md bg-white/90 text-black">
            {entry.source === "generated" ? "Generated" : "Civitai"}
          </Badge>
          <Badge variant="secondary" className="rounded-md bg-white/90 text-black">
            {entry.params.width} x {entry.params.height}
          </Badge>
        </div>
        <div className="absolute bottom-3 left-3 right-3 space-y-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold uppercase text-white">
              {entryTitle(entry)}
            </div>
            <p className="mt-1 line-clamp-2 break-words text-xs leading-5 text-white/85">
              {entry.params.prompt || "No prompt"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entry.params.model_name && (
              <Badge variant="secondary" className="max-w-full rounded-md bg-white/90 text-black">
                <span className="truncate">{entry.params.model_name}</span>
              </Badge>
            )}
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="rounded-md bg-white/20 text-white">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute right-3 top-12 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        <EntryActions entry={entry} onReuse={onReuse} onDelete={onDelete} compact />
      </div>
    </article>
  );
}

function DetailCard({
  entry,
  onOpen,
  onReuse,
  onDelete,
}: {
  entry: HistoryEntry;
  onOpen: (entry: HistoryEntry) => void;
  onReuse: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  return (
    <article
      className="grid min-h-0 cursor-pointer gap-4 rounded-md border border-border bg-card p-3 shadow-sm transition-colors hover:border-primary/45 xl:grid-cols-[14rem_minmax(0,1fr)]"
      onClick={() => onOpen(entry)}
    >
      <div className="min-w-0">
        <ImagePreview entry={entry} />
        <div className="mt-2">
          <EntryActions entry={entry} onReuse={onReuse} onDelete={onDelete} />
        </div>
      </div>

      <div className="min-w-0 space-y-3">
        <header className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-primary">
              {entryTitle(entry)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDate(entry.createdAt)}
              {entry.username ? ` by ${entry.username}` : ""}
            </div>
          </div>
          <Badge variant="secondary" className="rounded-md">
            {entry.params.width} x {entry.params.height}
          </Badge>
        </header>

        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6">
          {trimText(entry.params.prompt || "No prompt", 260)}
        </p>

        <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-md border border-border bg-background/80 p-2">
            <div className="text-[10px] font-bold uppercase text-muted-foreground">
              Steps
            </div>
            <div className="mt-1 text-sm font-semibold">
              {entry.params.num_inference_steps}
            </div>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-2">
            <div className="text-[10px] font-bold uppercase text-muted-foreground">
              CFG
            </div>
            <div className="mt-1 text-sm font-semibold">
              {entry.params.guidance_scale}
            </div>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-2">
            <div className="text-[10px] font-bold uppercase text-muted-foreground">
              Sampler
            </div>
            <div className="mt-1 truncate text-sm font-semibold">
              {entry.params.sampler_name}
            </div>
          </div>
          <div className="rounded-md border border-border bg-background/80 p-2">
            <div className="text-[10px] font-bold uppercase text-muted-foreground">
              Seed
            </div>
            <div className="mt-1 truncate text-sm font-semibold">
              {entry.params.seed ?? "Random"}
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <ResourceBadges entry={entry} max={3} />
          <MissingResourcesNotice entry={entry} />
        </section>
      </div>
    </article>
  );
}

function TableView({
  entries,
  onOpen,
  onReuse,
  onDelete,
}: {
  entries: HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onReuse: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[72rem] border-collapse text-left text-sm">
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="w-20 px-3 py-2">Image</th>
            <th className="px-3 py-2">Info</th>
            <th className="px-3 py-2">Prompt</th>
            <th className="px-3 py-2">Params</th>
            <th className="px-3 py-2">My Tags</th>
            <th className="w-28 px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className="cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-muted/35"
              onClick={() => onOpen(entry)}
            >
              <td className="px-3 py-3 align-top">
                <ImagePreview entry={entry} className="w-16" />
              </td>
              <td className="px-3 py-3 align-top">
                <div className="font-semibold text-primary">
                  {entryTitle(entry)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDate(entry.createdAt)}
                </div>
                <div className="mt-2 max-w-48">
                  <ResourceBadges entry={entry} max={1} />
                </div>
              </td>
              <td className="max-w-md px-3 py-3 align-top">
                <p className="line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5">
                  {trimText(entry.params.prompt || "No prompt", 260)}
                </p>
              </td>
              <td className="px-3 py-3 align-top text-xs">
                <div>{entry.params.width} x {entry.params.height}</div>
                <div className="mt-1 text-muted-foreground">
                  {entry.params.num_inference_steps} steps / CFG{" "}
                  {entry.params.guidance_scale}
                </div>
                <div className="mt-1 max-w-36 truncate text-muted-foreground">
                  {entry.params.sampler_name}
                </div>
              </td>
              <td className="min-w-72 px-3 py-3 align-top">
                <div className="flex max-w-72 flex-wrap gap-1.5">
                  {normalizeUserTags(entry.userTags).length > 0 ? (
                    normalizeUserTags(entry.userTags).slice(0, 5).map((tag) => (
                      <Badge key={tag} variant="outline" className="rounded-md">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No personal tags
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-3 align-top">
                <EntryActions
                  entry={entry}
                  onReuse={onReuse}
                  onDelete={onDelete}
                  compact
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScrapEntryDialog({
  entry,
  draft,
  saving,
  open,
  onOpenChange,
  onDraftChange,
  onSaveTags,
  onRemoveTag,
  onReuse,
  onDelete,
}: {
  entry: HistoryEntry | null;
  draft: string;
  saving: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (value: string) => void;
  onSaveTags: (entry: HistoryEntry) => void;
  onRemoveTag: (entry: HistoryEntry, tag: string) => void;
  onReuse: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
}) {
  if (!entry) {
    return null;
  }

  const src = imageSrc(entry);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!block h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-[96vw]">
        <DialogTitle className="sr-only">{entryTitle(entry)}</DialogTitle>

        <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_minmax(22rem,36rem)] bg-background max-lg:grid-cols-1">
          <div className="relative min-h-0 min-w-0 overflow-auto border-r border-border bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--border)_55%,transparent)_1px,transparent_0)] [background-size:24px_24px] max-lg:border-b max-lg:border-r-0">
            <div className="flex min-h-full min-w-full p-6">
              <div className="m-auto overflow-hidden rounded-lg border border-border bg-card p-2 shadow-lg">
                {src ? (
                  <img
                    src={src}
                    alt=""
                    className="block h-auto max-h-[86vh] w-auto max-w-full rounded-md object-contain"
                  />
                ) : (
                  <div className="flex h-96 w-96 max-w-full items-center justify-center text-sm text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-card">
            <header className="border-b border-border bg-secondary/50 px-5 py-4 pr-12">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                {entryTitle(entry)}
              </div>
              <div className="mt-1 text-xs font-medium text-muted-foreground">
                {formatDate(entry.createdAt)}
                {entry.username ? ` by ${entry.username}` : ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge variant="secondary" className="rounded-md">
                  {entry.source === "generated" ? "Generated" : "Civitai"}
                </Badge>
                <Badge variant="secondary" className="rounded-md">
                  {entry.params.width} x {entry.params.height}
                </Badge>
              </div>
            </header>

            <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
              <EntryActions entry={entry} onReuse={onReuse} onDelete={onDelete} />
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background/70 p-5">
              <section className="rounded-md border border-border bg-card p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Prompt
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                  {entry.params.prompt || "No prompt"}
                </p>
              </section>

              {entry.params.negative_prompt && (
                <section className="rounded-md border border-border bg-card p-3 shadow-sm">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Negative Prompt
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                    {entry.params.negative_prompt}
                  </p>
                </section>
              )}

              <section className="rounded-md border border-border bg-card p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Generation
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="text-[10px] font-bold uppercase text-muted-foreground">
                      Steps
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      {entry.params.num_inference_steps}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="text-[10px] font-bold uppercase text-muted-foreground">
                      CFG
                    </div>
                    <div className="mt-1 text-sm font-semibold">
                      {entry.params.guidance_scale}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="text-[10px] font-bold uppercase text-muted-foreground">
                      Sampler
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold">
                      {entry.params.sampler_name}
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-background px-3 py-2">
                    <div className="text-[10px] font-bold uppercase text-muted-foreground">
                      Seed
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold">
                      {entry.params.seed ?? "Random"}
                    </div>
                  </div>
                </div>
              </section>

              <section className="space-y-2 rounded-md border border-border bg-card p-3 shadow-sm">
                <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Resources
                </div>
                <ResourceBadges entry={entry} />
                <MissingResourcesNotice entry={entry} />
              </section>

              <section className="rounded-md border border-border bg-card p-3 shadow-sm">
                <TagEditor
                  entry={entry}
                  draft={draft}
                  saving={saving}
                  onDraftChange={onDraftChange}
                  onSave={onSaveTags}
                  onRemoveTag={onRemoveTag}
                />
              </section>

              <JsonDetails entry={entry} />
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ScrapList() {
  const router = useRouter();
  const setParams = useStore((state) => state.setParams);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [selectedTag, setSelectedTag] = useState("all");
  const [viewMode, setViewMode] = useState<ScrapViewMode>("detail");
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [status, setStatus] = useState("스크랩을 불러오는 중...");

  useEffect(() => {
    fetch("/api/scrap", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        const loadedEntries = Array.isArray(data.entries)
          ? (data.entries as HistoryEntry[]).map((entry) => ({
              ...entry,
              userTags: normalizeUserTags(entry.userTags),
            }))
          : [];

        setEntries(loadedEntries);
        setDrafts(
          Object.fromEntries(
            loadedEntries.map((entry) => [entry.id, entry.userTags.join(", ")])
          )
        );
        setStatus("");
      })
      .catch(() => {
        setStatus("스크랩을 불러오지 못했습니다.");
      });
  }, []);

  const allTags = useMemo(() => {
    return Array.from(
      new Set(entries.flatMap((entry) => normalizeUserTags(entry.userTags)))
    ).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const filteredEntries = useMemo(() => {
    if (selectedTag === "all") return entries;

    return entries.filter((entry) =>
      normalizeUserTags(entry.userTags).includes(selectedTag)
    );
  }, [entries, selectedTag]);

  const selectedEntry = useMemo(() => {
    if (!selectedEntryId) return null;

    return entries.find((entry) => entry.id === selectedEntryId) ?? null;
  }, [entries, selectedEntryId]);

  const updateDraft = (id: string, value: string) => {
    setDrafts((current) => ({ ...current, [id]: value }));
  };

  const reuseEntry = (entry: HistoryEntry) => {
    setParams(entry.params);
    router.push("/");
  };

  const saveTags = async (entry: HistoryEntry, tags = parseTags(drafts[entry.id] ?? "")) => {
    const previousEntries = entries;

    setSavingId(entry.id);
    setEntries((current) =>
      current.map((item) =>
        item.id === entry.id ? { ...item, userTags: tags } : item
      )
    );
    setDrafts((current) => ({ ...current, [entry.id]: tags.join(", ") }));

    try {
      const response = await fetch("/api/scrap", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, userTags: tags }),
      });

      if (!response.ok) {
        throw new Error("Failed to update scrap tags.");
      }

      const data = (await response.json()) as { entry?: HistoryEntry };
      if (data.entry) {
        const updatedEntry = {
          ...data.entry,
          userTags: normalizeUserTags(data.entry.userTags),
        };

        setEntries((current) =>
          current.map((item) => (item.id === entry.id ? updatedEntry : item))
        );
        setDrafts((current) => ({
          ...current,
          [entry.id]: updatedEntry.userTags.join(", "),
        }));
      }
    } catch {
      setEntries(previousEntries);
      setStatus("태그를 저장하지 못했습니다.");
      setTimeout(() => setStatus(""), 2500);
    } finally {
      setSavingId(null);
    }
  };

  const removeTag = (entry: HistoryEntry, tag: string) => {
    const tags = normalizeUserTags(entry.userTags).filter((item) => item !== tag);
    void saveTags(entry, tags);
  };

  const deleteEntry = async (entry: HistoryEntry) => {
    const previousEntries = entries;

    setEntries((current) => current.filter((item) => item.id !== entry.id));
    if (selectedEntryId === entry.id) {
      setSelectedEntryId(null);
    }

    try {
      const response = await fetch("/api/scrap", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });

      if (!response.ok) {
        throw new Error("Failed to delete scrap entry.");
      }
    } catch {
      setEntries(previousEntries);
      if (selectedEntryId === entry.id) {
        setSelectedEntryId(entry.id);
      }
      setStatus("스크랩을 삭제하지 못했습니다.");
      setTimeout(() => setStatus(""), 2500);
    }
  };

  if (status && entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {status}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
        <div>
          <div className="text-sm font-semibold">아직 스크랩이 없습니다</div>
          <div className="mt-1 text-xs">
            Generate에서 가져온 Civitai 이미지가 여기에 저장됩니다.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="mb-4 flex flex-col gap-3 rounded-md border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = viewMode === option.value;

              return (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  onClick={() => setViewMode(option.value)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {option.label}
                </Button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Grid3X3 className="h-3.5 w-3.5" />
            {filteredEntries.length} / {entries.length}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">
            태그 필터
          </span>
          <Button
            type="button"
            size="xs"
            variant={selectedTag === "all" ? "default" : "outline"}
            onClick={() => setSelectedTag("all")}
          >
            전체
          </Button>
          {allTags.map((tag) => (
            <Button
              key={tag}
              type="button"
              size="xs"
              variant={selectedTag === tag ? "default" : "outline"}
              onClick={() => setSelectedTag(tag)}
            >
              {tag}
            </Button>
          ))}
          {allTags.length === 0 && (
            <span className="text-xs text-muted-foreground">
              저장된 개인 태그가 없습니다.
            </span>
          )}
        </div>
      </div>

      {status && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {status}
        </div>
      )}

      {filteredEntries.length === 0 ? (
        <div className="flex min-h-72 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          선택한 태그에 해당하는 스크랩이 없습니다.
        </div>
      ) : viewMode === "table" ? (
        <TableView
          entries={filteredEntries}
          onOpen={(entry) => setSelectedEntryId(entry.id)}
          onReuse={reuseEntry}
          onDelete={(entry) => void deleteEntry(entry)}
        />
      ) : (
        <div
          className={cn(
            "grid gap-4",
            viewMode === "image"
              ? "sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
              : "2xl:grid-cols-2"
          )}
        >
          {filteredEntries.map((entry) =>
            viewMode === "image" ? (
              <ImageCard
                key={entry.id}
                entry={entry}
                onOpen={(item) => setSelectedEntryId(item.id)}
                onReuse={reuseEntry}
                onDelete={(item) => void deleteEntry(item)}
              />
            ) : (
              <DetailCard
                key={entry.id}
                entry={entry}
                onOpen={(item) => setSelectedEntryId(item.id)}
                onReuse={reuseEntry}
                onDelete={(item) => void deleteEntry(item)}
              />
            )
          )}
        </div>
      )}

      <ScrapEntryDialog
        entry={selectedEntry}
        draft={selectedEntry ? drafts[selectedEntry.id] ?? "" : ""}
        saving={selectedEntry ? savingId === selectedEntry.id : false}
        open={Boolean(selectedEntry)}
        onOpenChange={(open) => {
          if (!open) setSelectedEntryId(null);
        }}
        onDraftChange={(value) => {
          if (selectedEntry) updateDraft(selectedEntry.id, value);
        }}
        onSaveTags={saveTags}
        onRemoveTag={removeTag}
        onReuse={reuseEntry}
        onDelete={(entry) => void deleteEntry(entry)}
      />
    </div>
  );
}
