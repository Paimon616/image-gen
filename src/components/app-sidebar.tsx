"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Bookmark, BrainCircuit, DownloadCloud, Film, Images, Languages, Layers3, Search, Settings } from "lucide-react";
import { useStore, type AppLanguage } from "@/lib/store";
import { useDownloadManagerStore } from "@/lib/download-manager-store";

const NAV_ITEMS = [
  { href: "/", labels: { ko: "이미지 생성", en: "Image Generation" }, icon: Images },
  { href: "/video", labels: { ko: "비디오 생성", en: "Video Generation" }, icon: Film },
  { href: "/interrogate", labels: { ko: "프롬프트 추출", en: "Prompt Extraction" }, icon: Search },
  { href: "/models", labels: { ko: "모델", en: "Models" }, icon: Layers3 },
  { href: "/lora-training", labels: { ko: "LoRA 훈련", en: "LoRA Training" }, icon: BrainCircuit },
  { href: "/downloads", labels: { ko: "다운로드 매니저", en: "Downloads" }, icon: DownloadCloud },
  { href: "/scrap", labels: { ko: "스크랩", en: "Scrap" }, icon: Bookmark },
  { href: "/settings", labels: { ko: "설정", en: "Settings" }, icon: Settings },
];

const LANGUAGE_LABELS = {
  ko: {
    subtitle: "로컬 스튜디오",
    selectorLabel: "언어",
  },
  en: {
    subtitle: "Local studio",
    selectorLabel: "Language",
  },
} as const;

export function AppSidebar() {
  const pathname = usePathname();
  const language = useStore((state) => state.language);
  const setLanguage = useStore((state) => state.setLanguage);
  const activeDownloads = useDownloadManagerStore(
    (state) =>
      Object.values(state.entries).filter(
        (entry) => entry.status === "downloading"
      ).length
  );

  const labels = LANGUAGE_LABELS[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return (
    <nav className="flex h-screen w-44 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
            <Images className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold leading-4 text-sidebar-foreground">
              Image Gen
            </div>
            <div className="text-[11px] font-medium text-muted-foreground">
              {labels.subtitle}
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-2">
        {NAV_ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;

          const showBadge = item.href === "/downloads" && activeDownloads > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{item.labels[language]}</span>
              {showBadge && (
                <span
                  className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums ${
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : "bg-primary text-primary-foreground"
                  }`}
                  aria-label={`${activeDownloads} active downloads`}
                >
                  {activeDownloads}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <div className="mt-auto border-t border-sidebar-border p-2">
        <label
          htmlFor="app-language"
          className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold text-muted-foreground"
        >
          <Languages className="h-3.5 w-3.5" />
          {labels.selectorLabel}
        </label>
        <select
          id="app-language"
          value={language}
          onChange={(event) =>
            setLanguage(event.currentTarget.value as AppLanguage)
          }
          className="h-9 w-full rounded-md border border-sidebar-border bg-background px-2 text-sm font-medium text-sidebar-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="ko">한국어</option>
          <option value="en">English</option>
        </select>
      </div>
    </nav>
  );
}
