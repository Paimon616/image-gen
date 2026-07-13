"use client";

import { useEffect, useState } from "react";
import {
  Copyright,
  Download,
  ExternalLink,
  GitFork,
  Globe,
  Images,
  Loader2,
  Scale,
  Server,
  Tag,
} from "lucide-react";
import {
  RESOURCE_LABELS,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import type { CivitaiLicenseInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";

interface TokenState {
  configured: boolean;
  valid: boolean;
  checked: boolean;
}

interface DownloadProgress {
  downloaded: number;
  total: number | null;
  percent: number | null;
  message: string;
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

interface LicenseFlag {
  key: string;
  allowed: boolean;
  primary?: boolean;
  Icon: typeof Server;
  label: string;
}

function licenseFlags(
  license: CivitaiLicenseInfo,
  language: "ko" | "en"
): LicenseFlag[] {
  const ko = language === "ko";
  const flags: LicenseFlag[] = [];

  if (Array.isArray(license.allowCommercialUse)) {
    const commercial = new Set(
      license.allowCommercialUse.map((value) => value.toLowerCase())
    );

    flags.push({
      key: "rent",
      allowed: commercial.has("rent"),
      primary: true,
      Icon: Server,
      label: commercial.has("rent")
        ? ko
          ? "외부 생성 서비스에서 사용 가능 (내 사이트 제공 가능)"
          : "Usable on 3rd-party generation services (can host on your site)"
        : ko
          ? "외부 생성 서비스에서 사용 불가 (내 사이트 제공 불가)"
          : "Not allowed on 3rd-party generation services (cannot host on your site)",
    });

    flags.push({
      key: "rent-civit",
      allowed: commercial.has("rentcivit"),
      Icon: Globe,
      label: commercial.has("rentcivit")
        ? ko
          ? "Civitai 생성 서비스에서 사용 가능"
          : "Usable on Civitai's generation service"
        : ko
          ? "Civitai 생성 서비스에서 사용 불가"
          : "Not allowed on Civitai's generation service",
    });

    flags.push({
      key: "image",
      allowed: commercial.has("image"),
      Icon: Images,
      label: commercial.has("image")
        ? ko
          ? "생성한 이미지 판매 가능"
          : "Selling generated images allowed"
        : ko
          ? "생성한 이미지 판매 불가"
          : "Selling generated images not allowed",
    });

    flags.push({
      key: "sell",
      allowed: commercial.has("sell"),
      Icon: Tag,
      label: commercial.has("sell")
        ? ko
          ? "모델/머지 판매 가능"
          : "Selling the model or merges allowed"
        : ko
          ? "모델/머지 판매 불가"
          : "Selling the model or merges not allowed",
    });
  }

  if (typeof license.allowNoCredit === "boolean") {
    const allowed = license.allowNoCredit;
    flags.push({
      key: "credit",
      allowed,
      Icon: Copyright,
      label: allowed
        ? ko
          ? "크레딧 표기 불필요"
          : "Credit not required"
        : ko
          ? "크레딧 표기 필요"
          : "Credit required",
    });
  }

  if (typeof license.allowDerivatives === "boolean") {
    const allowed = license.allowDerivatives;
    flags.push({
      key: "derivatives",
      allowed,
      Icon: GitFork,
      label: allowed
        ? ko
          ? "2차 창작/머지 허용"
          : "Derivatives / merges allowed"
        : ko
          ? "2차 창작/머지 불가"
          : "No derivatives / merges",
    });
  }

  if (typeof license.allowDifferentLicense === "boolean") {
    const allowed = license.allowDifferentLicense;
    flags.push({
      key: "different-license",
      allowed,
      Icon: Scale,
      label: allowed
        ? ko
          ? "머지에 다른 라이선스 허용"
          : "Different license on merges allowed"
        : ko
          ? "동일 라이선스 유지 필요"
          : "Same license required",
    });
  }

  return flags;
}

function LicenseBadges({
  license,
  language,
}: {
  license: CivitaiLicenseInfo;
  language: "ko" | "en";
}) {
  const ko = language === "ko";
  const flags = licenseFlags(license, language);
  if (flags.length === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {flags.map((flag) =>
        flag.primary ? (
          <span
            key={flag.key}
            title={flag.label}
            aria-label={flag.label}
            className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-semibold ${
              flag.allowed
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/15 text-destructive"
            }`}
          >
            <flag.Icon className="h-3 w-3" />
            {flag.allowed
              ? ko
                ? "사이트 제공 가능"
                : "Hostable"
              : ko
                ? "사이트 제공 불가"
                : "Not hostable"}
          </span>
        ) : (
          <span
            key={flag.key}
            title={flag.label}
            aria-label={flag.label}
            className={`inline-flex h-5 w-5 items-center justify-center rounded ${
              flag.allowed
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/15 text-destructive"
            }`}
          >
            <flag.Icon className="h-3 w-3" />
          </span>
        )
      )}
    </div>
  );
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

function progressText(progress: DownloadProgress) {
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
  const [downloadingKey, setDownloadingKey] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgress>>(
    {}
  );
  const [downloadStatus, setDownloadStatus] = useState("");
  const [licenses, setLicenses] = useState<Record<number, CivitaiLicenseInfo>>({});

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

  const updateProgress = (key: string, update: Partial<DownloadProgress>) => {
    setDownloadProgress((current) => ({
      ...current,
      [key]: {
        downloaded: current[key]?.downloaded ?? 0,
        total: current[key]?.total ?? null,
        percent: current[key]?.percent ?? null,
        message: current[key]?.message ?? "Downloading...",
        ...update,
      },
    }));
  };

  const handleDownloadEvent = (
    key: string,
    resource: MissingResource,
    event: Record<string, unknown>
  ) => {
    if (event.type === "status") {
      updateProgress(key, { message: String(event.message ?? "Working...") });
      return;
    }

    if (event.type === "progress") {
      updateProgress(key, {
        downloaded: Number(event.downloaded ?? 0),
        total: typeof event.total === "number" ? Number(event.total) : null,
        percent: typeof event.percent === "number" ? Number(event.percent) : null,
        message: "Downloading...",
      });
      return;
    }

    if (event.type === "complete") {
      const path =
        typeof event.filename === "string"
          ? event.filename
          : typeof event.path === "string"
            ? event.path
            : "";

      updateProgress(key, {
        percent: 100,
        message: language === "ko" ? "완료" : "Complete",
      });
      window.dispatchEvent(
        new CustomEvent("local-models-changed", {
          detail: { resource, path, metadata: event.metadata },
        })
      );
      onDownloaded?.(resource, path);
      setDownloadStatus(
        language === "ko"
          ? `다운로드 완료: ${path || resource.name}`
          : `Downloaded: ${path || resource.name}`
      );
      return;
    }

    if (event.type === "error") {
      throw new Error(String(event.error ?? "Failed to download Civitai resource"));
    }
  };

  const downloadResource = async (resource: MissingResource, key: string) => {
    if (downloadingKey) return;

    setDownloadingKey(key);
    setDownloadStatus("");
    updateProgress(key, {
      downloaded: 0,
      total: null,
      percent: null,
      message: "Starting download...",
    });

    try {
      const response = await fetch("/api/civitai/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to download Civitai resource");
      }

      if (!response.body) {
        throw new Error("Download progress stream did not start");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          handleDownloadEvent(key, resource, JSON.parse(line) as Record<string, unknown>);
        }
      }

      if (buffer.trim()) {
        handleDownloadEvent(
          key,
          resource,
          JSON.parse(buffer) as Record<string, unknown>
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to download Civitai resource";
      updateProgress(key, { message });
      setDownloadStatus(message);
    } finally {
      setDownloadingKey("");
    }
  };

  if (resources.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-dashed border-destructive/30 bg-destructive/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-destructive">
          {language === "ko" ? "누락된 로컬 리소스" : "Missing local resources"}
        </div>
        {token.checked && token.configured && !token.valid && (
          <div className="text-[11px] text-muted-foreground">
            {language === "ko"
              ? "Civitai 토큰을 확인할 수 없습니다."
              : "Civitai token is not valid."}
          </div>
        )}
      </div>
      <div className="mt-2 space-y-1.5">
        {resources.map((resource, index) => {
          const key = missingResourceKey(resource, index);
          const downloading = downloadingKey === key;
          const downloadable = canDownloadResource(resource, token);
          const progress = downloadProgress[key];
          const progressPercent = progress?.percent ?? 0;
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
                      disabled={Boolean(downloadingKey)}
                      onClick={() => void downloadResource(resource, key)}
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
              {progress && (
                <div className="mt-1.5 grid gap-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {progressText(progress)}
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
