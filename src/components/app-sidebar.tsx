"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Images, Layers3 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Generate", icon: Images },
  { href: "/models", label: "Models", icon: Layers3 },
  { href: "/history", label: "History", icon: History },
];

export function AppSidebar() {
  const pathname = usePathname();

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
              Local studio
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
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
