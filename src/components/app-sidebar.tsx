"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Generate" },
  { href: "/models", label: "Models" },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex h-screen w-36 shrink-0 flex-col border-r border-border bg-card/30">
      <div className="border-b border-border px-3 py-4">
        <div className="text-sm font-semibold">Image Gen</div>
        <div className="text-xs text-muted-foreground">Local studio</div>
      </div>
      <div className="flex flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
