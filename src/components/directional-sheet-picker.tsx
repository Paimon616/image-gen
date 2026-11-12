"use client";

import { useMemo, useState } from "react";
import { Info, Layers, Loader2, RefreshCw, Unlink } from "lucide-react";

import { FieldHelp } from "@/components/field-help";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { ConsistencySheetImage } from "@/lib/consistency-sheet";
import {
  classifyPromptView,
  directionalFamily,
  directionalParams,
} from "@/lib/directional-reference";
import { useDirectionalReferenceStore } from "@/lib/directional-reference-store";
import type { VariationView } from "@/lib/reference-variations";
import { useStore } from "@/lib/store";

type ViewKey = "front" | "side" | "back" | "face";

const VIEW_TILES: { key: ViewKey; ko: string; en: string }[] = [
  { key: "front", ko: "정면", en: "Front" },
  { key: "side", ko: "옆", en: "Side" },
  { key: "back", ko: "뒤", en: "Back" },
  { key: "face", ko: "얼굴", en: "Face" },
];

const PROMPT_VIEW_LABEL: Record<VariationView, { ko: string; en: string }> = {
  front: { ko: "정면", en: "front" },
  side: { ko: "옆모습", en: "side view" },
  side_face: { ko: "옆모습 · 얼굴 보임", en: "side view, face visible" },
  back: { ko: "뒷모습 · 얼굴 안 보임", en: "back view, face hidden" },
  back_face: { ko: "뒷모습 · 돌아봄", en: "back view, looking back" },
};

function absoluteUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value, window.location.href).href;
  } catch {
    return value;
  }
}

