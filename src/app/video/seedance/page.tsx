"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Clapperboard,
  Film,
  ImagePlus,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
  X,
  Images as ImagesIcon,
  Upload,
  Square,
  RotateCcw,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { WorkspaceBar } from "@/components/workspace-bar";
import { MediaWorkspacePicker } from "@/components/workspace-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";
import { useSeedanceStore } from "@/lib/seedance-store";
import {
  fileMatchesWorkspace,
  useMediaWorkspaceStore,
} from "@/lib/media-workspace-store";
import { useSeedancePaimonStore } from "@/lib/seedance-paimon-store";
import { PaimonPanel } from "@/components/paimon-panel";
import {
  SEEDANCE_DURATION_MAX,
  SEEDANCE_DURATION_MIN,
  SEEDANCE_MAX_REFERENCES,
  SEEDANCE_PROMPT_CHIPS,
  SEEDANCE_RATIOS,
  SEEDANCE_RESOLUTIONS,
  type SeedanceMode,
  type SeedanceParams,
  type SeedanceRatio,
  type SeedanceResolution,
  type SeedanceVideo,
} from "@/lib/seedance";
import { UNGROUPED_WORKSPACE_ID, type GeneratedImage } from "@/lib/types";

const MAX_IMAGE_DIM = 1536;

type Lang = "ko" | "en";

const T = {
  title: { ko: "SeeDance 생성", en: "SeeDance Generation" },
  subtitle: {
    ko: "SeeDance 2.5 · 내 이미지의 인물로 원하는 영상 만들기",
    en: "SeeDance 2.5 · Bring the person in your image to life",
  },
  modeI2v: { ko: "이미지 → 영상", en: "Image → Video" },
  modeT2v: { ko: "텍스트 → 영상", en: "Text → Video" },
  firstFrame: { ko: "인물 이미지 (시작 프레임)", en: "Person image (start frame)" },
  firstFrameHint: {
    ko: "영상이 이 이미지에서 시작합니다. 내가 만든 인물 이미지를 넣으세요.",
    en: "The video starts from this image. Drop the person you generated.",
  },
  lastFrame: { ko: "종료 프레임 (선택)", en: "End frame (optional)" },
  references: { ko: "인물 참조 이미지 (선택)", en: "Identity references (optional)" },
  referencesHint: {
    ko: "동일 인물 유지력을 높이는 추가 참조 이미지 (최대 4장)",
    en: "Extra references to lock the same identity (up to 4)",
  },
  dropHere: { ko: "이미지를 끌어다 놓거나 클릭", en: "Drop an image or click" },
  pickFromGallery: { ko: "내 이미지에서 선택", en: "From my images" },
  chooseFile: { ko: "파일 선택", en: "Choose file" },
  prompt: { ko: "상황 / 연출 프롬프트", en: "Situation prompt" },
  promptPlaceholder: {
    ko: "인물이 무엇을 하는지, 어떤 장면·카메라·분위기인지 묘사하세요. 예) 해질녘 도시 골목을 천천히 걸으며 카메라를 향해 미소 짓는다.",
    en: "Describe what the person does, the scene, camera and mood.",
  },
  promptTip: {
    ko: "동작 + 카메라 무빙 + 분위기를 함께 적으면 결과가 좋아집니다. 아래 칩으로 빠르게 추가하세요.",
    en: "Action + camera + mood together yields the best result. Use the chips below.",
  },
  resolution: { ko: "해상도", en: "Resolution" },
  ratio: { ko: "화면 비율", en: "Aspect ratio" },
  ratioAdaptive: { ko: "이미지 자동", en: "Adaptive" },
  duration: { ko: "길이", en: "Duration" },
  seconds: { ko: "초", en: "s" },
  cameraFixed: { ko: "카메라 고정", en: "Lock camera" },
  cameraFixedHint: { ko: "카메라 움직임 최소화", en: "Minimize camera motion" },
  watermark: { ko: "워터마크", en: "Watermark" },
  cleanFrame: { ko: "자막·글자 제거", en: "No on-screen text" },
  cleanFrameHint: {
    ko: "화면에 문자·자막·로고가 생기지 않도록",
    en: "Avoid burned-in captions / logos",
  },
  seed: { ko: "시드 (선택)", en: "Seed (optional)" },
  seedPlaceholder: { ko: "랜덤", en: "random" },
  generate: { ko: "영상 생성", en: "Generate" },
  generating: { ko: "생성 중…", en: "Generating…" },
  cancel: { ko: "취소", en: "Cancel" },
  costHint: {
    ko: "생성에 30초~수분 소요. 비용은 길이·해상도에 비례합니다.",
    en: "Takes 30s–several minutes. Cost scales with length & resolution.",
  },
  results: { ko: "결과", en: "Results" },
  empty: {
    ko: "아직 생성한 영상이 없습니다. 왼쪽에서 인물 이미지와 상황을 설정하고 생성하세요.",
    en: "No videos yet. Set a person image and situation on the left.",
  },
  needImage: { ko: "시작 이미지를 추가하세요.", en: "Add a start image." },
  needPrompt: { ko: "프롬프트를 입력하세요.", en: "Enter a prompt." },
  retry: { ko: "다시 시도", en: "Retry" },
  dismiss: { ko: "닫기", en: "Dismiss" },
  delete: { ko: "삭제", en: "Delete" },
  download: { ko: "다운로드", en: "Download" },
  reuse: { ko: "설정 재사용", en: "Reuse settings" },
  pickerTitle: { ko: "내 이미지에서 선택", en: "Pick from my images" },
  pickerEmpty: { ko: "이미지가 없습니다.", en: "No images." },
  close: { ko: "닫기", en: "Close" },
} as const;

