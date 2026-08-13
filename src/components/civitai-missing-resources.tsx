"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Download, DownloadCloud, ExternalLink, Loader2 } from "lucide-react";
import {
  RESOURCE_LABELS,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import type { CivitaiLicenseInfo } from "@/lib/types";
import { LicenseBadges } from "@/components/civitai-license-badges";
import { CopyLinkButton } from "@/components/copy-link-button";
import { Button } from "@/components/ui/button";
import { downloadResourceKey, useDownloadStore } from "@/lib/download-store";

interface TokenState {
  configured: boolean;
  valid: boolean;
  checked: boolean;
}

interface CivitaiMissingResourcesProps {
  resources: MissingResource[];
  language?: "ko" | "en";
  onDownloaded?: (resource: MissingResource, path: string) => void;
  // Missing *local* files are irrelevant when generating on a remote RunPod pod;
  // pod-side presence is verified separately. Hide the banner in that case.
  hidden?: boolean;
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

export function CivitaiMissingResources({
  resources,
  language = "en",
  onDownloaded,
  hidden = false,
}: CivitaiMissingResourcesProps) {
  const [token, setToken] = useState<TokenState>({
    configured: false,
    valid: false,
    checked: false,
  });
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
    void startDownload(
      downloadResourceKey(resource),
      resource,
      (downloadedResource, path) => {
        onDownloaded?.(downloadedResource, path);
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
  const activeDownloadCount = resources.filter(
    (resource) =>
      downloads[downloadResourceKey(resource)]?.status === "downloading"
  ).length;

  const downloadAll = () => {
    pendingDownloads.forEach((resource) => downloadResource(resource));
  };

  if (hidden || resources.length === 0) return null;

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
          const complete = entry?.status === "complete";
          const downloadable = canDownloadResource(resource, token);
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
                      disabled={downloading || complete}
                      onClick={() => downloadResource(resource)}
                      aria-label={`Download ${resource.name}`}
                      title="Download to ComfyUI models"
                    >
                      {downloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : complete ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Download className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </span>
              </div>
              {entry?.status === "downloading" && (
                <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {entry.percent !== null
                    ? `${Math.round(entry.percent)}%`
                    : language === "ko"
                      ? "받는 중"
                      : "downloading"}
                </div>
              )}
              {entry?.status === "complete" && (
                <div className="mt-1 flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-500">
                  <Check className="h-3 w-3" />
                  {language === "ko" ? "완료" : "done"}
                </div>
              )}
              {entry?.status === "error" && (
                <div className="mt-1 text-[11px] font-medium text-destructive">
                  {language === "ko" ? "실패" : "failed"}
                </div>
              )}
              {license && <LicenseBadges license={license} language={language} />}
            </div>
          );
        })}
      </div>
      {activeDownloadCount > 0 && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {language === "ko"
            ? `${activeDownloadCount}개 다운로드가 백그라운드에서 진행 중입니다. `
            : `${activeDownloadCount} download(s) running in the background. `}
          <Link href="/downloads" className="font-semibold text-primary underline-offset-2 hover:underline">
            {language === "ko" ? "다운로드 매니저에서 확인" : "Open Download Manager"}
          </Link>
        </p>
      )}
    </div>
  );
}
