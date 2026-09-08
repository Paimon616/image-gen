"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  IdCard,
  ImagePlus,
  Images as ImagesIcon,
  Landmark,
  Loader2,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  ImageLibraryPicker,
  ImageLightbox,
} from "@/components/image-library-picker";
import { PaimonPanel } from "@/components/paimon-panel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import type { WorkspaceSummary } from "@/lib/types";
import {
  CONSISTENCY_SHEET_MAX_REFERENCES,
  type ConsistencySheetImage,
  type ConsistencySheetMode,
  type ConsistencySheetParams,
} from "@/lib/consistency-sheet";
import { useConsistencySheetStore } from "@/lib/consistency-sheet-store";
import {
  cancelConsistencySheetGeneration,
  startConsistencySheetGeneration,
} from "@/lib/consistency-sheet-generation";
import { useConsistencySheetPaimonStore } from "@/lib/consistency-sheet-paimon-store";

const MAX_IMAGE_DIM = 1536;

type Lang = "ko" | "en";

const T = {
  title: { ko: "일관성 시트", en: "Consistency Sheet" },
  subtitle: {
    ko: "GPT-5.4 Image 2 (OpenRouter) · 캐릭터/배경 일관성 유지용 레퍼런스 시트",
    en: "GPT-5.4 Image 2 via OpenRouter · Character / background reference sheets",
  },
  modeCharacter: { ko: "캐릭터 시트", en: "Character sheet" },
  modeBackground: { ko: "배경 시트", en: "Background sheet" },
  modeCharacterHint: {
    ko: "배경 없이 캐릭터만: 정면·측면·후면 전신 + 무표정·미소·활짝웃음·인상 얼굴 4종을 한 장에",
    en: "Character only, no background: front/side/back full body + 4 face studies in one image",
  },
  modeBackgroundHint: {
    ko: "하나의 공간을 네 가지 각도에서 찍은 이미지 한 장",
    en: "One place from four camera angles in a single image",
  },
  references: { ko: "레퍼런스 이미지", en: "Reference images" },
  referencesHint: {
    ko: "갤러리·파일·붙여넣기로 추가 (최대 16장). 모델이 이 이미지들의 정체성을 유지합니다.",
    en: "Add from gallery, files or paste (up to 16). The model keeps their identity.",
  },
  pickFromGallery: { ko: "내 이미지에서 선택", en: "From my images" },
  chooseFile: { ko: "파일 선택", en: "Choose files" },
  prompt: { ko: "프롬프트", en: "Prompt" },
  promptPlaceholderCharacter: {
    ko: "캐릭터의 생김새·의상·머리 등을 묘사하세요. 레퍼런스가 있으면 비워도 됩니다.",
    en: "Describe the character's look, outfit, hair. Optional with references.",
  },
  promptPlaceholderBackground: {
    ko: "공간을 묘사하세요. 예) 해질녘 바닷가 방갈로, 야자수와 나무 데크.",
    en: "Describe the place. e.g. a beach bungalow at sunset.",
  },
  workspace: { ko: "저장할 워크스페이스", en: "Save to workspace" },
  noWorkspace: { ko: "워크스페이스 없음", en: "No workspace" },
  workspaceHint: {
    ko: "생성된 시트를 이 워크스페이스에 저장합니다.",
    en: "The finished sheet is filed under this workspace.",
  },
  generate: { ko: "시트 생성", en: "Generate sheet" },
  costHint: {
    ko: "생성에 30초~수분 소요. 1024×1024 한 장에 약 $0.22.",
    en: "Takes 30s–minutes. About $0.22 per 1024×1024 sheet.",
  },
  galleryTitle: { ko: "시트 갤러리", en: "Sheet gallery" },
  empty: {
    ko: "아직 생성한 시트가 없습니다. 왼쪽에서 레퍼런스와 프롬프트를 설정하고 생성하세요.",
    en: "No sheets yet. Set references and a prompt on the left.",
  },
  refresh: { ko: "새로고침", en: "Refresh" },
  delete: { ko: "삭제", en: "Delete" },
  download: { ko: "다운로드", en: "Download" },
  reusePrompt: { ko: "프롬프트 재사용", en: "Reuse prompt" },
  cancel: { ko: "취소", en: "Cancel" },
  retry: { ko: "다시 시도", en: "Retry" },
  dismiss: { ko: "닫기", en: "Dismiss" },
  deleteConfirm: { ko: "이 시트를 삭제할까요?", en: "Delete this sheet?" },
  count: { ko: "개", en: " sheets" },
} as const;