function tr(key: keyof typeof T, lang: Lang): string {
  return T[key][lang];
}

const STATUS_LABEL: Record<string, { ko: string; en: string }> = {
  queued: { ko: "대기 중", en: "Queued" },
  running: { ko: "생성 중", en: "Generating" },
  processing: { ko: "생성 중", en: "Generating" },
  downloading: { ko: "다운로드 중", en: "Downloading" },
};

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

interface DropZoneProps {
  lang: Lang;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  onPickGallery: () => void;
  label: string;
  hint?: string;
  large?: boolean;
}

function DropZone({ lang, value, onChange, onPickGallery, label, hint, large }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file || !file.type.startsWith("image/")) return;
      setBusy(true);
      try {
        onChange(await toDataUrl(file));
      } catch {
        /* ignore load errors */
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-semibold">{label}</Label>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-muted-foreground hover:text-destructive"
          >
            {tr("delete", lang)}
          </button>
        )}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        onClick={() => !value && inputRef.current?.click()}
        className={cn(
          "relative flex items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-card/50 transition-colors",
          large ? "aspect-video" : "h-24",
          dragOver && "border-primary bg-primary/5",
          !value && "cursor-pointer hover:border-primary/60"
        )}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="reference" className="h-full w-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-3 py-4 text-center text-muted-foreground">
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImagePlus className="h-5 w-5" />
            )}
            <span className="text-[11px]">{tr("dropHere", lang)}</span>
          </div>
        )}
      </div>
      {hint && <p className="text-[10.5px] leading-tight text-muted-foreground">{hint}</p>}
      <div className="flex gap-1.5">
        <Button type="button" variant="outline" size="xs" onClick={() => inputRef.current?.click()}>
          <Upload className="h-3 w-3" /> {tr("chooseFile", lang)}
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={onPickGallery}>
          <ImagesIcon className="h-3 w-3" /> {tr("pickFromGallery", lang)}
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

interface GalleryPickerProps {
  lang: Lang;
  onClose: () => void;
  onPick: (url: string) => void;
}

