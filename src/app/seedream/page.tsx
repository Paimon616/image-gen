"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ImagePlus,
  Images as ImagesIcon,
  Loader2,
  Palette,
  RefreshCcw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import {
  ImageLibraryPicker,
  ImageLightbox,
} from "@/components/image-library-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import {
  resolveSeedreamModel,
  seedreamSizeLabel,
  SEEDREAM_ASPECT_RATIOS,
  SEEDREAM_MODELS,
  type SeedreamImage,
  type SeedreamParams,
} from "@/lib/seedream";
import { useSeedreamStore } from "@/lib/seedream-store";
import {
  cancelSeedreamGeneration,
  startSeedreamGeneration,
} from "@/lib/seedream-generation";
import type { GeneratedImage } from "@/lib/types";

// References are re-encoded in the browser before they go up: a 4K gallery PNG
// is far more than a reference needs, and the whole batch travels as base64
// inside one request body.
const MAX_IMAGE_DIM = 1536;

// How far back the result strip looks through the gallery feed. Seedream
// renders are ordinary gallery images, so they are filtered out of the newest
// page rather than listed from a folder of their own.
const RESULT_SCAN_LIMIT = 72;

type Lang = "ko" | "en";

const T = {
  title: { ko: "시드림 이미지 생성", en: "Seedream Image Generation" },
  subtitle: {
    ko: "BytePlus ModelArk · 레퍼런스 + 프롬프트로 이미지 생성",
    en: "BytePlus ModelArk · generate from references and a prompt",
  },
  model: { ko: "모델", en: "Model" },
  modelHint: {
    ko: "ARK 계정에 열려 있는 시드림 모델입니다. 모델마다 레퍼런스 장수와 해상도 한계가 다릅니다.",
    en: "The Seedream models this ARK account can reach. Reference count and size limits differ per model.",
  },
  references: { ko: "레퍼런스 이미지", en: "Reference images" },
  referencesHint: {
    ko: "갤러리·파일·붙여넣기로 추가. 모델이 이 이미지들의 인물·사물·분위기를 유지합니다. 없어도 프롬프트만으로 생성됩니다.",
    en: "Add from the gallery, files or paste. The model keeps their subjects and look. Optional — a prompt alone works.",
  },
  clear: { ko: "모두 지우기", en: "Clear all" },
  pickFromGallery: { ko: "내 이미지에서 선택", en: "From my images" },
  chooseFile: { ko: "파일 선택", en: "Choose files" },
  prompt: { ko: "프롬프트", en: "Prompt" },
  promptPlaceholder: {
    ko: "만들고 싶은 이미지를 묘사하세요. 예) 창가 테이블에 앉아 찻잔을 두 손으로 감싸 쥐고 카메라를 본다.",
    en: "Describe the image you want. e.g. sitting at the window table, holding a teacup, looking at camera.",
  },
  promptRequired: {
    ko: "시드림은 레퍼런스만으로는 생성하지 않습니다. 프롬프트가 반드시 필요합니다.",
    en: "Seedream will not render from references alone — a prompt is required.",
  },
  size: { ko: "해상도", en: "Resolution" },
  ratio: { ko: "비율", en: "Aspect ratio" },
  watermark: { ko: "워터마크 넣기", en: "Burn in watermark" },
  workspace: { ko: "저장할 워크스페이스", en: "Save to workspace" },
  noWorkspace: { ko: "워크스페이스 없음", en: "No workspace" },
  workspaceHint: {
    ko: "생성된 이미지는 일반 이미지 갤러리에 저장되고, 선택한 워크스페이스에 들어갑니다.",
    en: "Renders are saved into the main image gallery and filed under this workspace.",
  },
  generate: { ko: "이미지 생성", en: "Generate" },
  galleryTitle: { ko: "생성 결과", en: "Results" },
  galleryHint: {
    ko: "시드림으로 만든 최근 이미지입니다. 전체는 이미지 생성 갤러리에서 볼 수 있습니다.",
    en: "Recent Seedream renders. All of them also live in the main image gallery.",
  },
  empty: {
    ko: "아직 만든 이미지가 없습니다. 왼쪽에서 프롬프트를 적고 생성하세요.",
    en: "Nothing yet. Write a prompt on the left and generate.",
  },
  refresh: { ko: "새로고침", en: "Refresh" },
  delete: { ko: "삭제", en: "Delete" },
  download: { ko: "다운로드", en: "Download" },
  reusePrompt: { ko: "프롬프트 재사용", en: "Reuse prompt" },
  cancel: { ko: "취소", en: "Cancel" },
  retry: { ko: "다시 시도", en: "Retry" },
  dismiss: { ko: "닫기", en: "Dismiss" },
  deleteConfirm: { ko: "이 이미지를 삭제할까요?", en: "Delete this image?" },
  count: { ko: "개", en: "" },
  maxReferences: { ko: "최대", en: "max" },
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

/** Seedream renders carry `seedream/<id>` as their model; nothing else does. */
function isSeedreamImage(image: GeneratedImage): boolean {
  return Boolean(image.params?.model?.startsWith("seedream/"));
}

export default function SeedreamPage() {
  const language = useStore((s) => s.language) as Lang;

  const images = useSeedreamStore((s) => s.images);
  const pending = useSeedreamStore((s) => s.pending);
  const setImages = useSeedreamStore((s) => s.setImages);
  const removePending = useSeedreamStore((s) => s.removePending);
  const params = useSeedreamStore((s) => s.params);
  const setParams = useSeedreamStore((s) => s.setParams);
  const hydrateParams = useSeedreamStore((s) => s.hydrateParams);

  const workspaces = useStore((s) => s.workspaces);
  const fetchWorkspaces = useStore((s) => s.fetchWorkspaces);

  // Non-fatal feedback from the last finished run (e.g. references that were
  // too small to send) lives in the store, because the run keeps streaming
  // after the page unmounts.
  const notice = useSeedreamStore((s) => s.notice);
  const setNotice = useSeedreamStore((s) => s.setNotice);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const model = useMemo(() => resolveSeedreamModel(params.model), [params.model]);

  useEffect(() => {
    hydrateParams();
  }, [hydrateParams]);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  const loadImages = useCallback(() => {
    fetch(`/api/images?limit=${RESULT_SCAN_LIMIT}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data?.images)) return;
        setImages(
          (data.images as GeneratedImage[]).filter(isSeedreamImage)
        );
      })
      .catch(() => {});
  }, [setImages]);

  useEffect(() => {
    loadImages();
  }, [loadImages]);

  const patch = useCallback(
    (update: Partial<SeedreamParams>) => {
      setParams((p) => ({ ...p, ...update }));
    },
    [setParams]
  );

  const addReferences = useCallback(
    (dataUrls: string[]) => {
      if (dataUrls.length === 0) return;
      setParams((p) => ({
        ...p,
        // The store re-clamps to the selected model's own ceiling.
        references: [...p.references, ...dataUrls],
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

  const startGeneration = useCallback(async (source: SeedreamParams) => {
    setError(null);
    const validationError = await startSeedreamGeneration(source);
    if (validationError) setError(validationError);
  }, []);

  const deleteImage = useCallback(
    async (image: SeedreamImage) => {
      if (!window.confirm(tr("deleteConfirm", language))) return;
      setImages((prev) => prev.filter((v) => v.id !== image.id));
      await fetch(`/api/images/${image.filename}`, { method: "DELETE" }).catch(
        () => {}
      );
      await fetchWorkspaces();
    },
    [language, setImages, fetchWorkspaces]
  );

  const canGenerate = params.prompt.trim().length > 0;

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Control panel */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Palette className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-5">
              {tr("title", language)}
            </h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {tr("subtitle", language)}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Model */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{tr("model", language)}</Label>
            <div className="grid gap-1">
              {SEEDREAM_MODELS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => patch({ model: entry.id })}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs font-semibold transition-colors",
                    params.model === entry.id
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>{entry.label}</span>
                  <span className="text-[10px] font-normal opacity-80">
                    {tr("maxReferences", language)} {entry.maxReferences} ·{" "}
                    {entry.tiers.join(" / ").toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10.5px] leading-tight text-muted-foreground">
              {tr("modelHint", language)}
            </p>
          </div>

          <Separator />

          {/* References */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">
                {tr("references", language)}{" "}
                <span className="font-normal text-muted-foreground">
                  {params.references.length}/{model.maxReferences}
                </span>
              </Label>
              {params.references.length > 0 && (
                <button
                  type="button"
                  onClick={() => patch({ references: [] })}
                  className="text-[11px] text-muted-foreground hover:text-destructive"
                >
                  {tr("clear", language)}
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
                        references: params.references.filter((_, i) => i !== idx),
                      });
                    }}
                    className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white hover:bg-destructive"
                    aria-label={tr("delete", language)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {params.references.length < model.maxReferences && (
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
                <ImagesIcon className="h-3 w-3" />{" "}
                {tr("pickFromGallery", language)}
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
            <Label className="text-xs font-semibold">
              {tr("prompt", language)}
            </Label>
            <Textarea
              value={params.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder={tr("promptPlaceholder", language)}
              className="min-h-[120px] resize-y text-sm"
            />
            <p className="text-[10.5px] leading-tight text-muted-foreground">
              {tr("promptRequired", language)}
            </p>
          </div>

          {/* Resolution */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{tr("size", language)}</Label>
            <div className="grid grid-cols-3 gap-1">
              {model.tiers.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => patch({ tier })}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    params.tier === tier
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="uppercase">{tier}</span>
                  <span className="block text-[10px] font-normal opacity-80">
                    {seedreamSizeLabel(model, tier, params.ratio)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Aspect ratio */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{tr("ratio", language)}</Label>
            <div className="flex flex-wrap gap-1">
              {SEEDREAM_ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => patch({ ratio })}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    params.ratio === ratio
                      ? "border-primary bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-card/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Watermark */}
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={params.watermark}
              onChange={(e) => patch({ watermark: e.target.checked })}
              className="h-3.5 w-3.5 accent-primary"
            />
            {tr("watermark", language)}
          </label>

          {/* Save target */}
          <div className="space-y-1.5">
            <Label htmlFor="seedream-workspace" className="text-xs font-semibold">
              {tr("workspace", language)}
            </Label>
            <select
              id="seedream-workspace"
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
          {error && (
            <p className="text-xs font-medium text-destructive">{error}</p>
          )}
          {notice && (
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="block w-full text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              title={tr("dismiss", language)}
            >
              {notice}
            </button>
          )}
          <Button
            className="w-full"
            disabled={!canGenerate}
            onClick={() => void startGeneration(params)}
          >
            <Sparkles className="h-4 w-4" />
            {tr("generate", language)}
          </Button>
        </div>
      </aside>

      {/* Results */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{tr("galleryTitle", language)}</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {tr("galleryHint", language)}
            </p>
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
              onClick={loadImages}
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
              <Palette className="h-10 w-10 opacity-40" />
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
                  onCancel={() => cancelSeedreamGeneration(card.id)}
                  onRetry={() => {
                    removePending(card.id);
                    void startGeneration(params);
                  }}
                  onDismiss={() => removePending(card.id)}
                />
              ))}
              {images.map((image) => (
                <ResultCard
                  key={image.id}
                  lang={language}
                  image={image}
                  onZoom={() => setZoomImage(image.url)}
                  onDelete={() => void deleteImage(image)}
                  onReusePrompt={() => {
                    if (image.params?.prompt) {
                      patch({ prompt: image.params.prompt });
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
            setNotice(null);
            void Promise.all(picked.map((image) => toDataUrl(image.url))).then(
              (dataUrls) => addReferences(dataUrls)
            );
          }}
        />
      )}

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
  card: SeedreamImage;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const status = card.status;
  const failed = status?.state === "error";

  return (
    <div className="flex aspect-square flex-col justify-between rounded-lg border border-border bg-card/60 p-3">
      <div className="text-[11px] leading-snug text-muted-foreground line-clamp-6">
        {card.pendingPrompt}
      </div>
      <div className="space-y-2">
        {failed ? (
          // ModelArk errors carry a long unbroken request id, so force a break
          // or it blows the card out of the grid.
          <p className="line-clamp-5 break-all text-xs font-medium text-destructive">
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
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={onDismiss}
              >
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

function ResultCard({
  lang,
  image,
  onZoom,
  onDelete,
  onReusePrompt,
}: {
  lang: Lang;
  image: SeedreamImage;
  onZoom: () => void;
  onDelete: () => void;
  onReusePrompt: () => void;
}) {
  const label = [
    image.params?.model_name,
    image.params?.width && image.params?.height
      ? `${image.params.width}x${image.params.height}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="group overflow-hidden rounded-lg border border-border bg-card/60">
      <button
        type="button"
        onClick={onZoom}
        className="block aspect-square w-full cursor-zoom-in overflow-hidden bg-muted"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.thumbnailUrl || image.url}
          alt={image.params?.prompt || image.filename}
          loading="lazy"
          className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
        />
      </button>
      <div className="space-y-2 p-2.5">
        {image.params?.prompt && (
          <p className="text-[11px] leading-snug text-muted-foreground line-clamp-2">
            {image.params.prompt}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="truncate">{label}</span>
          <span className="whitespace-nowrap">
            {image.timestamp ? new Date(image.timestamp).toLocaleDateString() : ""}
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