function formatDate(timestamp: number, ko: boolean) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleDateString(ko ? "ko-KR" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * 일관성 시트: links a character consistency sheet whose views (front, side, back,
 * face) are swapped in per image by the direction the shot faces. Sits under
 * the character reference on the generator; shows which views the current
 * prompt will use.
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

  // What a Generate press would send right now, to light up the views in use.
  const preview = useMemo(() => {
    if (!linked || !enabled || family === "none") return null;
    const view = classifyPromptView(params.prompt ?? "");
    const refs = directionalParams(view, linked, family, params.character_image);
    if (!refs) return null;
    const sent = [refs.character_image, refs.character_face_image, refs.identity_reference_image];
    const used = new Set<ViewKey>(
      VIEW_TILES.filter((tile) => linked[tile.key] && sent.includes(linked[tile.key])).map(
        (tile) => tile.key
      )
    );
    const usesScreenReference =
      Boolean(params.character_image) && sent.includes(params.character_image);
    return { view, used, usesScreenReference };
  }, [linked, enabled, family, params.prompt, params.character_image]);

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
    setMessage("");
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
      if (missing.length) {
        setMessage(
          ko
            ? `시트에서 ${missing.join(" · ")}을(를) 찾지 못했습니다. 그 방향은 캐릭터 참조로 대신합니다.`
            : `No ${missing.join(" / ")} found on the sheet; those shots fall back to the character reference.`
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const methodText =
    family === "krea2"
      ? ko
        ? "Krea 2 · Identity Edit"
        : "Krea 2 · Identity Edit"
      : family === "sdxl"
        ? ko
          ? "SDXL · 방향은 IP-Adapter, 얼굴은 PuLID"
          : "SDXL · IP-Adapter for the view, PuLID for the face"
        : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldHelp
          label={ko ? "일관성 시트" : "Consistency sheet"}
          help={
            ko
              ? "일관성 시트(캐릭터)를 연결하면 장면 방향에 맞는 칸을 참조로 넣습니다. 프롬프트에 from behind / 뒷모습이면 뒷모습, from side / profile / 옆모습이면 옆모습 칸을 쓰고, looking back처럼 얼굴도 보이면 얼굴을 함께 씁니다. 생성 버튼과 '레퍼런스로 다양하게 뽑기' 모두에 적용됩니다."
              : "Link a consistency sheet (character) and each image gets the view that matches its direction: from behind → back view, from side / profile → side view, plus the face when it shows (looking back). Applies to Generate and the varied batch."
          }
        />
        {linked && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            {enabled ? (ko ? "사용 중" : "On") : ko ? "꺼짐" : "Off"}
            <Switch size="sm" checked={enabled} onCheckedChange={(checked) => setEnabled(checked)} />
          </label>
        )}
      </div>

      {!linked ? (
        <Card className="overflow-hidden border-dashed border-muted-foreground/25">
          <button
            type="button"
            onClick={() => void openPicker()}
            disabled={busy}
            className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Layers className="h-5 w-5" />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">
                {busy ? (ko ? "시트를 나누는 중…" : "Cutting the sheet…") : ko ? "일관성 시트 연결" : "Link a consistency sheet"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {ko
                  ? "뒷모습 · 옆모습 장면에 시트의 같은 방향 그림을 자동으로 참조합니다"
                  : "Back and side shots automatically reference the sheet's matching view"}
              </span>
            </span>
          </button>
        </Card>
      ) : (
        <Card className={`gap-0 overflow-hidden p-0 transition-opacity ${enabled ? "" : "opacity-60"}`}>
          <div className="flex items-center gap-3 border-b border-border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={linked.sheetUrl}
              alt={ko ? "연결된 시트" : "Linked sheet"}
              className="h-11 w-11 shrink-0 rounded-md border border-border bg-background object-contain"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{ko ? "연결된 일관성 시트" : "Linked consistency sheet"}</div>
              {methodText && <div className="truncate text-xs text-muted-foreground">{methodText}</div>}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => void openPicker()}
              disabled={busy}
              title={ko ? "다른 시트로 바꾸기" : "Use another sheet"}
              aria-label={ko ? "다른 시트로 바꾸기" : "Use another sheet"}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => {
                setLinked(null);
                setMessage("");
              }}
              title={ko ? "연결 해제" : "Unlink"}
              aria-label={ko ? "연결 해제" : "Unlink"}
            >
              <Unlink className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-4 gap-2 p-2">
            {VIEW_TILES.map((tile) => {
              const src = linked[tile.key];
              const active = preview?.used.has(tile.key) ?? false;
              return (
                <figure key={tile.key} className="space-y-1">
                  <div
                    className={`relative flex h-28 items-center justify-center overflow-hidden rounded-md border bg-muted/30 transition-shadow ${
                      active ? "border-primary ring-2 ring-primary/40" : "border-border"
                    } ${src ? "" : "border-dashed"}`}
                  >
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={ko ? tile.ko : tile.en} className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-muted-foreground">{ko ? "없음" : "None"}</span>
                    )}
                    {active && (
                      <span className="absolute right-1 top-1 rounded bg-primary px-1 text-[9px] font-medium leading-4 text-primary-foreground">
                        {ko ? "사용" : "In use"}
                      </span>
                    )}
                  </div>
                  <figcaption
                    className={`text-center text-[11px] ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}
                  >
                    {ko ? tile.ko : tile.en}
                  </figcaption>
                </figure>
              );
            })}
          </div>

          <div className="flex items-start gap-1.5 border-t border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {!enabled ? (
              <span>{ko ? "꺼져 있어 캐릭터 참조만 씁니다." : "Off: only the character reference is used."}</span>
            ) : family === "none" ? (
              <span>
                {ko
                  ? "지금 모델은 참조 이미지를 쓰지 않아 적용되지 않습니다 (Krea 2 · SDXL · Illustrious)."
                  : "This model takes no reference images, so nothing is applied (Krea 2, SDXL, Illustrious)."}
              </span>
            ) : preview ? (
              <span>
                {ko ? "지금 프롬프트: " : "Current prompt: "}
                <span className="font-medium text-foreground">
                  {ko ? PROMPT_VIEW_LABEL[preview.view].ko : PROMPT_VIEW_LABEL[preview.view].en}
                </span>
                {preview.used.size === 0
                  ? ko
                    ? " → 캐릭터 참조만 사용"
                    : " → character reference only"
                  : preview.usesScreenReference
                    ? ko
                      ? " → 표시된 칸 + 캐릭터 참조"
                      : " → highlighted views + character reference"
                    : ko
                      ? " → 표시된 칸 사용"
                      : " → highlighted views"}
              </span>
            ) : null}
          </div>
        </Card>
      )}

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{ko ? "일관성 시트 선택" : "Choose a consistency sheet"}</DialogTitle>
            <DialogDescription>
              {ko
                ? "일관성 시트 화면에서 만든 캐릭터 시트입니다. 고르면 정면 · 옆 · 뒤 · 얼굴로 나눠 연결합니다."
                : "Character sheets made on the consistency sheet screen. Picking one cuts it into front, side, back and face."}
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
            {sheets === null ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sheets.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
                <Layers className="h-6 w-6" />
                {ko ? "아직 일관성 시트가 없습니다. 일관성 시트 화면에서 캐릭터 시트를 먼저 만드세요." : "No consistency sheets yet. Make a character sheet on the consistency sheet screen first."}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {sheets.map((sheet) => {
                  const current = linked?.sheetUrl === sheet.url;
                  return (
                    <button
                      key={sheet.id}
                      type="button"
                      onClick={() => void pickSheet(sheet)}
                      className={`group overflow-hidden rounded-lg border bg-background text-left transition-all hover:border-primary hover:shadow-md ${
                        current ? "border-primary ring-2 ring-primary/40" : "border-border"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={sheet.url} alt={sheet.prompt || "sheet"} className="aspect-square w-full bg-white object-contain" />
                      <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-1.5">
                        <span className="truncate text-xs text-muted-foreground">
                          {sheet.prompt?.trim() || (ko ? "설명 없음" : "No description")}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {current ? (ko ? "연결됨" : "Linked") : formatDate(sheet.timestamp, ko)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
