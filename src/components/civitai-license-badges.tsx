"use client";

import {
  Copyright,
  GitFork,
  Globe,
  Images,
  Scale,
  Server,
  Tag,
} from "lucide-react";
import type { CivitaiLicenseInfo } from "@/lib/types";

interface LicenseFlag {
  key: string;
  allowed: boolean;
  primary?: boolean;
  Icon: typeof Server;
  label: string;
}

export function licenseFlags(
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
          ? "Civitai 상업적 이용 가능 (Civitai 유료 생성 서비스)"
          : "Commercial use on Civitai allowed (Civitai paid generation service)"
        : ko
          ? "Civitai 상업적 이용 불가 (Civitai 유료 생성 서비스)"
          : "Commercial use on Civitai not allowed (Civitai paid generation service)",
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

export function LicenseBadges({
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
