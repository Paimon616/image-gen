"use client";

import { useState } from "react";
import { ImageIcon, LinkIcon, Loader2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import type { CivitaiImportResult, GenerationParams } from "@/lib/types";
import {
  reconcileImportedParams,
  type LocalModelsResponse,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import { CivitaiMissingResources } from "@/components/civitai-missing-resources";
import { CivitaiMetadataAdvice } from "@/components/civitai-metadata-advice";
import { FieldHelp } from "@/components/field-help";
import { CopyLinkButton } from "@/components/copy-link-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
  const {
    params,
    setParams,
    language,
    civitaiReference,
    setCivitaiReference,
    clearCivitaiReference,
    civitaiImport,
    setCivitaiImport,
    updateCivitaiImportMissing,
  } = useStore();
  const { url, status, missingResources, resetVersion } = civitaiImport;
  const setUrl = (value: string) => setCivitaiImport({ url: value });
  const setStatus = (value: string) => setCivitaiImport({ status: value });
  const [importingVersion, setImportingVersion] = useState<number | null>(null);
  const [storedImportResult, setStoredImportResult] = useState<{
    resetVersion: number;
    result: CivitaiImportResult;
    matchedParams?: Partial<GenerationParams>;
  } | null>(null);
  const isImporting = importingVersion === resetVersion;
  const importResult =
    storedImportResult?.resetVersion === resetVersion
      ? storedImportResult.result
      : null;

  const importFromCivitai = async () => {
    if (!url.trim() || isImporting) return;

    const currentResetVersion = resetVersion;
    setImportingVersion(currentResetVersion);
    setStoredImportResult(null);
    setCivitaiImport({ status: "Fetching Civitai metadata...", missingResources: [] });

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

      if (
        currentResetVersion !==
        useStore.getState().civitaiImport.resetVersion
      ) return;

      if (!importResponse.ok) {
        throw new Error(importData.error || "Failed to import Civitai metadata");
      }

      const imported = importData as CivitaiImportResult;
      const modelsData = (await modelsResponse.json()) as LocalModelsResponse;
      const { matched, missing } = reconcileImportedParams(imported, modelsData);
      setStoredImportResult({
        resetVersion: currentResetVersion,
        result: imported,
        matchedParams: matched,
      });
      const appliedParams = { ...params, ...matched };

      setParams(matched);
      if (imported.imageUrl) {
        setCivitaiReference({
          imageId: imported.imageId,
          imageUrl: imported.imageUrl,
          pageUrl: imported.pageUrl,
          username: imported.username,
        });
      }
      setCivitaiImport({ missingResources: missing });
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
      if (
        currentResetVersion !==
        useStore.getState().civitaiImport.resetVersion
      ) return;
      setStatus(error instanceof Error ? error.message : "Failed to import Civitai metadata");
    } finally {
      if (
        currentResetVersion ===
        useStore.getState().civitaiImport.resetVersion
      ) {
        setImportingVersion(null);
      }
    }
  };

  return (
    <section className="space-y-3 border-b border-border/70 pb-4">
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <FieldHelp label={language === "ko" ? "Civitai에서 가져오기" : "Import from Civitai"} help={language === "ko" ? "Civitai 이미지 URL을 입력하면 공개된 프롬프트, 모델, 샘플러와 시드 정보를 현재 설정에 적용합니다." : "Paste a Civitai image URL to apply its published prompt, model, sampler, and seed settings."} />
              <p className="mt-1 text-xs text-muted-foreground">
                Paste an image URL to load prompt, sampler, seed, and resource links.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <a
                href={CIVITAI_IMAGES_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Open Civitai images"
                title="Open Civitai images"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary"
              >
                <LinkIcon className="h-4 w-4" />
              </a>
              <CopyLinkButton
                url={CIVITAI_IMAGES_URL}
                language={language}
                iconClassName="h-4 w-4"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary"
              />
            </div>
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
        </div>

        <div className="w-20 shrink-0 self-end">
          {civitaiReference ? (
            <div className="group/ref relative aspect-square overflow-hidden rounded-md border border-border">
              <img
                src={civitaiReference.imageUrl}
                alt={language === "ko" ? "레퍼런스 이미지" : "Reference image"}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={clearCivitaiReference}
                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/ref:opacity-100"
                aria-label={language === "ko" ? "레퍼런스 제거" : "Remove reference"}
                title={language === "ko" ? "레퍼런스 제거" : "Remove reference"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/50">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
      </div>

      {status && <p className="mt-2 text-xs text-muted-foreground">{status}</p>}

      <CivitaiMetadataAdvice
        report={importResult?.metadataReport}
        recommendations={importResult?.recommendations}
        language={language}
        onApply={(recommendedParams) => {
          const matched = storedImportResult?.matchedParams;
          setParams({
            ...recommendedParams,
            // Restore the locally matched models from this Civitai import even
            // if the user changed the form after importing it.
            ...(matched?.model_name ? { model_name: matched.model_name } : {}),
            ...(matched?.vae_name ? { vae_name: matched.vae_name } : {}),
            ...(matched?.loras ? { loras: matched.loras } : {}),
            ...(matched?.embeddings ? { embeddings: matched.embeddings } : {}),
            ...(recommendedParams.upscale_model_name && matched?.upscale_model_name
              ? { upscale_model_name: matched.upscale_model_name }
              : {}),
          });
          setStatus(language === "ko" ? "추천 설정을 적용했습니다." : "Applied recommended settings.");
        }}
      />

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

          updateCivitaiImportMissing((current) =>
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
