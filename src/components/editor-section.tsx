"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function EditorSection({ title, description, children, defaultOpen = true, badge, toggle }: {
  title: string; description?: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode;
  toggle?: { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = toggle ? toggle.checked : open;
  const activate = () => toggle
    ? toggle.onCheckedChange(!toggle.checked)
    : setOpen((value) => !value);
  return (
    <section className="relative overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.06)] transition-[border-color,box-shadow] duration-200 hover:border-primary/30 hover:shadow-[0_2px_4px_rgba(15,23,42,0.05),0_12px_30px_rgba(15,23,42,0.08)]">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={toggle ? toggle.label : title}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
        className={`group flex w-full cursor-pointer items-center gap-2 border-b px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/25 ${expanded ? "border-primary/15 bg-gradient-to-r from-primary/14 via-primary/8 to-primary/[0.02]" : "border-transparent bg-primary/8 hover:bg-primary/12"}`}
      >
        <span className="flex min-w-0 items-center gap-1">
          <span className="text-lg font-bold leading-none tracking-tight text-primary">{title}</span>
          {description && (
            <span className="inline-flex" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <TooltipProvider delay={150}>
              <Tooltip>
                <TooltipTrigger render={<button type="button" aria-label={`${title} help`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-primary/75 transition-colors hover:bg-card/70 hover:text-primary" />}>
                  <CircleHelp className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-80 text-sm leading-relaxed">{description}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1" />
        {badge}
        {toggle ? (
          <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Switch checked={toggle.checked} onCheckedChange={toggle.onCheckedChange} aria-label={toggle.label} />
          </span>
        ) : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground shadow-md ring-2 ring-card transition-[transform,box-shadow] group-hover:shadow-lg">
            <ChevronDown className={`h-4 w-4 stroke-[2.5] transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`} />
          </span>
        )}
      </div>
      <div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="min-h-0 overflow-hidden"><div className="space-y-4 p-5">{children}</div></div>
      </div>
    </section>
  );
}
