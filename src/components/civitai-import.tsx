"use client";

import { useState } from "react";
import { ExternalLink, LinkIcon, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import type {
  CivitaiImportResult,
  GenerationParams,
  ImportedCivitaiResource,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface LocalModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  civitai_url?: string | null;
}

interface LocalModelsResponse {
  checkpointAssets?: LocalModelAsset[];
  loraAssets?: LocalModelAsset[];
  embeddingAssets?: LocalModelAsset[];
  vaeAssets?: LocalModelAsset[];
}

interface MissingResource extends ImportedCivitaiResource {
  reason: string;
}

const RESOURCE_LABELS: Record<ImportedCivitaiResource["type"], string> = {
  checkpoint: "Checkpoint",
  lora: "LoRA",
  embedding: "Embedding",
  vae: "VAE",
  other: "Resource",
};

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/\.(safetensors|ckpt|pt|pth)$/i, "")
    .replace(/[^a-z0-9]+/g, "");
}

function findLocalAsset(assets: LocalModelAsset[], resource: ImportedCivitaiResource) {
  const targetName = normalizeToken(resource.name);
  const targetHash = resource.hash?.toLowerCase();
  const targetModelId = resource.modelId ? String(resource.modelId) : "";
  const targetVersionId = resource.modelVersionId ? String(resource.modelVersionId) : "";

  return assets.find((asset) => {
    const candidates = [
      asset.path,
      asset.name,
      asset.version ?? "",
      asset.civitai_url ?? "",
    ]
      .map(normalizeToken)
      .filter(Boolean);
    const civitaiUrl = asset.civitai_url ?? "";

    return (
      candidates.some(
        (candidate) => candidate.includes(targetName) || targetName.includes(candidate)
      ) ||
      Boolean(
        targetHash && candidates.some((candidate) => candidate.includes(targetHash))
      ) ||
      Boolean(targetModelId && civitaiUrl.includes(`/models/${targetModelId}`)) ||
      Boolean(targetVersionId && civitaiUrl.includes(`modelVersionId=${targetVersionId}`))
    );
  });
}

function resourceBucket(
  models: LocalModelsResponse,
  type: ImportedCivitaiResource["type"]
) {
  if (type === "checkpoint") return models.checkpointAssets ?? [];
  if (type === "lora") return models.loraAssets ?? [];
  if (type === "embedding") return models.embeddingAssets ?? [];
  if (type === "vae") return models.vaeAssets ?? [];
  return [];
}

function reconcileImportedParams(
  imported: CivitaiImportResult,
  models: LocalModelsResponse,
  currentParams: GenerationParams
) {
  const matched: Partial<GenerationParams> = { ...imported.params };
  const missing: MissingResource[] = [];
  const matchedLoras: GenerationParams["loras"] = [];
  const matchedEmbeddings: GenerationParams["embeddings"] = [];

  imported.resources.forEach((resource) => {
    if (resource.type === "other") return;

    const match = findLocalAsset(resourceBucket(models, resource.type), resource);

    if (!match) {
      missing.push({
        ...resource,
        reason: "Local file not found",
      });
      return;
    }

    if (resource.type === "checkpoint") {
      matched.model_name = match.path;
    }

    if (resource.type === "lora") {
      matchedLoras.push({
        path: match.path,
        scale: resource.weight ?? 0.8,
      });
    }

    if (resource.type === "embedding") {
      matchedEmbeddings.push({
        path: match.path,
        tokens: resource.name,
      });
    }

    if (resource.type === "vae") {
      matched.vae_name = match.path;
    }
  });

  const importedCheckpoint = imported.resources.some(
    (resource) => resource.type === "checkpoint"
  );
  const importedVae = imported.resources.some((resource) => resource.type === "vae");

  if (importedCheckpoint && !matched.model_name) {
    matched.model_name = currentParams.model_name;
  }
  if (importedVae && !matched.vae_name) {
    matched.vae_name = currentParams.vae_name;
  }
  if (
    matchedLoras.length > 0 ||
    imported.resources.some((resource) => resource.type === "lora")
  ) {
    matched.loras = matchedLoras;
  }
  if (
    matchedEmbeddings.length > 0 ||
    imported.resources.some((resource) => resource.type === "embedding")
  ) {
    matched.embeddings = matchedEmbeddings;
  }

  return { matched, missing };
}

export function CivitaiImport() {
  const { params, setParams } = useStore();
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

      const modelsData = (await modelsResponse.json()) as LocalModelsResponse;
      const { matched, missing } = reconcileImportedParams(
        importData as CivitaiImportResult,
        modelsData,
        params
      );

      setParams(matched);
      setMissingResources(missing);
      setStatus(
        missing.length > 0
          ? `Imported settings. ${missing.length} local resource${missing.length > 1 ? "s are" : " is"} missing.`
          : "Imported settings and matched local resources."
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
        <LinkIcon className="h-4 w-4 shrink-0 text-primary" />
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
          placeholder="https://civitai.com/images/115144811"
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

      {missingResources.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-destructive/30 bg-destructive/10 p-3">
          <div className="text-xs font-semibold text-destructive">
            Missing local resources
          </div>
          <div className="mt-2 space-y-1.5">
            {missingResources.map((resource, index) => (
              <a
                key={`${resource.type}-${resource.name}-${index}`}
                href={resource.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-background/80 px-2 py-1.5 text-xs hover:text-primary"
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold">
                    {RESOURCE_LABELS[resource.type]}
                  </span>
                  <span className="text-muted-foreground"> · </span>
                  <span>{resource.name}</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