function GalleryPicker({ lang, onClose, onPick }: GalleryPickerProps) {
  const [images, setImages] = useState<GeneratedImage[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/images?limit=80&cursor=0")
      .then((r) => r.json())
      .then((data) => {
        if (alive) setImages(Array.isArray(data?.images) ? data.images : []);
      })
      .catch(() => alive && setImages([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">{tr("pickerTitle", lang)}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="overflow-y-auto p-3">
          {images === null ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : images.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
              {tr("pickerEmpty", lang)}
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {images.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => onPick(img.thumbnailUrl ? img.url : img.url)}
                  className="group relative aspect-square overflow-hidden rounded-md border border-border hover:border-primary"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.thumbnailUrl || img.url}
                    alt={img.filename}
                    className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SeedancePage() {
  const language = useStore((s) => s.language) as Lang;
  const videos = useSeedanceStore((s) => s.videos);
  const pending = useSeedanceStore((s) => s.pending);
  const setVideos = useSeedanceStore((s) => s.setVideos);
  const addPending = useSeedanceStore((s) => s.addPending);
  const updatePending = useSeedanceStore((s) => s.updatePending);
  const removePending = useSeedanceStore((s) => s.removePending);

  // Params live in the module-level store so they survive navigating away and
  // back, and so a Paimon answer that lands while this page is unmounted still
  // applies to the params the user returns to.
  const params = useSeedanceStore((s) => s.params);
  const setParams = useSeedanceStore((s) => s.setParams);
  const hydrateParams = useSeedanceStore((s) => s.hydrateParams);
  const [showLastFrame, setShowLastFrame] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [picker, setPicker] = useState<null | ((url: string) => void)>(null);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const abortControllers = useRef<Record<string, AbortController>>({});

  // One-time restore of the remembered settings (the store writes them back on
  // every change, including edits Paimon makes while this page is unmounted).
  useEffect(() => {
    hydrateParams();
  }, [hydrateParams]);

  // Load finished videos on mount.
  useEffect(() => {
    fetch("/api/seedance/videos")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.videos)) setVideos(data.videos as SeedanceVideo[]);
      })
      .catch(() => {});
  }, [setVideos]);

  const patch = useCallback(
    (update: Partial<SeedanceParams>) => {
      setParams((p) => ({ ...p, ...update }));
    },
    [setParams]
  );

  const insertChip = useCallback((text: string) => {
    setParams((p) => {
      const base = p.prompt.trim();
      const sep = base && !base.endsWith("，") && !base.endsWith(",") && !base.endsWith("。") ? "，" : "";
      return { ...p, prompt: base ? `${base}${sep}${text}` : text };
    });
    promptRef.current?.focus();
  }, [setParams]);

  // Page-level paste: fill the first empty image slot in i2v mode.
  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if (params.mode !== "i2v") return;
      const item = Array.from(e.clipboardData?.items || []).find((i) =>
        i.type.startsWith("image/")
      );
      const file = item?.getAsFile();
      if (!file) return;
      const dataUrl = await toDataUrl(file);
      setParams((p) => {
        if (!p.firstFrame) return { ...p, firstFrame: dataUrl };
        return p;
      });
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [params.mode, setParams]);

  // Workspaces are shared app-wide; on this screen they filter the SeeDance
  // clips only, never the images filed under the same workspace.
  const activeWorkspaceId = useMediaWorkspaceStore(
    (s) => s.byMedia.seedance.activeWorkspaceId
  );

  const startGeneration = useCallback(
    async (source: SeedanceParams) => {
      setError(null);
      if (source.mode === "i2v" && !source.firstFrame) {
        setError(tr("needImage", language));
        return;
      }
      if (!source.prompt.trim() && source.mode === "t2v") {
        setError(tr("needPrompt", language));
        return;
      }

      const clientId =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.round(Math.random() * 1e6)}`);
      const controller = new AbortController();
      abortControllers.current[clientId] = controller;

      const pendingCard: SeedanceVideo = {
        id: clientId,
        url: "",
        filename: "",
        timestamp: Date.now(),
        contentType: "video/mp4",
        prompt: source.prompt,
        params: {
          mode: source.mode,
          prompt: source.prompt,
          resolution: source.resolution,
          ratio: source.ratio,
          duration: source.duration,
          cameraFixed: source.cameraFixed,
          watermark: source.watermark,
          cleanFrame: source.cleanFrame,
          seed: source.seed,
          hasFirstFrame: Boolean(source.firstFrame),
          hasLastFrame: Boolean(source.lastFrame),
          referenceCount: source.references.length,
        },
        thumbnail: source.firstFrame ?? null,
        status: { state: "queued", progress: 0.04, message: STATUS_LABEL.queued[language] },
      };
      addPending(pendingCard);

      try {
        const res = await fetch("/api/seedance/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The clip is filed under the workspace this screen is filtered to, so
          // it appears there right away. The "ungrouped" sentinel isn't a real
          // workspace, so it queues as no target at all.
          body: JSON.stringify({
            ...source,
            clientId,
            workspaceId:
              activeWorkspaceId && activeWorkspaceId !== UNGROUPED_WORKSPACE_ID
                ? activeWorkspaceId
                : undefined,
          }),
          signal: controller.signal,
        });
        if (!res.body) throw new Error("No response stream");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let pollCount = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
            const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
            if (!eventLine || !dataLine) continue;
            const event = eventLine.slice("event: ".length).trim();
            let data: Record<string, unknown> = {};
            try {
              data = JSON.parse(dataLine.slice("data: ".length));
            } catch {
              continue;
            }

            if (event === "task") {
              updatePending(clientId, {
                status: { state: "generating", progress: 0.12, message: STATUS_LABEL.running[language] },
              });
            } else if (event === "poll") {
              const status = String(data.status ?? "");
              if (status === "downloading") {
                updatePending(clientId, {
                  status: {
                    state: "generating",
                    progress: 0.95,
                    message: STATUS_LABEL.downloading[language],
                  },
                });
              } else {
                pollCount += 1;
                const progress = Math.min(0.9, 0.15 + pollCount * 0.03);
                updatePending(clientId, {
                  status: {
                    state: "generating",
                    progress,
                    message: STATUS_LABEL.running[language],
                  },
                });
              }
            } else if (event === "complete") {
              const video = data.video as SeedanceVideo | undefined;
              if (video) setVideos((prev) => [video, ...prev]);
              // Refresh the chip counts after the auto-registration above.
              if (activeWorkspaceId) {
                void useMediaWorkspaceStore
                  .getState()
                  .fetchWorkspaces("seedance");
              }
              removePending(clientId);
            } else if (event === "error") {
              updatePending(clientId, {
                status: {
                  state: "error",
                  progress: 0,
                  message: String(data.message ?? "생성 실패"),
                },
              });
            } else if (event === "canceled") {
              removePending(clientId);
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted) {
          removePending(clientId);
        } else {
          updatePending(clientId, {
            status: {
              state: "error",
              progress: 0,
              message: err instanceof Error ? err.message : "네트워크 오류",
            },
          });
        }
      } finally {
        delete abortControllers.current[clientId];
      }
    },
    [
      activeWorkspaceId,
      addPending,
      updatePending,
      removePending,
      setVideos,
      language,
    ]
  );

  const cancelGeneration = useCallback(
    (id: string) => {
      abortControllers.current[id]?.abort();
      removePending(id);
    },
    [removePending]
  );

  const deleteVideo = useCallback(
    async (video: SeedanceVideo) => {
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
      await fetch(`/api/seedance/videos/${video.filename}`, { method: "DELETE" }).catch(() => {});
    },
    [setVideos]
  );

  const applyWorkspaces = useCallback(
    (video: SeedanceVideo, workspaces: string[]) => {
      setVideos((prev) =>
        prev.map((item) =>
          item.filename === video.filename ? { ...item, workspaces } : item
        )
      );
    },
    [setVideos]
  );

  const refreshVideos = useCallback(() => {
    fetch("/api/seedance/videos", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setVideos(data.videos ?? []))
      .catch(() => {});
  }, [setVideos]);

  const visibleVideos = useMemo(
    () =>
      videos.filter((video) =>
        fileMatchesWorkspace(video.workspaces, activeWorkspaceId)
      ),
    [videos, activeWorkspaceId]
  );

  const isGenerating = pending.some((p) => p.status?.state === "generating" || p.status?.state === "queued");
  const canGenerate =
    params.mode === "t2v" ? params.prompt.trim().length > 0 : Boolean(params.firstFrame);

  const referenceSlots = useMemo(
    () => [...params.references, ...Array(SEEDANCE_MAX_REFERENCES - params.references.length).fill(null)],
    [params.references]
  );

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Control panel */}
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Clapperboard className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold leading-5">{tr("title", language)}</h1>
            <p className="truncate text-[11px] text-muted-foreground">{tr("subtitle", language)}</p>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-card/60 p-1">
            {(["i2v", "t2v"] as SeedanceMode[]).map((mode) => (
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
                {mode === "i2v" ? <ImagePlus className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                {mode === "i2v" ? tr("modeI2v", language) : tr("modeT2v", language)}
              </button>
            ))}
          </div>

          {/* Images (i2v) */}
          {params.mode === "i2v" && (
            <div className="space-y-3">
              <DropZone
                lang={language}
                value={params.firstFrame}
                onChange={(v) => patch({ firstFrame: v })}
                onPickGallery={() => setPicker(() => (url: string) => void toDataUrl(url).then((d) => patch({ firstFrame: d })))}
                label={tr("firstFrame", language)}
                hint={tr("firstFrameHint", language)}
                large
              />

              {!showLastFrame ? (
                <button
                  type="button"
                  onClick={() => setShowLastFrame(true)}
                  className="text-[11px] font-medium text-primary hover:underline"
                >
                  + {tr("lastFrame", language)}
                </button>
              ) : (
                <DropZone
                  lang={language}
                  value={params.lastFrame}
                  onChange={(v) => patch({ lastFrame: v })}
                  onPickGallery={() => setPicker(() => (url: string) => void toDataUrl(url).then((d) => patch({ lastFrame: d })))}
                  label={tr("lastFrame", language)}
                />
              )}

              {!showReferences ? (
                <button
                  type="button"
                  onClick={() => setShowReferences(true)}
                  className="block text-[11px] font-medium text-primary hover:underline"
                >
                  + {tr("references", language)}
                </button>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">{tr("references", language)}</Label>
                  <p className="text-[10.5px] leading-tight text-muted-foreground">
                    {tr("referencesHint", language)}
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {referenceSlots.map((ref, idx) =>
                      ref ? (
                        <div key={idx} className="relative aspect-square overflow-hidden rounded-md border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={ref} alt="ref" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            onClick={() =>
                              patch({ references: params.references.filter((_, i) => i !== idx) })
                            }
                            className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white hover:bg-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setPicker(() => (url: string) =>
                              void toDataUrl(url).then((d) =>
                                setParams((p) => ({
                                  ...p,
                                  references: [...p.references, d].slice(0, SEEDANCE_MAX_REFERENCES),
                                }))
                              )
                            )
                          }
                          className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-primary/60"
                        >
                          <ImagePlus className="h-4 w-4" />
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Prompt */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{tr("prompt", language)}</Label>
            <Textarea
              ref={promptRef}
              value={params.prompt}
              onChange={(e) => patch({ prompt: e.target.value })}
              placeholder={tr("promptPlaceholder", language)}
              className="min-h-[104px] resize-y text-sm"
            />
            <p className="text-[10.5px] leading-tight text-muted-foreground">{tr("promptTip", language)}</p>
            <div className="space-y-2 pt-1">
              {SEEDANCE_PROMPT_CHIPS.map((group) => (
                <div key={group.title.en}>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title[language]}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.chips.map((chip) => (
                      <button
                        key={chip.insert}
                        type="button"
                        onClick={() => insertChip(chip.insert)}
                        className="rounded-full border border-border bg-card/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                      >
                        {chip.label[language]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Parameters */}
          <div className="space-y-3">
            {/* Resolution */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{tr("resolution", language)}</Label>
              <div className="grid grid-cols-3 gap-1">
                {SEEDANCE_RESOLUTIONS.map((res) => (
                  <SegButton
                    key={res}
                    active={params.resolution === res}
                    onClick={() => patch({ resolution: res as SeedanceResolution })}
                  >
                    {res}
                  </SegButton>
                ))}
              </div>
            </div>

            {/* Ratio */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{tr("ratio", language)}</Label>
              <div className="flex flex-wrap gap-1">
                {SEEDANCE_RATIOS.map((r) => (
                  <SegButton
                    key={r}
                    active={params.ratio === r}
                    onClick={() => patch({ ratio: r as SeedanceRatio })}
                  >
                    {r === "adaptive" ? tr("ratioAdaptive", language) : r}
                  </SegButton>
                ))}
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">{tr("duration", language)}</Label>
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {params.duration}
                  {tr("seconds", language)}
                </span>
              </div>
              <Slider
                value={[params.duration]}
                onValueChange={(v) => patch({ duration: Array.isArray(v) ? v[0] : (v as number) })}
                min={SEEDANCE_DURATION_MIN}
                max={SEEDANCE_DURATION_MAX}
                step={1}
              />
            </div>

            {/* Toggles */}
            <ToggleRow
              label={tr("cameraFixed", language)}
              hint={tr("cameraFixedHint", language)}
              checked={params.cameraFixed}
              onChange={(v) => patch({ cameraFixed: v })}
            />
            <ToggleRow
              label={tr("cleanFrame", language)}
              hint={tr("cleanFrameHint", language)}
              checked={params.cleanFrame}
              onChange={(v) => patch({ cleanFrame: v })}
            />
            <ToggleRow
              label={tr("watermark", language)}
              checked={params.watermark}
              onChange={(v) => patch({ watermark: v })}
            />

            {/* Seed */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">{tr("seed", language)}</Label>
              <Input
                type="number"
                value={params.seed ?? ""}
                placeholder={tr("seedPlaceholder", language)}
                onChange={(e) =>
                  patch({ seed: e.target.value === "" ? null : Number(e.target.value) })
                }
                className="h-8 text-sm"
              />
            </div>
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
            {isGenerating ? `${tr("generate", language)} +` : tr("generate", language)}
          </Button>
          <p className="text-center text-[10.5px] leading-tight text-muted-foreground">
            {tr("costHint", language)}
          </p>
        </div>
      </aside>

      {/* Results */}
      <main className="flex-1 overflow-y-auto">
        <div className="border-b border-border px-6 py-3">
          <h2 className="text-sm font-semibold">{tr("results", language)}</h2>
        </div>
        <WorkspaceBar media="seedance" onDownloaded={() => refreshVideos()} />
        <div className="p-6">
          {pending.length === 0 && visibleVideos.length === 0 ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <Film className="h-10 w-10 opacity-40" />
              <p className="max-w-xs text-sm">{tr("empty", language)}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {pending.map((card) => (
                <PendingCard
                  key={card.id}
                  lang={language}
                  card={card}
                  onCancel={() => cancelGeneration(card.id)}
                  onRetry={() => {
                    removePending(card.id);
                    void startGeneration(params);
                  }}
                  onDismiss={() => removePending(card.id)}
                />
              ))}
              {visibleVideos.map((video) => (
                <VideoCard
                  key={video.id}
                  lang={language}
                  video={video}
                  onDelete={() => void deleteVideo(video)}
                  onWorkspacesChange={(workspaces) =>
                    applyWorkspaces(video, workspaces)
                  }
                  onReuse={() => {
                    if (video.params) {
                      patch({
                        prompt: video.params.prompt ?? params.prompt,
                        resolution: video.params.resolution,
                        ratio: video.params.ratio,
                        duration: video.params.duration,
                        cameraFixed: video.params.cameraFixed,
                        watermark: video.params.watermark,
                        cleanFrame: video.params.cleanFrame,
                        mode: video.params.mode,
                      });
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {picker && (
        <GalleryPicker
          lang={language}
          onClose={() => setPicker(null)}
          onPick={(url) => {
            picker(url);
            setPicker(null);
          }}
        />
      )}

      <PaimonPanel
        store={useSeedancePaimonStore}
        subtitle={
          language === "ko"
            ? "현재 SeeDance 설정을 읽고 수정합니다"
            : "Reads the current SeeDance settings and edits them"
        }
        intro={
          language === "ko"
            ? "파이몬이에요. 시작 이미지와 현재 설정을 보고 SeeDance 프롬프트·해상도·길이를 다듬어드릴게요."
            : "Paimon here. I can read the start frame and current settings, then refine the SeeDance prompt, resolution, and duration."
        }
        placeholder={
          language === "ko"
            ? "이 인물이 카메라를 보며 천천히 걸어오는 5초 영상 프롬프트를 만들어줘"
            : "Write a 5s prompt of this person walking toward the camera"
        }
      />
    </div>
  );
}

function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-card/60 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-xs font-semibold">{label}</div>
        {hint && <div className="text-[10.5px] leading-tight text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
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
  card: SeedanceVideo;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const status = card.status;
  const isError = status?.state === "error";
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="relative flex aspect-video items-center justify-center bg-muted/40">
        {card.thumbnail ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={card.thumbnail} alt="" className="h-full w-full object-cover opacity-40" />
            <div className="absolute inset-0 bg-black/30" />
          </>
        ) : null}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          {isError ? (
            <>
              <X className="h-7 w-7 text-destructive" />
              <p className="max-w-[85%] px-2 text-[11px] text-destructive">{status?.message}</p>
              <div className="flex gap-1.5">
                <Button size="xs" variant="outline" onClick={onRetry}>
                  <RotateCcw className="h-3 w-3" /> {tr("retry", lang)}
                </Button>
                <Button size="xs" variant="ghost" onClick={onDismiss}>
                  {tr("dismiss", lang)}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-[11px] font-medium text-foreground">{status?.message}</p>
            </>
          )}
        </div>
      </div>
      {!isError && (
        <div className="space-y-2 p-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((status?.progress ?? 0) * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="truncate text-[11px] text-muted-foreground">{card.prompt || "—"}</p>
            <Button size="xs" variant="ghost" onClick={onCancel}>
              <Square className="h-3 w-3" /> {tr("cancel", lang)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoCard({
  lang,
  video,
  onDelete,
  onReuse,
  onWorkspacesChange,
}: {
  lang: Lang;
  video: SeedanceVideo;
  onDelete: () => void;
  onReuse: () => void;
  onWorkspacesChange: (workspaceIds: string[]) => void;
}) {
  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-card">
      <video
        src={video.url}
        controls
        loop
        playsInline
        className="aspect-video w-full bg-black object-contain"
      />
      <div className="space-y-2 p-3">
        <p className="line-clamp-2 text-xs text-muted-foreground">{video.prompt || "—"}</p>
        <div className="flex flex-wrap gap-1">
          {video.params && (
            <>
              <Badge variant="secondary">{video.params.resolution}</Badge>
              <Badge variant="secondary">{video.params.duration}s</Badge>
              <Badge variant="secondary">
                {video.params.ratio === "adaptive" ? "auto" : video.params.ratio}
              </Badge>
              {video.params.mode === "i2v" && <Badge variant="outline">I2V</Badge>}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <a
            href={video.url}
            download={video.filename}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {tr("download", lang)}
          </a>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={onReuse}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {tr("reuse", lang)}
          </button>
          {/* The same workspaces as the image gallery — this screen only ever
              lists the clips filed under them. */}
          <div className="ml-auto flex items-center gap-1.5">
            <MediaWorkspacePicker
              media="seedance"
              filename={video.filename}
              workspaceIds={video.workspaces ?? []}
              onChange={onWorkspacesChange}
              triggerVariant="outline"
              triggerClassName="h-7 w-7"
            />
            <button
              type="button"
              onClick={onDelete}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
