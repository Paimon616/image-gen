"use client";

import { useState } from "react";
import { Layers, Loader2, X } from "lucide-react";

import { FieldHelp } from "@/components/field-help";
import { Button } from "@/components/ui/button";
import type { ConsistencySheetImage } from "@/lib/consistency-sheet";
import { directionalFamily } from "@/lib/directional-reference";
import { useDirectionalReferenceStore } from "@/lib/directional-reference-store";
import { useStore } from "@/lib/store";

function absoluteUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

/**
 * 방향별 참조 (시트): links a character sheet whose views (front, side, back,
 * face) are swapped in per image by the direction the shot faces. Sits under
 * the character reference on the generator.
 */
export function DirectionalSheetPicker() {
  const { params, language } = useStore();
  const ko = language === "ko";
  const { linked, enabled, setLinked, setEnabled } = useDirectionalReferenceStore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheets, setSheets] = useState<ConsistencySheetImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const family = directionalFamily(params.model_name ?? "");

  const openPicker = async () => {
    setPickerOpen(true);
    if (sheets) return;
    try {
      const res = await fetch("/api/consistency-sheet/images", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { images?: ConsistencySheetImage[] };
      setSheets((data.images ?? []).filter((image) => image.params?.mode === "character"));
    } catch {
      setSheets([]);
    }
  };

  const pickSheet = async (sheet: ConsistencySheetImage) => {
    setPickerOpen(false);
    setBusy(true);
    setMessage(ko ? "시트에서 정면 · 옆 · 뒤 · 얼굴을 찾는 중..." : "Finding the front, side, back and face on the sheet...");
    try {
      const res = await fetch("/api/reference-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sheet.url }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        front?: string | null;
        side?: string | null;
        back?: string | null;
        face?: string | null;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "reference-set failed");
      setLinked({
        sheetUrl: sheet.url,
        front: absoluteUrl(data.front),
        side: absoluteUrl(data.side),
        back: absoluteUrl(data.back),
        face: absoluteUrl(data.face),
      });
      const missing = [
        !data.side && (ko ? "옆" : "side"),
        !data.back && (ko ? "뒤" : "back"),
        !data.face && (ko ? "얼굴" : "face"),
      ].filter(Boolean);
      setMessage(
        missing.length
          ? ko
            ? `연결했습니다. ${missing.join(" · ")}은(는) 시트에서 찾지 못해 그 방향은 정면 참조를 씁니다.`
            : `Linked. No ${missing.join(" / ")} found; those views use the front reference.`
          : ""
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-1.5 rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <FieldHelp
          label={ko ? "방향별 참조 (시트)" : "Directional references (sheet)"}
          help={
            ko
              ? "캐릭터 시트를 연결하면 장면 방향에 맞는 칸을 참조로 넣습니다. 프롬프트에 from behind / 뒷모습이면 뒷모습, from side / profile / 옆모습이면 옆모습 칸을 쓰고, looking back처럼 얼굴도 보이면 얼굴 칸을 함께 넣습니다. 생성 버튼과 '레퍼런스로 다양하게 뽑기' 모두에 적용됩니다. Krea 2는 Identity Edit(정면은 화면의 캐릭터 참조 그대로), SDXL·Illustrious는 IP-Adapter(방향 칸) + PuLID(얼굴, 얼굴이 보일 때만)로 넣습니다."
              : "Link a character sheet and each image gets the view that matches its direction: from behind → back view, from side / profile → side view, plus the face when it also shows (looking back). Applies to Generate and to the varied batch. Krea 2 uses Identity Edit (front keeps the on-screen reference); SDXL / Illustrious uses IP-Adapter for the view plus PuLID for the face when one is visible."
          }
        />
        <div className="flex shrink-0 items-center gap-1">
          {linked && (
            <label className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
                className="accent-primary"
              />
              {ko ? "사용" : "On"}
            </label>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => void openPicker()}
            disabled={busy}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers className="h-3.5 w-3.5" />}
            {linked ? (ko ? "바꾸기" : "Change") : ko ? "시트 연결" : "Link sheet"}
          </Button>
          {linked && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => setLinked(null)}
              aria-label={ko ? "시트 연결 해제" : "Unlink sheet"}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {linked && (
        <div className={`grid grid-cols-4 gap-1.5 ${enabled ? "" : "opacity-40"}`}>
          {(
            [
              ["front", ko ? "정면" : "Front", linked.front],
              ["side", ko ? "옆" : "Side", linked.side],
              ["back", ko ? "뒤" : "Back", linked.back],
              ["face", ko ? "얼굴" : "Face", linked.face],
            ] as const
          ).map(([key, label, src]) => (
            <div key={key} className="space-y-0.5">
              <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded border border-border bg-background">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={label} className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">{ko ? "없음" : "none"}</span>
                )}
              </div>
              <p className="truncate text-center text-[10px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      )}
      {linked && enabled && family === "none" && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          {ko
            ? "지금 모델은 참조 이미지를 쓰지 않아 방향별 참조가 적용되지 않습니다 (Krea 2 · SDXL · Illustrious만)."
            : "The current model takes no reference images, so directional references are not applied (Krea 2, SDXL, Illustrious only)."}
        </p>
      )}
      {message && <p className="text-[11px] text-muted-foreground">{message}</p>}

      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPickerOpen(false)}
          role="presentation"
        >
          <div
            className="max-h-[80vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-card p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={ko ? "연결할 캐릭터 시트" : "Character sheet to link"}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{ko ? "연결할 캐릭터 시트" : "Character sheet to link"}</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {sheets === null ? (
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            ) : sheets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {ko ? "일관성 시트 화면에서 캐릭터 시트를 먼저 만드세요." : "Make a character sheet on the consistency sheet screen first."}
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {sheets.map((sheet) => (
                  <button
                    key={sheet.id}
                    type="button"
                    onClick={() => void pickSheet(sheet)}
                    className="overflow-hidden rounded-md border border-border bg-background transition-colors hover:border-primary"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sheet.url} alt={sheet.prompt || "sheet"} className="aspect-square w-full object-contain" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
