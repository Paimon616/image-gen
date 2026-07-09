"use client";

import { ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ModelRisk {
  level: "HIGH" | "MEDIUM" | "OK";
  reason?: string;
  flags?: string[];
  allow_commercial_use?: string;
}

const FLAG_LABELS: Record<string, string> = {
  person: "실인물 유사성",
  nsfw: "NSFW",
  ip: "IP/저작권",
};

const LEVEL_META = {
  HIGH: {
    label: "제공 부적합",
    Icon: ShieldAlert,
    icon: "text-red-600",
    ring: "border-red-600/30 bg-red-600/10",
  },
  MEDIUM: {
    label: "확인/조건부",
    Icon: TriangleAlert,
    icon: "text-amber-500",
    ring: "border-amber-500/30 bg-amber-500/10",
  },
  OK: {
    label: "허용 후보",
    Icon: ShieldCheck,
    icon: "text-green-600",
    ring: "border-green-600/30 bg-green-600/10",
  },
} as const;

function commercialLabel(value: string | undefined) {
  if (value === "Y") return "상업적 사용 가능";
  if (value === "N") return "상업적 사용 불가";
  return null;
}

export function ModelRiskBadge({
  risk,
  showOk = false,
  size = 16,
  className = "",
}: {
  risk: ModelRisk | null | undefined;
  showOk?: boolean;
  size?: number;
  className?: string;
}) {
  if (!risk) return null;
  if (risk.level === "OK" && !showOk) return null;

  const meta = LEVEL_META[risk.level];
  const { Icon } = meta;
  const commercial = commercialLabel(risk.allow_commercial_use);
  const flags = (risk.flags ?? []).map((flag) => FLAG_LABELS[flag] ?? flag);

  return (
    <TooltipProvider delay={120}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              tabIndex={0}
              aria-label={`라이선스 경고: ${meta.label}`}
              onClick={(event) => event.stopPropagation()}
              className={`inline-flex items-center justify-center rounded-md border p-0.5 ${meta.ring} ${className}`}
            />
          }
        >
          <Icon width={size} height={size} className={meta.icon} />
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <div className="space-y-1.5 py-0.5 text-left">
            <div className="flex items-center gap-1.5 font-semibold">
              <Icon width={13} height={13} className={meta.icon} />
              <span>
                {risk.level} · {meta.label}
              </span>
            </div>
            {risk.reason && (
              <div className="leading-snug opacity-90">{risk.reason}</div>
            )}
            {flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {flags.map((flag) => (
                  <span
                    key={flag}
                    className="rounded bg-background/20 px-1.5 py-0.5 text-[10px] font-medium"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            )}
            {commercial && <div className="opacity-90">{commercial}</div>}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
