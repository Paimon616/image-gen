"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyLinkButtonProps {
  url: string;
  language?: "ko" | "en";
  className?: string;
  iconClassName?: string;
  showLabel?: boolean;
  stopPropagation?: boolean;
}

async function writeToClipboard(url: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(url);
      return;
    } catch {
      // fall through to legacy path
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = url;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function CopyLinkButton({
  url,
  language = "en",
  className,
  iconClassName = "h-3.5 w-3.5",
  showLabel = false,
  stopPropagation = false,
}: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  const ko = language === "ko";
  const label = copied
    ? ko
      ? "복사됨"
      : "Copied"
    : ko
      ? "링크 복사"
      : "Copy link";

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (stopPropagation) event.stopPropagation();

    await writeToClipboard(url);
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      className={className}
    >
      {copied ? (
        <Check className={iconClassName} />
      ) : (
        <Copy className={iconClassName} />
      )}
      {showLabel && <span>{label}</span>}
    </button>
  );
}
