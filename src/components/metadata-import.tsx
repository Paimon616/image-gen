"use client";

import { useRef, useState } from "react";
import { FileJson, Loader2, Upload } from "lucide-react";
import { useStore } from "@/lib/store";
import type { GenerationParams, ImportedCivitaiResource } from "@/lib/types";
import {
  parseGenerationMetadataJson,
  reconcileMetadataResources,
} from "@/lib/generation-metadata";
import {
  type LocalModelsResponse,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import { CivitaiMissingResources } from "@/components/civitai-missing-resources";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

function localResourcePath(resource: MissingResource, path: string) {
  const trimmed = path.trim();

  if (resource.type === "checkpoint") {
    return trimmed.replace(/^checkpoints\//, "");
  }
  if (resource.type === "lora") {
    return trimmed.replace(/^loras\//, "");
  }
  if (resource.type === "embedding") {
    return trimmed.replace(/^embeddings\//, "");
  }
  if (resource.type === "vae") {
    return trimmed.replace(/^vae\//, "");
  }
  if (resource.type === "upscaler") {
    return trimmed.replace(/^upscale_models\//, "");
  }

  return trimmed;
}

async function searchCivitaiResource(resource: MissingResource) {
  if (resource.url && resource.modelVersionId) return resource;

  const params = new URLSearchParams({
    query: resource.name,
    type: resource.type,
  });
  const response = await fetch(`/api/civitai/search?${params}`, {
    cache: "no-store",
  });

  if (!response.ok) return resource;

  const data = (await response.json()) as {
    resources?: ImportedCivitaiResource[];
  };
  const matched = data.resources?.[0];

  return matched
    ? {
        ...resource,
        ...matched,
        weight: resource.weight ?? matched.weight,
        reason: resource.reason,
      }
    : resource;
}

function paramsWithDownloadedResource(
  params: GenerationParams,
  resource: MissingResource,
  downloadedPath: string
) {
  const path = localResourcePath(resource, downloadedPath);

  if (!path) return params;

  if (resource.type === "checkpoint") {
    return { ...params, model_name: path };
  }
  if (resource.type === "lora") {
    return {
      ...params,
      loras: [
        ...params.loras.filter((lora) => lora.path !== path),
        { path, scale: resource.weight ?? 0.8 },
      ],
    };
  }
  if (resource.type === "embedding") {
    return {
      ...params,
      embeddings: [
        ...params.embeddings.filter((embedding) => embedding.path !== path),
        { path, tokens: resource.name },
      ],
    };
  }
  if (resource.type === "vae") {
    return { ...params, vae_name: path };
  }
  if (resource.type === "upscaler") {
    return { ...params, upscale_model_name: path };
  }

  return params;
}

export function MetadataImport() {
  const { setParams, language } = useStore();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [rawMetadata, setRawMetadata] = useState("");
  const [status, setStatus] = useState("");
  const [missingResources, setMissingResources] = useState<MissingResource[]>([]);
  const [isApplying, setIsApplying] = useState(false);

  const applyMetadata = async () => {
    if (!rawMetadata.trim() || isApplying) return;

    setIsApplying(true);
    setStatus(language === "ko" ? "메타데이터를 확인하는 중..." : "Checking metadata...");
    setMissingResources([]);

    try {
      const parsed = parseGenerationMetadataJson(rawMetadata);
      const modelsResponse = await fetch("/api/models", { cache: "no-store" });
      const models = (await modelsResponse.json()) as LocalModelsResponse;
      const { params, missing } = reconcileMetadataResources(parsed, models);

      setParams(params);

      const enrichedMissing = await Promise.all(missing.map(searchCivitaiResource));

      setMissingResources(enrichedMissing);
      setStatus(
        enrichedMissing.length > 0
          ? language === "ko"
            ? `입력값을 채웠고, 로컬에 없는 리소스 ${enrichedMissing.length}개를 찾았습니다.`
            : `Filled the form. ${enrichedMissing.length} local resources are missing.`
          : language === "ko"
            ? "메타데이터를 현재 입력창에 모두 적용했습니다."
            : "Metadata was applied to the current form."
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : language === "ko"
            ? "메타데이터 적용에 실패했습니다."
            : "Failed to apply metadata."
      );
    } finally {
      setIsApplying(false);
    }
  };

  const readMetadataFile = async (file: File | undefined) => {
    if (!file) return;

    setRawMetadata(await file.text());
    setStatus(language === "ko" ? `${file.name} 파일을 불러왔습니다.` : `Loaded ${file.name}.`);
  };

  return (
    <section className="rounded-md border border-border bg-card/85 p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <Label className="text-xs text-muted-foreground">Metadata</Label>
          <p className="mt-1 text-xs text-muted-foreground">
            생성 이미지 JSON이나 받은 메타데이터를 현재 입력창에 적용합니다.
          </p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => fileInputRef.current?.click()}
          aria-label="Upload metadata JSON"
          title="Upload metadata JSON"
        >
          <Upload className="h-3.5 w-3.5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            void readMetadataFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>

      <Textarea
        value={rawMetadata}
        onChange={(event) => setRawMetadata(event.target.value)}
        placeholder='{"params":{"prompt":"...","model_name":"...","loras":[...]}}'
        className="h-24 resize-none text-xs font-mono"
      />

      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {status || "JSON을 붙여넣거나 파일을 선택하세요."}
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => void applyMetadata()}
          disabled={!rawMetadata.trim() || isApplying}
        >
          {isApplying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              적용 중
            </>
          ) : (
            <>
              <FileJson className="h-3.5 w-3.5" />
              적용
            </>
          )}
        </Button>
      </div>

      <CivitaiMissingResources
        resources={missingResources}
        language={language}
        onDownloaded={(resource, downloadedPath) => {
          const currentParams = useStore.getState().params;
          const nextParams = paramsWithDownloadedResource(
            currentParams,
            resource,
            downloadedPath
          );

          setParams(nextParams);
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
