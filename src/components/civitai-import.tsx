"use client";

import { useState } from "react";
import { LinkIcon, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type { CivitaiImportResult } from "@/lib/types";
import {
  reconcileImportedParams,
  type LocalModelsResponse,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import { CivitaiMissingResources } from "@/components/civitai-missing-resources";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const CIVITAI_IMAGES_URL = "https://civitai.red/images";

function localResourcePath(resource: MissingResource, path: string) {
  const trimmed = path.trim();

  if (resource.type === "checkpoint") {
    return trimmed.replace(/^checkpoints\//, "");
  }
  if (resource.type === "lora") {
    return trimmed.replace(/^loras\//, "");
  }

  return trimmed;
}

function importStatusText(
  options: { metadataHidden: boolean; missingCount: number },
  language: "ko" | "en"
) {
  const { metadataHidden, missingCount } = options;

  if (language === "ko") {
    const importScope = metadataHidden
      ? "사용 가능한 이미지 크기와 리소스를 가져왔고"
      : "생성 설정을 가져왔고";

    return missingCount > 0
      ? `${importScope} 스크랩에 저장했습니다. 로컬 리소스 ${missingCount}개를 찾을 수 없습니다.`
      : `${importScope} 로컬 리소스를 매칭한 뒤 스크랩에 저장했습니다.`;
  }

  const importScope = metadataHidden
    ? "Imported available image size and resources"
    : "Imported settings";

  return missingCount > 0
    ? `${importScope} and saved to Scrap. ${missingCount} local resource${missingCount > 1 ? "s are" : " is"} missing.`
    : `${importScope}, matched local resources, and saved to Scrap.`;
}

export function CivitaiImport() {
  const { params, setParams, language } = useStore();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [missingResources, setMissingResources] = useState<MissingResource[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const importFromCivitai = async () => {
    if (!url.trim() || isImporting) return;

    setIsImporting(true);
    setStatus("Fetching Civitai metadata...");
    setMissingResources([]);

    try {
      const [importResponse, modelsResponse] = await Promise.all([
        fetch("/api/civitai/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }),
        fetch("/api/models", { cache: "no-store" }),
      ]);
      const importData = await importResponse.json();

      if (!importResponse.ok) {
        throw new Error(importData.error || "Failed to import Civitai metadata");
      }

      const imported = importData as CivitaiImportResult;
      const modelsData = (await modelsResponse.json()) as LocalModelsResponse;
      const { matched, missing } = reconcileImportedParams(
        imported,
        modelsData,
        params
      );
      const appliedParams = { ...params, ...matched };

      setParams(matched);
      setMissingResources(missing);
      void fetch("/api/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedUrl: url,
          importResult: importData,
          params: appliedParams,
          missingResources: missing,
        }),
      }).catch(() => {});
      setStatus(
        importStatusText(
          {
            metadataHidden: Boolean(imported.metadataHidden),
            missingCount: missing.length,
          },
          language
        )
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import Civitai metadata");
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-card/85 p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <Label className="text-xs text-muted-foreground">Import from Civitai</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Paste an image URL to load prompt, sampler, seed, and resource links.
          </p>
        </div>
        <a
          href={CIVITAI_IMAGES_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open Civitai images"
          title="Open Civitai images"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary"
        >
          <LinkIcon className="h-4 w-4" />
        </a>
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void importFromCivitai();
            }
          }}
          placeholder="https://civitai.com/images/... or https://civitai.red/images/..."
          className="h-9 text-xs"
        />
        <Button
          type="button"
          onClick={importFromCivitai}
          disabled={!url.trim() || isImporting}
          className="h-9"
        >
          {isImporting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Importing
            </span>
          ) : (
            "Import"
          )}
        </Button>
      </div>

      {status && <p className="mt-2 text-xs text-muted-foreground">{status}</p>}

      <CivitaiMissingResources
        resources={missingResources}
        language={language}
        onDownloaded={(resource, downloadedPath) => {
          const path = localResourcePath(resource, downloadedPath);

          if (path && resource.type === "checkpoint") {
            setParams({ model_name: path });
          }
          if (path && resource.type === "lora") {
            const currentLoras = useStore.getState().params.loras;
            const nextLora = {
              path,
              scale: resource.weight ?? 0.8,
            };

            setParams({
              loras: [
                ...currentLoras.filter((lora) => lora.path !== path),
                nextLora,
              ],
            });
          }

          setMissingResources((current) =>
            current.filter(
              (item) =>
                item.type !== resource.type ||
                item.modelVersionId !== resource.modelVersionId ||
                item.name !== resource.name
            )
          );
        }}
      />
    </section>
  );
}
