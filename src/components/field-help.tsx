"use client";

import { CircleHelp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function FieldHelp({ label, help, className = "" }: { label: string; help: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger render={<button type="button" aria-label={`${label} help`} className="inline-flex text-muted-foreground/70 transition-colors hover:text-primary" />}>
            <CircleHelp className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent className="max-w-80 text-sm leading-relaxed">{help}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}
