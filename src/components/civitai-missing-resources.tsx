"use client";

import { useEffect, useState } from "react";
import { Download, DownloadCloud, ExternalLink, Loader2 } from "lucide-react";
import {
  RESOURCE_LABELS,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import type { CivitaiLicenseInfo } from "@/lib/types";
import { LicenseBadges } from "@/components/civitai-license-badges";
import { CopyLinkButton } from "@/components/copy-link-button";
import { Button } from "@/components/ui/button";
import {
  downloadResourceKey,
  useDownloadStore,
  type DownloadEntry,
} from "@/lib/download-store";

interface TokenState {
  configured: boolean;
  valid: boolean;
  checked: boolean;
}

interface CivitaiMissingResourcesProps {
  resources: MissingResource[];
  language?: "ko" | "en";
  onDownloaded?: (resource: MissingResource, path: string) => void;
}

function missingResourceKey(resource: MissingResource, index: number) {
  return [
    resource.type,
    resource.modelVersionId ?? "",
    resource.name,
    resource.versionName ?? "",
    index,
  ].join(":");
}

function canDownloadResource(resource: MissingResource, token: TokenState) {
  return token.valid && Boolean(resource.url && resource.modelVersionId);
}

function formatBytes(value: number) {
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function progressText(progress: DownloadEntry) {
  if (progress.percent !== null) {
    return progress.total
      ? `${progress.percent}% · ${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
      : `${progress.percent}%`;
  }

  if (progress.downloaded > 0) return formatBytes(progress.downloaded);
  return progress.message;
}

export function CivitaiMissingResources({
  resources,
  language = "en",
  onDownloaded,
}: CivitaiMissingResourcesProps) {
  const [token, setToken] = useState<TokenState>({
    configured: false,
    valid: false,
    checked: false,
  });
  const [downloadStatus, setDownloadStatus] = useState("");
  const [licenses, setLicenses] = useState<Record<number, CivitaiLicenseInfo>>({});
  const downloads = useDownloadStore((state) => state.downloads);
  const startDownload = useDownloadStore((state) => state.startDownload);

  useEffect(() => {
    if (resources.length === 0) return;

    let canceled = false;

    fetch("/api/civitai/token", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (canceled) return;
        setToken({
          configured: Boolean(data.configured),
          valid: Boolean(data.valid),
          checked: true,
        });
      })
      .catch(() => {
        if (canceled) return;
        setToken({ configured: false, valid: false, checked: true });
      });

    return () => {
      canceled = true;
    };
  }, [resources.length]);

  const modelIdsKey = resources
    .map((resource) => resource.modelId)
    .filter((modelId): modelId is number => typeof modelId === "number")
    .join(",");

  useEffect(() => {
    if (!modelIdsKey) return;

    let canceled = false;
    const modelIds = modelIdsKey.split(",").map(Number);

    fetch("/api/civitai/license", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelIds }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (canceled) return;
        setLicenses(
          (data.licenses ?? {}) as Record<number, CivitaiLicenseInfo>
        );
      })
      .catch(() => {
        if (canceled) return;
        setLicenses({});
      });

    return () => {
      canceled = true;
    };
  }, [modelIdsKey]);

  const downloadResource = (resource: MissingResource) => {
    setDownloadStatus("");
    void startDownload(
      downloadResourceKey(resource),
      resource,
      (downloadedResource, path) => {
        onDownloaded?.(downloadedResource, path);
        setDownloadStatus(
          language === "ko"
            ? `다운로드 완료: ${path || downloadedResource.name}`
            : `Downloaded: ${path || downloadedResource.name}`
        );
      }
    );
  };

  const downloadableResources = resources.filter((resource) =>
    canDownloadResource(resource, token)
  );
  const pendingDownloads = downloadableResources.filter((resource) => {
    const entry = downloads[downloadResourceKey(resource)];
    return entry?.status !== "downloading" && entry?.status !== "complete";
  });

  const downloadAll = () => {
    pendingDownloads.forEach((resource) => downloadResource(resource));
  };

  if (resources.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-dashed border-destructive/30 bg-destructive/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-destructive">
          {language === "ko" ? "누락된 로컬 리소스" : "Missing local resources"}
        </div>
        <div className="flex items-center gap-2">
          {token.checked && token.configured && !token.valid && (
            <div className="text-[11px] text-muted-foreground">
              {language === "ko"
                ? "Civitai 토큰을 확인할 수 없습니다."
                : "Civitai token is not valid."}
            </div>
          )}
          {downloadableResources.length > 1 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-[11px]"
              disabled={pendingDownloads.length === 0}
              onClick={downloadAll}
              title={
                language === "ko"
                  ? "누락된 리소스 모두 다운로드"
                  : "Download all missing resources"
              }
            >
              <DownloadCloud className="h-3.5 w-3.5" />
              {language === "ko"
                ? `모두 다운로드${
                    pendingDownloads.length > 0
                      ? ` (${pendingDownloads.length})`
                      : ""
                  }`
                : `Download all${
                    pendingDownloads.length > 0
                      ? ` (${pendingDownloads.length})`
                      : ""
                  }`}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {resources.map((resource, index) => {
          const key = missingResourceKey(resource, index);
          const entry = downloads[downloadResourceKey(resource)];
          const downloading = entry?.status === "downloading";
          const downloadable = canDownloadResource(resource, token);
          const progressPercent = entry?.percent ?? 0;
          const license =
            typeof resource.modelId === "number"
              ? licenses[resource.modelId]
              : undefined;

          return (
            <div
              key={key}
              className="rounded-md bg-background/80 px-2 py-1.5 text-xs"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-semibold">
                    {RESOURCE_LABELS[resource.type]}
                  </span>
                  <span className="text-muted-foreground"> &middot; </span>
                  <span>{resource.name}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {resource.url ? (
                    <>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${resource.name} on Civitai`}
                        title="Open Civitai page"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/35 hover:text-primary"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      <CopyLinkButton
                        url={resource.url}
                        language={language}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary/35 hover:text-primary"
                      />
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {language === "ko" ? "Civitai 링크 없음" : "Not on Civitai"}
                    </span>
                  )}
                  {downloadable && (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      disabled={downloading}
                      onClick={() => downloadResource(resource)}
                      aria-label={`Download ${resource.name}`}
                      title="Download to ComfyUI models"
                    >
                      {downloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </span>
              </div>
              {license && <LicenseBadges license={license} language={language} />}
              {entry && (
                <div className="mt-1.5 grid gap-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full transition-all ${
                        entry.status === "error" ? "bg-destructive" : "bg-primary"
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {entry.status === "complete"
                      ? language === "ko"
                        ? "완료"
                        : "Complete"
                      : progressText(entry)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {downloadStatus && (
        <p className="mt-2 text-xs text-muted-foreground">{downloadStatus}</p>
      )}
    </div>
  );
}
