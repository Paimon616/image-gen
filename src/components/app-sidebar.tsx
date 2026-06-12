"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bookmark, Images, Languages, Layers3 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", labels: { ko: "생성", en: "Generate" }, icon: Images },
  { href: "/models", labels: { ko: "모델", en: "Models" }, icon: Layers3 },
  { href: "/scrap", labels: { ko: "스크랩", en: "Scrap" }, icon: Bookmark },
];

const LANGUAGE_STORAGE_KEY = "image-gen-language";
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

type Language = keyof typeof LANGUAGE_LABELS;

function isLanguage(value: string | null): value is Language {
  return value === "ko" || value === "en";
}

export function AppSidebar() {
  const pathname = usePathname();
  const [language, setLanguage] = useState<Language>(() => {
    if (typeof window === "undefined") {
      return "ko";
    }

    const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(savedLanguage) ? savedLanguage : "ko";
  });

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  const handleLanguageChange = (nextLanguage: Language) =>
    setLanguage(nextLanguage);

  const labels = LANGUAGE_LABELS[language];

  return (
    <nav className="flex h-screen w-40 shrink-0 flex-col border-r border-border bg-sidebar">
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
          const active = pathname === item.href;
          const Icon = item.icon;

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
              <Icon className="h-4 w-4" />
              {item.labels[language]}
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
            handleLanguageChange(event.currentTarget.value as Language)
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