function tr(key: keyof typeof T, lang: Lang): string {
  return T[key][lang];
}


/** Load a File or URL into an <img>, downscale to MAX_IMAGE_DIM, return a JPEG data URL. */
async function toDataUrl(src: File | string): Promise<string> {
  const objectUrl =
    typeof src === "string"
      ? await fetch(src)
          .then((r) => r.blob())
          .then((b) => URL.createObjectURL(b))
      : URL.createObjectURL(src);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
      image.src = objectUrl;
    });

    const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unsupported");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function ConsistencySheetPage() {
  const language = useStore((s) => s.language) as Lang;

  const images = useConsistencySheetStore((s) => s.images);
  const pending = useConsistencySheetStore((s) => s.pending);
  const setImages = useConsistencySheetStore((s) => s.setImages);
  const removePending = useConsistencySheetStore((s) => s.removePending);
  const params = useConsistencySheetStore((s) => s.params);
  const setParams = useConsistencySheetStore((s) => s.setParams);
  const hydrateParams = useConsistencySheetStore((s) => s.hydrateParams);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    hydrateParams();
  }, [hydrateParams]);

  // Load finished sheets on mount.
  useEffect(() => {
    fetch("/api/consistency-sheet/images")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.images))
          setImages(data.images as ConsistencySheetImage[]);
      })
      .catch(() => {});
  }, [setImages]);

  // Workspaces are shared app-wide; here they are only a save target, so the
  // list is read once and the chosen id is remembered with the other settings.
  useEffect(() => {
    fetch("/api/workspaces?media=consistencySheet")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.workspaces))
          setWorkspaces(data.workspaces as WorkspaceSummary[]);
      })
      .catch(() => {});
  }, []);

  const patch = useCallback(
    (update: Partial<ConsistencySheetParams>) => {
      setParams((p) => ({ ...p, ...update }));
    },
    [setParams]
  );

  const addReferences = useCallback(
    (dataUrls: string[]) => {
      if (dataUrls.length === 0) return;
      setParams((p) => ({
        ...p,
        references: [...p.references, ...dataUrls].slice(
          0,
          CONSISTENCY_SHEET_MAX_REFERENCES
        ),
      }));
    },
    [setParams]
  );

  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      const dataUrls: string[] = [];
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        try {
          dataUrls.push(await toDataUrl(file));
        } catch {
          /* skip unreadable files */
        }
      }
      addReferences(dataUrls);
    },
    [addReferences]
  );

  // Page-level paste adds to the reference grid.
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items || [])
        .filter((i) => i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => Boolean(f));
      if (files.length > 0) void addFiles(files);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [addFiles]);

  const startGeneration = useCallback(
    async (source: ConsistencySheetParams) => {
      setError(null);
      const validationError = await startConsistencySheetGeneration(source);
      if (validationError) setError(validationError);
    },
    []
  );

  const deleteImage = useCallback(
    async (image: ConsistencySheetImage) => {
      if (!window.confirm(tr("deleteConfirm", language))) return;
      setImages((prev) => prev.filter((v) => v.id !== image.id));
      await fetch(`/api/consistency-sheet/images/${image.filename}`, {
        method: "DELETE",
      }).catch(() => {});
    },
    [language, setImages]
  );

  const refreshImages = useCallback(() => {
    fetch("/api/consistency-sheet/images", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.images))
          setImages(data.images as ConsistencySheetImage[]);
      })
      .catch(() => {});
  }, [setImages]);

  const canGenerate =
    params.prompt.trim().length > 0 || params.references.length > 0;

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Control panel */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <IdCard className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-5">{tr("title", language)}</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {tr("subtitle", language)}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Mode toggle */}
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card/60 p-1">
              {(["character", "background"] as ConsistencySheetMode[]).map(
                (mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patch({ mode })}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors",
                      params.mode === mode
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode === "character" ? (
                      <UserRound className="h-3.5 w-3.5" />
                    ) : (
                      <Landmark className="h-3.5 w-3.5" />
                    )}
                    {mode === "character"
                      ? tr("modeCharacter", language)
                      : tr("modeBackground", language)}
                  </button>
                )
              )}
            </div>
            <p className="text-[10.5px] leading-tight text-muted-foreground">
              {params.mode === "character"
                ? tr("modeCharacterHint", language)
                : tr("modeBackgroundHint", language)}
            </p>
          </div>

          <Separator />

          {/* References */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">
                {tr("references", language)}{" "}
                <span className="font-normal text-muted-foreground">
                  {params.references.length}/{CONSISTENCY_SHEET_MAX_REFERENCES}
                </span>
              </Label>
              {params.references.length > 0 && (
                <button
                  type="button"
                  onClick={() => patch({ references: [] })}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  {tr("delete", language)}
                </button>
              )}
            </div>
            <p className="text-[10.5px] leading-tight text-muted-foreground">
              {tr("referencesHint", language)}
            </p>
            <div
              className="grid grid-cols-4 gap-2"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void addFiles(Array.from(e.dataTransfer.files || []));
              }}
            >
              {params.references.map((ref, idx) => (
                <div
                  key={idx}
                  className="relative aspect-square cursor-zoom-in overflow-hidden rounded-md border border-border"
                  onClick={() => setZoomImage(ref)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={ref}
                    alt={`reference ${idx + 1}`}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      patch({
                        references: params.references.filter(
                          (_, i) => i !== idx
                        ),
                      });
                    }}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white hover:bg-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {params.references.length < CONSISTENCY_SHEET_MAX_REFERENCES && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/60"
                >
                  <ImagePlus className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-3 w-3" /> {tr("chooseFile", language)}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setPickerOpen(true)}
              >
                <ImagesIcon className="h-3 w-3" /> {tr("pickFromGallery", language)}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </div>

          <Separator />

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{tr("prompt", language)}</Label>
            <Textarea
              value={params.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder={
                params.mode === "character"
                  ? tr("promptPlaceholderCharacter", language)
                  : tr("promptPlaceholderBackground", language)
              }
              className="min-h-[104px] resize-y text-sm"
            />
          </div>

          {/* Save target */}
          <div className="space-y-1.5">
            <Label
              htmlFor="consistency-sheet-workspace"
              className="text-xs font-semibold"
            >
              {tr("workspace", language)}
            </Label>
            <select
              id="consistency-sheet-workspace"
              value={
                workspaces.some((w) => w.id === params.workspaceId)
                  ? params.workspaceId
                  : ""
              }
              onChange={(e) => patch({ workspaceId: e.target.value })}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <option value="">{tr("noWorkspace", language)}</option>
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({workspace.count})
                </option>
              ))}
            </select>
            <p className="text-[10.5px] leading-tight text-muted-foreground">
              {tr("workspaceHint", language)}
            </p>
          </div>
        </div>

        {/* Generate footer */}
        <div className="space-y-2 border-t border-border px-4 py-3">
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button
            className="w-full"
            disabled={!canGenerate}
            onClick={() => void startGeneration(params)}
          >
            <Sparkles className="h-4 w-4" />
            {tr("generate", language)}
          </Button>
          <p className="text-center text-[10.5px] leading-tight text-muted-foreground">
            {tr("costHint", language)}
          </p>
        </div>
      </aside>

      {/* Results */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <div className="flex items-center gap-3">
            <IdCard className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{tr("galleryTitle", language)}</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {images.length}
              {tr("count", language)}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={refreshImages}
              aria-label={tr("refresh", language)}
              title={tr("refresh", language)}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {pending.length === 0 && images.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <IdCard className="h-10 w-10 opacity-40" />
              <p className="max-w-xs text-sm">{tr("empty", language)}</p>
            </div>
          ) : (
            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
              }}
            >
              {pending.map((card) => (
                <PendingCard
                  key={card.id}
                  lang={language}
                  card={card}
                  onCancel={() => cancelConsistencySheetGeneration(card.id)}
                  onRetry={() => {
                    removePending(card.id);
                    void startGeneration(params);
                  }}
                  onDismiss={() => removePending(card.id)}
                />
              ))}
              {images.map((image) => (
                <SheetCard
                  key={image.id}
                  lang={language}
                  image={image}
                  workspaceNames={(image.workspaces ?? [])
                    .map((id) => workspaces.find((w) => w.id === id)?.name)
                    .filter((name): name is string => Boolean(name))}
                  onZoom={() => setZoomImage(image.url)}
                  onDelete={() => void deleteImage(image)}
                  onReusePrompt={() => {
                    if (image.params) {
                      patch({
                        mode: image.params.mode,
                        prompt: image.params.prompt,
                      });
                    } else {
                      patch({ prompt: image.prompt });
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {pickerOpen && (
        <ImageLibraryPicker
          title={tr("pickFromGallery", language)}
          multiple
          onClose={() => setPickerOpen(false)}
          onPickMany={(picked) => {
            setPickerOpen(false);
            void Promise.all(picked.map((image) => toDataUrl(image.url))).then(
              (dataUrls) => addReferences(dataUrls)
            );
          }}
        />
      )}

      <PaimonPanel
        store={useConsistencySheetPaimonStore}
        subtitle={
          language === "ko"
            ? "현재 일관성 시트 설정을 읽고 수정합니다"
            : "Reads the current sheet settings and edits them"
        }
        intro={
          language === "ko"
            ? "파이몬이에요. 레퍼런스 이미지와 설정을 보고 캐릭터/배경 시트 프롬프트를 다듬어드릴게요."
            : "Paimon here. I can look at your references and refine the character / background sheet prompt."
        }
        placeholder={
          language === "ko"
            ? "이 캐릭터의 특징을 살린 시트 프롬프트를 만들어줘"
            : "Write a sheet prompt that captures this character"
        }
      />

      {zoomImage && (
        <ImageLightbox src={zoomImage} onClose={() => setZoomImage(null)} />
      )}
    </div>
  );
}

function PendingCard({
  lang,
  card,
  onCancel,
  onRetry,
  onDismiss,
}: {
  lang: Lang;
  card: ConsistencySheetImage;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const status = card.status;
  const failed = status?.state === "error";

  return (
    <div className="flex aspect-square flex-col justify-between rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[11px] leading-snug text-muted-foreground line-clamp-6">
        {card.prompt ||
          (lang === "ko" ? "레퍼런스 기반 시트" : "Reference-based sheet")}
      </div>
      <div className="space-y-2">
        {failed ? (
          // Upstream errors can carry a very long unbroken token (e.g. a masked
          // API key), so force a break or it blows the card out of the grid.
          <p className="line-clamp-4 break-all text-xs font-medium text-destructive">
            {status?.message}
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="truncate">{status?.message}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((status?.progress ?? 0) * 100)}%` }}
              />
            </div>
          </>
        )}
        <div className="flex gap-1.5">
          {failed ? (
            <>
              <Button type="button" size="xs" variant="outline" onClick={onRetry}>
                <RotateCcw className="h-3 w-3" /> {tr("retry", lang)}
              </Button>
              <Button type="button" size="xs" variant="outline" onClick={onDismiss}>
                {tr("dismiss", lang)}
              </Button>
            </>
          ) : (
            <Button type="button" size="xs" variant="outline" onClick={onCancel}>
              <X className="h-3 w-3" /> {tr("cancel", lang)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SheetCard({
  lang,
  image,
  workspaceNames,
  onZoom,
  onDelete,
  onReusePrompt,
}: {
  lang: Lang;
  image: ConsistencySheetImage;
  workspaceNames: string[];
  onZoom: () => void;
  onDelete: () => void;
  onReusePrompt: () => void;
}) {
  return (
    <div className="group overflow-hidden rounded-lg border border-border bg-card/60">
      <button
        type="button"
        onClick={onZoom}
        className="block aspect-square w-full cursor-zoom-in overflow-hidden bg-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={image.prompt || image.filename}
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
        />
      </button>
      <div className="space-y-2 p-2.5">
        {image.prompt && (
          <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2">
            {image.prompt}
          </p>
        )}
        {workspaceNames.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {workspaceNames.map((name) => (
              <span
                key={name}
                className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground"
              >
                {name}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {image.params
              ? image.params.mode === "character"
                ? lang === "ko"
                  ? "캐릭터"
                  : "Character"
                : lang === "ko"
                  ? "배경"
                  : "Background"
              : ""}
          </span>
          <span>
            {image.timestamp
              ? new Date(image.timestamp).toLocaleDateString()
              : ""}
          </span>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={onReusePrompt}
            title={tr("reusePrompt", lang)}
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <a href={image.url} download={image.filename}>
            <Button
              type="button"
              size="xs"
              variant="outline"
              title={tr("download", lang)}
            >
              <Download className="h-3 w-3" />
            </Button>
          </a>
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="ml-auto text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={onDelete}
            title={tr("delete", lang)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}
