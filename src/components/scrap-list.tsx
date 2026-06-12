"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, RotateCcw, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type { HistoryEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const RESOURCE_LABELS: Record<string, string> = {
  checkpoint: "Checkpoint",
  lora: "LoRA",
  embedding: "Embedding",
  vae: "VAE",
  other: "Resource",
};

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

export function ScrapList() {
  const router = useRouter();
  const setParams = useStore((state) => state.setParams);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState("스크랩을 불러오는 중...");

  useEffect(() => {
    fetch("/api/scrap", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setStatus("");
      })
      .catch(() => {
        setStatus("스크랩을 불러오지 못했습니다.");
      });
  }, []);

  const reuseEntry = (entry: HistoryEntry) => {
    setParams(entry.params);
    router.push("/");
  };

  const deleteEntry = async (entry: HistoryEntry) => {
    const previousEntries = entries;

    setEntries((current) => current.filter((item) => item.id !== entry.id));

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
      setStatus("스크랩을 삭제하지 못했습니다.");
      setTimeout(() => setStatus(""), 2500);
    }
  };

  if (status) {
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
      <div className="grid gap-4 2xl:grid-cols-2">
        {entries.map((entry) => {
          const imageSrc = entry.localImageUrl || entry.imageUrl;
          const visibleResources = entry.resources.filter(
            (resource) => resource.type !== "other"
          );

          return (
            <article
              key={entry.id}
              className="grid min-h-0 gap-4 rounded-md border border-border bg-card p-3 shadow-sm xl:grid-cols-[18rem_minmax(0,1fr)]"
            >
              <div className="min-w-0">
                <div className="overflow-hidden rounded-md border border-border bg-background">
                  {imageSrc ? (
                    <img
                      src={imageSrc}
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
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="min-w-0 flex-1"
                    onClick={() => reuseEntry(entry)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reuse
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={() => window.open(entry.pageUrl, "_blank", "noreferrer")}
                    aria-label="Open Civitai page"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="destructive"
                    onClick={() => void deleteEntry(entry)}
                    aria-label="Delete scrap entry"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="min-w-0 space-y-3">
                <header className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold uppercase tracking-wide text-primary">
                      Civitai Image #{entry.imageId}
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

                <section className="rounded-md border border-border bg-background/80 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    Prompt
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">
                    {trimText(entry.params.prompt || "No prompt")}
                  </p>
                </section>

                {entry.params.negative_prompt && (
                  <section className="rounded-md border border-border bg-background/80 p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                      Negative Prompt
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
                      {trimText(entry.params.negative_prompt)}
                    </p>
                  </section>
                )}

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
                  <div className="flex flex-wrap gap-1.5">
                    {entry.params.model_name && (
                      <Badge variant="outline" className="rounded-md">
                        {entry.params.model_name}
                      </Badge>
                    )}
                    {visibleResources.map((resource, index) => (
                      <Badge
                        key={`${resource.name}-${index}`}
                        variant="secondary"
                        className="max-w-full rounded-md"
                      >
                        <span className="truncate">
                          {resourceLabel(resource)}
                        </span>
                      </Badge>
                    ))}
                  </div>

                  {entry.missingResources.length > 0 && (
                    <div className="rounded-md border border-dashed border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                      {entry.missingResources.length} missing local resource
                      {entry.missingResources.length > 1 ? "s" : ""}
                    </div>
                  )}
                </section>

                <JsonDetails entry={entry} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
