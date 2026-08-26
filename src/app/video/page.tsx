"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { AppSidebar } from "@/components/app-sidebar";
import { WorkspaceBar } from "@/components/workspace-bar";
import { MediaWorkspacePicker } from "@/components/workspace-picker";
import { CivitaiMissingResources } from "@/components/civitai-missing-resources";
import { CopyLinkButton } from "@/components/copy-link-button";
import { EditorSection } from "@/components/editor-section";
import { ImageUpload } from "@/components/image-upload";
import { VideoReferenceImport } from "@/components/video-reference-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { useVideoStore } from "@/lib/video-store";
import {
  useVideoGenerationQueueStore,
  type VideoGenerationDetail,
} from "@/lib/video-generation-queue-store";
import {
  fileMatchesWorkspace,
  useMediaWorkspaceStore,
} from "@/lib/media-workspace-store";
import { useVideoPaimonStore } from "@/lib/video-paimon-store";
import { useVideoSituationStore } from "@/lib/video-situation-store";
import { videoDurationSeconds } from "@/lib/video-duration";
import { PaimonPanel } from "@/components/paimon-panel";
import { DEFAULT_CONVERSATION } from "@/lib/paimon-conversation";
import {
  CharacterSituationPicker,
  type SituationRunRequest,
} from "@/components/character-situation-picker";
import {
  useRunpodDownloadStore,
  type RunpodDownloadItem,
} from "@/lib/runpod-download-store";
import { takeVideoReference } from "@/lib/video-reference";
import { censorSetupReady, type CensorSetupStatus } from "@/lib/censor-assets";
import {
  DEFAULT_CENSOR_SETTINGS,
  DEFAULT_VIDEO_PARAMS,
  type CensorMethod,
  type CivitaiImportResult,
  type GeneratedVideo,
  type GenerationParams,
  type VideoGenerationParams,
} from "@/lib/types";
import {
  findMissingCivitaiResources,
  type LocalModelsResponse,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson,
  Film,
  GripVertical,
  Check,
  CheckCircle2,
  AlertTriangle,
  ClipboardCopy,
  Clock,
  CopyPlus,
  HelpCircle,
  LinkIcon,
  Loader2,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCcw,
  Server,
  ShieldAlert,
  Wrench,
  RotateCcw,
  Trash2,
  Volume2,
  X,
  XCircle,
} from "lucide-react";

type AppLanguage = "ko" | "en";

const VAE_SETTING_HELP = {
  tileSize: {
    ko: "한 번에 디코딩하는 이미지 영역의 크기입니다. 값이 크면 타일 경계가 줄고 처리 속도가 좋아질 수 있지만 VRAM 사용량이 증가합니다. RTX 3060 12GB 권장값은 256이며, 여유가 있으면 320~512를 시험하세요.",
    en: "The spatial image area decoded at once. Larger values can reduce tile seams and improve speed, but consume more VRAM. Use 256 for an RTX 3060 12 GB; try 320–512 only if memory allows.",
  },
  tileOverlap: {
    ko: "인접한 공간 타일이 서로 겹치는 픽셀 수입니다. 값을 높이면 타일 경계선이나 색상 차이가 줄지만 디코딩 시간이 늘어납니다. 일반적으로 Tile Size의 1/4 정도인 64가 안정적입니다.",
    en: "The number of pixels shared by adjacent spatial tiles. More overlap reduces seams and color shifts, but increases decode time. A stable starting point is 64, about one quarter of a 256 tile.",
  },
  temporalSize: {
    ko: "한 번에 디코딩하는 연속 프레임 수입니다. 영상이 규칙적으로 밝아지거나 깜빡이면 이 값을 높이세요. 값이 클수록 시간 청크 경계가 줄지만 VRAM 사용량이 크게 증가합니다. 81프레임 영상은 64가 권장값입니다.",
    en: "The number of consecutive frames decoded in one temporal chunk. Increase it when the video brightens or flashes at regular intervals. Larger chunks reduce temporal boundaries but significantly increase VRAM use. Use 64 for an 81-frame video.",
  },
  temporalOverlap: {
    ko: "인접한 시간 청크가 공유하는 프레임 수입니다. 값을 높이면 청크 사이의 밝기와 색상 전환이 부드러워지지만 처리 시간이 늘어납니다. Temporal Size 64에는 16을 권장하며, 반드시 Temporal Size보다 작아야 합니다.",
    en: "The number of frames shared by adjacent temporal chunks. More overlap smooths brightness and color transitions, but increases processing time. Use 16 with a Temporal Size of 64; it must remain smaller than Temporal Size.",
  },
} as const;

function SettingHelpTooltip({
  text,
  language,
}: {
  text: string;
  language: AppLanguage;
}) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={language === "ko" ? "설정 상세 설명" : "Setting details"}
            />
          }
        >
          <HelpCircle className="size-3.5" />
        </TooltipTrigger>
        <TooltipContent className="max-w-sm whitespace-normal py-2.5 text-left leading-relaxed">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface WorkflowConfigState {
  configured: boolean;
  exists: boolean;
  ready: boolean;
  missing: string[];
  requiresSourceImage?: boolean;
  includesAudio?: boolean;
  message: string;
}

interface VideoConfigState extends WorkflowConfigState {
  audio: WorkflowConfigState;
}

interface RunpodPodOption {
  id: string;
  kind?: "image" | "video";
  label: string;
  podId: string;
  ssh: string;
  comfyUrl: string;
}

interface RunpodConnectionStatus {
  checked: boolean;
  comfyReachable: boolean;
  comfyInitializing: boolean;
  helperReachable: boolean;
  helperInitializing: boolean;
  helperOutdated: boolean;
  comfyError: string;
  helperError: string;
  comfyVersion: string;
  podDesiredStatus: string;
}

interface VideoPipelineCanvasSupport {
  resolution: boolean;
  frames: boolean;
  fps: boolean;
}

interface VideoPipelineOption {
  id: string;
  label: string;
  description: string;
  workflowPath: string;
  mode: "i2v" | "t2v";
  experimental?: boolean;
  embedsAudio?: boolean;
  canvas?: VideoPipelineCanvasSupport;
  defaults: Record<string, string | number | boolean>;
  controls: VideoPipelineControlOption[];
}

// A pipeline the client hasn't loaded metadata for is treated as honoring every
// canvas field (legacy behavior) so we never hide an input that actually works.
const FULL_CANVAS_SUPPORT: VideoPipelineCanvasSupport = {
  resolution: true,
  frames: true,
  fps: true,
};

interface VideoPipelineControlOption {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "boolean";
  defaultValue: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  group: "core" | "sampling" | "conditioning" | "lora" | "resize" | "advanced";
  help: string;
  patches: Array<{
    nodeId: string;
    input: string;
  }>;
}

type GenerationDetail = VideoGenerationDetail;

const VIDEO_GENERATION_TARGET_KEY = "image-gen-video:generation-target";
const VIDEO_SELECTED_RUNPOD_POD_KEY = "image-gen-video:selected-runpod-pod-id";

function rememberVideoRunpodPod(podId: string) {
  try {
    if (podId) {
      window.localStorage.setItem(VIDEO_SELECTED_RUNPOD_POD_KEY, podId);
    } else {
      window.localStorage.removeItem(VIDEO_SELECTED_RUNPOD_POD_KEY);
    }
  } catch {}
}

function numericValue(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pipelineSettingValue(
  params: VideoGenerationParams,
  control: VideoPipelineControlOption
) {
  return params.video_pipeline_settings?.[control.key] ?? control.defaultValue;
}

function pipelineControlHelp(control: VideoPipelineControlOption) {
  const nodes = control.patches
    .map((patch) => `${patch.nodeId}.${patch.input}`)
    .join(", ");
  return `${control.help} 적용 node: ${nodes}.`;
}

function formatElapsed(ms: number | undefined) {
  if (!ms || ms < 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function isGif(video: GeneratedVideo) {
  return video.contentType === "image/gif" || video.filename.toLowerCase().endsWith(".gif");
}

const VIDEO_EDITOR_MIN_WIDTH = 320;
const VIDEO_GALLERY_MIN_WIDTH = 320;
const VIDEO_THUMBNAIL_MIN_WIDTH = 180;
const VIDEO_THUMBNAIL_MAX_WIDTH = 560;

function VideoGalleryCard({
  video,
  language,
  liveDetail,
  onDelete,
  onCancelGeneration,
  onReuse,
  onRemovePending,
  onOpenDetail,
  onWorkspacesChange,
}: {
  video: GeneratedVideo;
  language: AppLanguage;
  liveDetail?: GenerationDetail;
  onDelete: (video: GeneratedVideo) => Promise<void>;
  onCancelGeneration: (video: GeneratedVideo) => void;
  onReuse: (video: GeneratedVideo) => void;
  onRemovePending: (video: GeneratedVideo) => void;
  onOpenDetail: (video: GeneratedVideo) => void;
  onWorkspacesChange: (video: GeneratedVideo, workspaceIds: string[]) => void;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [errorCopied, setErrorCopied] = useState(false);

  const generation = video.generation;
  const hasVideo = Boolean(video.url);
  const displayState =
    generation?.state === "generating" &&
    /queued|waiting for comfyui|queued\.\.\./i.test(generation.message)
      ? "waiting"
      : generation?.state;
  const isPending =
    displayState === "queued" ||
    displayState === "waiting" ||
    displayState === "generating";
  const progress = Math.min(100, Math.max(0, generation?.progress ?? 0));
  const statusLabel =
    displayState === "queued"
      ? language === "ko" ? "대기열" : "Queued"
      : displayState === "waiting"
        ? language === "ko" ? "준비 중" : "Waiting"
        : displayState === "generating"
          ? language === "ko" ? "생성 중" : "Generating"
          : displayState === "error"
            ? language === "ko" ? "오류" : "Error"
            : displayState === "canceled"
              ? language === "ko" ? "취소됨" : "Canceled"
              : "";
  const StatusIcon =
    displayState === "queued" || displayState === "waiting"
      ? Clock
      : displayState === "generating"
        ? Loader2
        : displayState === "error"
          ? AlertCircle
          : displayState === "canceled"
            ? XCircle
            : null;

  const copyErrorDetails = async () => {
    const details =
      generation?.message ||
      (language === "ko" ? "알 수 없는 생성 오류" : "Unknown generation error");
    try {
      await navigator.clipboard.writeText(details);
      setErrorCopied(true);
      window.setTimeout(() => setErrorCopied(false), 1600);
    } catch {
      setErrorCopied(false);
    }
  };

  useLayoutEffect(() => {
    const article = articleRef.current;
    const content = contentRef.current;
    if (!article || !content) return;

    const updateSpan = () => {
      article.style.gridRowEnd =
        "span " + Math.max(1, Math.ceil((content.offsetHeight + 16) / 24));
    };
    const observer = new ResizeObserver(updateSpan);
    observer.observe(content);
    updateSpan();

    return () => observer.disconnect();
  }, []);

  if (!hasVideo) {
    return (
      <article
        ref={articleRef}
        className="relative overflow-hidden rounded-md border border-border shadow-sm"
      >
        <div
          ref={contentRef}
          className={`relative flex flex-col gap-3 p-3 ${
            displayState === "generating"
              ? "bg-slate-950 text-white"
              : displayState === "error"
                ? "bg-red-50 text-red-950"
                : displayState === "canceled"
                  ? "bg-slate-100 text-slate-700"
                  : displayState === "waiting"
                    ? "bg-amber-50 text-amber-950"
                    : "bg-sky-50 text-sky-950"
          }`}
        >
          {displayState === "generating" && (
            <>
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(34,211,238,0.28),transparent_38%),radial-gradient(circle_at_80%_70%,rgba(168,85,247,0.30),transparent_42%)]" />
              <div className="gallery-generation-scan pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-cyan-300/20 to-transparent" />
              <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:24px_24px]" />
            </>
          )}
          <div className="relative z-10 flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className={`rounded-md ${
                displayState === "generating"
                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                  : displayState === "error"
                    ? "border-red-300 bg-red-100 text-red-700"
                    : displayState === "canceled"
                      ? "border-slate-300 bg-slate-200 text-slate-600"
                      : displayState === "waiting"
                        ? "border-amber-300 bg-amber-100 text-amber-800"
                        : "border-sky-300 bg-sky-100 text-sky-800"
              }`}
            >
              {StatusIcon && (
                <StatusIcon
                  className={`h-3 w-3 ${
                    displayState === "generating" ? "animate-spin" : ""
                  }`}
                />
              )}
              {statusLabel || "Pending"}
            </Badge>
            {isPending && (
              <span
                className={`text-xs font-medium tabular-nums ${
                  displayState === "generating" ? "text-cyan-100" : "opacity-70"
                }`}
              >
                {Math.round(progress)}%
              </span>
            )}
          </div>

          <div className="relative z-10 flex items-center justify-center py-4">
            {displayState === "generating" ? (
              <div className="relative flex h-24 w-24 items-center justify-center">
                <div className="absolute inset-0 animate-spin rounded-full border border-transparent border-r-violet-400 border-t-cyan-300" />
                <div className="absolute inset-2 animate-[spin_3s_linear_infinite_reverse] rounded-full border border-transparent border-b-fuchsia-300 border-l-cyan-200" />
                <div className="absolute inset-5 animate-pulse rounded-full bg-white/10 shadow-[0_0_30px_rgba(34,211,238,.35)]" />
                <Film className="relative h-8 w-8 text-cyan-100 drop-shadow-[0_0_10px_rgba(103,232,249,.8)]" />
              </div>
            ) : displayState === "error" ? (
              <div className="flex flex-col items-center gap-2 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600 ring-1 ring-red-200">
                  <AlertCircle className="h-7 w-7" />
                </span>
                <p className="text-sm font-semibold">
                  {language === "ko" ? "생성에 실패했습니다" : "Generation failed"}
                </p>
              </div>
            ) : (
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-full ${
                  displayState === "waiting"
                    ? "bg-amber-100 text-amber-600"
                    : displayState === "canceled"
                      ? "bg-slate-200 text-slate-500"
                      : "bg-sky-100 text-sky-600"
                }`}
              >
                {StatusIcon ? <StatusIcon className="h-7 w-7" /> : <Film className="h-7 w-7" />}
              </span>
            )}
          </div>

          <div className="relative z-10 space-y-2">
            {generation?.message && (
              <p
                className={`line-clamp-2 text-[11px] font-medium ${
                  displayState === "generating"
                    ? "text-cyan-100/80"
                    : displayState === "waiting"
                      ? "text-amber-800/80"
                      : displayState === "error"
                        ? "text-red-700"
                        : displayState === "canceled"
                          ? "text-slate-500"
                          : "text-sky-800/80"
                }`}
              >
                {generation.message}
              </p>
            )}
            {isPending && (
              <div
                className={`h-1.5 overflow-hidden rounded-full ${
                  displayState === "generating" ? "bg-white/15" : "bg-black/10"
                }`}
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    displayState === "waiting"
                      ? "bg-amber-500"
                      : "bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {isPending && liveDetail && (
              <div
                className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] ${
                  displayState === "generating" ? "text-cyan-100/70" : "opacity-60"
                }`}
              >
                <span className="font-mono">{formatElapsed(liveDetail.elapsed_ms)}</span>
                {typeof liveDetail.step === "number" &&
                  typeof liveDetail.total_steps === "number" && (
                    <span>
                      step {liveDetail.step}/{liveDetail.total_steps}
                    </span>
                  )}
                {liveDetail.node_type && <span>{liveDetail.node_type}</span>}
                {liveDetail.node_id && <span>node {liveDetail.node_id}</span>}
                {liveDetail.stage && <span>{liveDetail.stage}</span>}
              </div>
            )}
            <p
              className={`line-clamp-2 text-xs leading-5 ${
                displayState === "generating" ? "text-white/90" : ""
              }`}
            >
              {video.params?.prompt || "No prompt"}
            </p>
            {displayState === "error" ? (
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 min-w-0 px-1 text-[10px]"
                  onClick={() => onReuse(video)}
                  disabled={!video.params}
                  title={
                    language === "ko"
                      ? "실패 당시의 생성 설정을 편집 영역에 불러옵니다"
                      : "Load the failed generation settings into the editor"
                  }
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  {language === "ko" ? "설정 재사용" : "Reuse"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 min-w-0 px-1 text-[10px]"
                  onClick={() => void copyErrorDetails()}
                  title={
                    language === "ko"
                      ? "오류 메시지를 클립보드에 복사합니다"
                      : "Copy the error message"
                  }
                >
                  {errorCopied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <ClipboardCopy className="h-3.5 w-3.5" />
                  )}
                  {errorCopied
                    ? language === "ko" ? "복사됨" : "Copied"
                    : language === "ko" ? "오류 복사" : "Copy"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 min-w-0 px-1 text-[10px]"
                  onClick={() => onRemovePending(video)}
                  title={language === "ko" ? "오류 카드를 제거합니다" : "Remove this error card"}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {language === "ko" ? "제거" : "Remove"}
                </Button>
              </div>
            ) : (
              <div
                className={`grid gap-1.5 pt-1 ${
                  (isPending || displayState === "canceled") ? "grid-cols-2" : "grid-cols-1"
                }`}
              >
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`h-8 min-w-0 px-1 text-[11px] ${
                    displayState === "generating"
                      ? "border-white/25 bg-white/10 text-white hover:bg-white/20 hover:text-white"
                      : ""
                  }`}
                  onClick={() => onReuse(video)}
                  disabled={!video.params}
                  title={
                    language === "ko"
                      ? "이 생성의 설정을 편집 영역에 불러옵니다"
                      : "Load this generation's settings into the editor"
                  }
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  {language === "ko" ? "설정 재사용" : "Reuse"}
                </Button>
                {isPending && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-8 min-w-0 px-1 text-[11px]"
                    onClick={() => onCancelGeneration(video)}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {language === "ko" ? "생성 취소" : "Cancel"}
                  </Button>
                )}
                {displayState === "canceled" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="h-8 min-w-0 px-1 text-[11px]"
                    onClick={() => onRemovePending(video)}
                    title={language === "ko" ? "취소된 카드를 삭제합니다" : "Remove this canceled card"}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {language === "ko" ? "삭제" : "Delete"}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      ref={articleRef}
      className="relative overflow-hidden rounded-md border border-border bg-card shadow-sm"
    >
      <div ref={contentRef}>
        <Button
          type="button"
          size="icon-sm"
          variant="secondary"
          className="absolute left-2 top-2 z-20 shadow-md"
          onClick={() => onOpenDetail(video)}
          aria-label={language === "ko" ? "상세 보기" : "View details"}
          title={language === "ko" ? "상세 보기" : "View details"}
        >
          <Maximize2 />
        </Button>
        {/* Workspaces are shared with the image gallery; this clip only ever
            shows up under the video screens' view of them. */}
        <div className="absolute right-11 top-2 z-20 shadow-md">
          <MediaWorkspacePicker
            media="videos"
            filename={video.filename}
            workspaceIds={video.workspaces ?? []}
            onChange={(workspaceIds) => onWorkspacesChange(video, workspaceIds)}
          />
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="destructive"
          className="absolute right-2 top-2 z-20 shadow-md"
          onClick={() => setConfirmingDelete((current) => !current)}
          disabled={deleting}
          aria-label="Delete video"
          title="Delete video"
        >
          {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
        </Button>
        {confirmingDelete && (
          <div className="absolute right-2 top-12 z-30 w-44 rounded-md border border-border bg-popover p-2.5 shadow-xl">
            <p className="text-[11px] font-medium text-popover-foreground">
              Delete this video?
            </p>
            {deleteError && (
              <p className="mt-1 text-[11px] text-destructive">{deleteError}</p>
            )}
            <div className="mt-2 flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 flex-1 text-[11px]"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setDeleteError("");
                  try {
                    await onDelete(video);
                    setConfirmingDelete(false);
                  } catch (error) {
                    setDeleteError(
                      error instanceof Error ? error.message : "Failed to delete video."
                    );
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                Delete
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 flex-1 text-[11px]"
                disabled={deleting}
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
        <div className="bg-background">
          {isGif(video) ? (
            <img
              src={video.url}
              alt={video.params?.prompt || "Generated video"}
              className="block h-auto w-full"
            />
          ) : (
            <video
              src={video.url}
              controls
              muted
              playsInline
              preload="metadata"
              className="block h-auto w-full"
            />
          )}
        </div>
        <div className="space-y-1 border-t border-border p-3">
          <p className="line-clamp-2 text-sm font-medium">
            {video.params?.prompt || "Generated video"}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(video.timestamp).toLocaleString()}
          </p>
          {video.audios && video.audios.length > 0 && (
            <div className="space-y-2 pt-2">
              {video.audios.map((audio) => (
                <div
                  key={audio.id}
                  className="rounded-md border border-border bg-background/80 p-2"
                >
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Sound
                  </div>
                  <audio src={audio.url} controls className="h-8 w-full" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

function VideoDetailField({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function VideoDetailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function VideoDetailModal({
  video,
  videos,
  language,
  pipelines,
  onClose,
  onSelectVideo,
  onReuse,
  onDelete,
}: {
  video: GeneratedVideo;
  videos: GeneratedVideo[];
  language: AppLanguage;
  pipelines: VideoPipelineOption[];
  onClose: () => void;
  onSelectVideo: (video: GeneratedVideo) => void;
  onReuse: (video: GeneratedVideo) => void;
  onDelete: (video: GeneratedVideo) => Promise<void>;
}) {
  const ko = language === "ko";
  const [originalSize, setOriginalSize] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [metadataCopied, setMetadataCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const gif = isGif(video);
  const params = video.params;

  const index = videos.findIndex((item) => item.id === video.id);
  const hasNavigation = videos.length > 1;

  const navigate = useCallback(
    (direction: "prev" | "next") => {
      if (videos.length === 0) return;
      const current = videos.findIndex((item) => item.id === video.id);
      if (current === -1) return;
      const nextIndex =
        direction === "prev"
          ? (current - 1 + videos.length) % videos.length
          : (current + 1) % videos.length;
      onSelectVideo(videos[nextIndex]);
    },
    [onSelectVideo, video.id, videos]
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      navigate(event.key === "ArrowLeft" ? "prev" : "next");
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [navigate]);

  const downloadVideo = () => {
    const a = document.createElement("a");
    a.href = video.url;
    a.download = video.filename || "video";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const copyMetadata = async () => {
    const metadata = {
      id: video.id,
      filename: video.filename,
      url: video.url,
      contentType: video.contentType,
      timestamp: video.timestamp,
      createdAt: new Date(video.timestamp).toISOString(),
      params: video.params,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(metadata, null, 2));
      setMetadataCopied(true);
      window.setTimeout(() => setMetadataCopied(false), 1500);
    } catch {
      setMetadataCopied(false);
    }
  };

  const pipeline = params
    ? pipelines.find((item) => item.id === params.video_pipeline) ??
      pipelines.find((item) => item.id === params.video_model)
    : undefined;
  const durationSeconds =
    params && params.fps > 0
      ? Math.round((params.num_frames / params.fps) * 10) / 10
      : params?.duration_seconds;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="!block h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-[96vw]">
        <DialogTitle className="sr-only">
          {ko ? "비디오 상세 정보" : "Video Details"}
        </DialogTitle>

        <div className="flex h-full w-full flex-col bg-background">
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)]">
            <div className="relative min-w-0 overflow-auto border-r border-border bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--border)_55%,transparent)_1px,transparent_0)] [background-size:24px_24px]">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={downloadVideo}
                className="absolute right-4 top-4 z-10 h-11 w-11 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
                aria-label={ko ? "비디오 다운로드" : "Download video"}
                title={ko ? "비디오 다운로드" : "Download video"}
              >
                <Download className="h-5 w-5" />
              </Button>
              {hasNavigation && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => navigate("prev")}
                    className="absolute left-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
                    aria-label={ko ? "이전 비디오" : "Previous video"}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => navigate("next")}
                    className="absolute right-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
                    aria-label={ko ? "다음 비디오" : "Next video"}
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              )}
              <div className="flex h-full min-h-0 min-w-full items-center justify-center p-6">
                <div
                  className={
                    originalSize
                      ? "m-auto rounded-lg border border-border bg-card p-2 shadow-lg"
                      : "m-auto flex max-h-full max-w-full rounded-lg border border-border bg-card p-2 shadow-lg"
                  }
                >
                  {gif ? (
                    <img
                      src={video.url}
                      alt={params?.prompt || "Generated video"}
                      onLoad={(event) =>
                        setNaturalSize({
                          width: event.currentTarget.naturalWidth,
                          height: event.currentTarget.naturalHeight,
                        })
                      }
                      className={
                        originalSize
                          ? "block h-auto max-h-none w-auto max-w-none rounded-md"
                          : "block h-auto max-h-[calc(94vh-9rem)] max-w-full rounded-md object-contain"
                      }
                    />
                  ) : (
                    <video
                      src={video.url}
                      controls
                      autoPlay
                      loop
                      muted
                      playsInline
                      onLoadedMetadata={(event) =>
                        setNaturalSize({
                          width: event.currentTarget.videoWidth,
                          height: event.currentTarget.videoHeight,
                        })
                      }
                      className={
                        originalSize
                          ? "block h-auto max-h-none w-auto max-w-none rounded-md"
                          : "block h-auto max-h-[calc(94vh-9rem)] max-w-full rounded-md object-contain"
                      }
                    />
                  )}
                </div>
              </div>
              {naturalSize.width > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOriginalSize((current) => !current)}
                  className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 gap-1.5 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  {originalSize
                    ? ko ? "화면에 맞추기" : "Fit to screen"
                    : ko
                      ? `원본 크기 (${naturalSize.width}×${naturalSize.height})`
                      : `Original (${naturalSize.width}×${naturalSize.height})`}
                </Button>
              )}
            </div>

            <aside className="flex min-h-0 flex-col bg-card">
              <header className="border-b border-border bg-secondary/50 px-5 py-4 pr-12">
                <div className="text-xs font-bold uppercase tracking-wide text-primary">
                  {ko ? "생성된 비디오" : "Generated Video"}
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-foreground">
                  {video.filename || (ko ? "비디오" : "Video")}
                </div>
                <div className="mt-1 text-xs font-medium text-muted-foreground">
                  {new Date(video.timestamp).toLocaleString()}
                </div>
              </header>

              <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
                <Button
                  size="sm"
                  onClick={() => {
                    onReuse(video);
                    onClose();
                  }}
                  disabled={!params}
                >
                  <RotateCcw className="h-4 w-4" />
                  {ko ? "설정 재사용" : "Reuse"}
                </Button>
                <Button size="sm" variant="outline" onClick={downloadVideo}>
                  <Download className="h-4 w-4" />
                  {ko ? "다운로드" : "Download"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copyMetadata()}>
                  {metadataCopied ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <FileJson className="h-4 w-4" />
                  )}
                  {metadataCopied
                    ? ko ? "복사됨" : "Copied"
                    : ko ? "메타데이터 복사" : "Copy metadata"}
                </Button>
                <div className="relative">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={deleting}
                    onClick={() => setConfirmingDelete((current) => !current)}
                  >
                    {deleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {ko ? "삭제" : "Delete"}
                  </Button>
                  {confirmingDelete && (
                    <div className="absolute right-0 top-11 z-20 w-44 rounded-md border border-border bg-popover p-2.5 shadow-xl">
                      <p className="text-[11px] font-medium leading-4 text-popover-foreground">
                        {ko ? "이 비디오를 삭제할까요?" : "Delete this video?"}
                      </p>
                      {deleteError && (
                        <p className="mt-1 text-[11px] text-destructive">{deleteError}</p>
                      )}
                      <div className="mt-2 flex gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          className="h-7 flex-1 text-[11px]"
                          disabled={deleting}
                          onClick={async () => {
                            setDeleting(true);
                            setDeleteError("");
                            try {
                              const neighbor =
                                index > 0
                                  ? videos[index - 1]
                                  : videos[index + 1] ?? null;
                              await onDelete(video);
                              setConfirmingDelete(false);
                              if (neighbor && neighbor.id !== video.id) {
                                onSelectVideo(neighbor);
                              } else {
                                onClose();
                              }
                            } catch (error) {
                              setDeleteError(
                                error instanceof Error
                                  ? error.message
                                  : ko ? "삭제하지 못했습니다." : "Failed to delete video."
                              );
                            } finally {
                              setDeleting(false);
                            }
                          }}
                        >
                          {ko ? "삭제" : "Delete"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-[11px]"
                          disabled={deleting}
                          onClick={() => setConfirmingDelete(false)}
                        >
                          {ko ? "취소" : "Cancel"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background/70 p-5">
                {params ? (
                  <>
                    <VideoDetailSection label="Prompt">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                        {params.prompt || (ko ? "프롬프트 없음" : "No prompt")}
                      </p>
                    </VideoDetailSection>

                    {params.negative_prompt && (
                      <VideoDetailSection label="Negative Prompt">
                        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                          {params.negative_prompt}
                        </p>
                      </VideoDetailSection>
                    )}

                    <VideoDetailSection label={ko ? "생성 정보" : "Generation"}>
                      <div className="grid grid-cols-2 gap-2">
                        <VideoDetailField
                          label={ko ? "파이프라인" : "Pipeline"}
                          value={pipeline?.label || params.video_pipeline || params.video_model}
                        />
                        <VideoDetailField
                          label={ko ? "모드" : "Mode"}
                          value={(pipeline?.mode || "i2v").toUpperCase()}
                        />
                        <VideoDetailField
                          label={ko ? "해상도" : "Resolution"}
                          value={`${params.width} × ${params.height}`}
                        />
                        {naturalSize.width > 0 && (
                          <VideoDetailField
                            label={ko ? "실제 해상도" : "Actual resolution"}
                            value={`${naturalSize.width} × ${naturalSize.height}`}
                          />
                        )}
                        <VideoDetailField
                          label={ko ? "프레임 수" : "Frames"}
                          value={params.num_frames}
                        />
                        <VideoDetailField label="FPS" value={params.fps} />
                        <VideoDetailField
                          label={ko ? "길이" : "Duration"}
                          value={`${durationSeconds ?? params.duration_seconds}s`}
                        />
                        <VideoDetailField
                          label={ko ? "스텝" : "Steps"}
                          value={params.num_inference_steps}
                        />
                        <VideoDetailField label="CFG" value={params.guidance_scale} />
                        <VideoDetailField
                          label="Seed"
                          value={params.seed ?? (ko ? "랜덤" : "Random")}
                        />
                      </div>
                    </VideoDetailSection>

                    <VideoDetailSection label={ko ? "VAE 디코딩" : "VAE Decode"}>
                      <div className="grid grid-cols-2 gap-2">
                        <VideoDetailField
                          label={ko ? "타일 크기" : "Tile size"}
                          value={params.vae_tile_size}
                        />
                        <VideoDetailField
                          label={ko ? "타일 겹침" : "Tile overlap"}
                          value={params.vae_tile_overlap}
                        />
                        <VideoDetailField
                          label={ko ? "시간 청크" : "Temporal size"}
                          value={params.vae_temporal_size}
                        />
                        <VideoDetailField
                          label={ko ? "시간 겹침" : "Temporal overlap"}
                          value={params.vae_temporal_overlap}
                        />
                      </div>
                    </VideoDetailSection>

                    {params.enable_sound && (
                      <VideoDetailSection label={ko ? "사운드" : "Sound"}>
                        {params.sound_prompt && (
                          <p className="mb-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                            {params.sound_prompt}
                          </p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                          <VideoDetailField
                            label={ko ? "사운드 길이" : "Sound duration"}
                            value={`${params.sound_duration_seconds}s`}
                          />
                        </div>
                      </VideoDetailSection>
                    )}

                    {params.source_image && (
                      <VideoDetailSection label={ko ? "소스 이미지" : "Source image"}>
                        <div className="overflow-hidden rounded-md border border-border bg-background">
                          <img
                            src={params.source_image}
                            alt={ko ? "소스 이미지" : "Source image"}
                            className="block h-auto w-full object-contain"
                          />
                        </div>
                      </VideoDetailSection>
                    )}

                    {video.audios && video.audios.length > 0 && (
                      <VideoDetailSection label={ko ? "생성된 사운드" : "Generated sound"}>
                        <div className="space-y-2">
                          {video.audios.map((audio) => (
                            <div
                              key={audio.id}
                              className="rounded-md border border-border bg-background/80 p-2"
                            >
                              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium">
                                <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                                Sound
                              </div>
                              <audio src={audio.url} controls className="h-8 w-full" />
                            </div>
                          ))}
                        </div>
                      </VideoDetailSection>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {ko
                      ? "이 비디오에 대한 생성 정보가 없습니다."
                      : "No generation details are available for this video."}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function mapCivitaiParamsToVideoParams(
  imported: CivitaiImportResult
): Partial<VideoGenerationParams> {
  const importedParams = imported.params as Partial<GenerationParams>;
  const mapped: Partial<VideoGenerationParams> = {};

  if (importedParams.prompt) mapped.prompt = importedParams.prompt;
  if (importedParams.negative_prompt) {
    mapped.negative_prompt = importedParams.negative_prompt;
  }
  if (
    typeof importedParams.width === "number" &&
    typeof importedParams.height === "number"
  ) {
    const maxGenerationPixels = 480 * 592;
    const scale = Math.min(
      1,
      Math.sqrt(
        maxGenerationPixels / (importedParams.width * importedParams.height)
      )
    );
    mapped.width = Math.max(
      16,
      Math.round((importedParams.width * scale) / 16) * 16
    );
    mapped.height = Math.max(
      16,
      Math.round((importedParams.height * scale) / 16) * 16
    );
  }
  if (typeof importedParams.num_inference_steps === "number") {
    mapped.num_inference_steps = importedParams.num_inference_steps;
  }
  if (typeof importedParams.guidance_scale === "number") {
    mapped.guidance_scale = importedParams.guidance_scale;
  }
  if (typeof importedParams.seed === "number") mapped.seed = importedParams.seed;
  if (imported.imageUrl) mapped.source_image = imported.imageUrl;

  return mapped;
}

export default function VideoPage() {
  const language = useStore((state) => state.language);
  // The form's params live in the module-level video store so they survive
  // navigating away and back, and so a Paimon answer that lands while this page
  // is unmounted still applies to the params the user returns to.
  const params = useVideoStore((state) => state.params);
  const setParams = useVideoStore((state) => state.setParams);
  // The generation queue, running job, status, progress and details all live in
  // the module-level queue store (not component state) so navigating away and
  // back keeps queued Paimon batch jobs draining and the progress UI accurate —
  // exactly like the image generator's queue store.
  const status = useVideoGenerationQueueStore((state) => state.status);
  const generationDetails = useVideoGenerationQueueStore(
    (state) => state.details
  );
  const generationQueue = useVideoGenerationQueueStore((state) => state.queue);
  const activeGeneration = useVideoGenerationQueueStore((state) => state.active);
  // Both the finished `videos` and the in-flight `pendingVideos` live in a
  // module-level store (not component state) so navigating away and back keeps
  // the in-flight cards alive — and lets the detached SSE stream keep updating
  // them and land its finished video — exactly like the image gallery.
  const videos = useVideoStore((state) => state.videos);
  const setVideos = useVideoStore((state) => state.setVideos);
  const pendingVideos = useVideoStore((state) => state.pendingVideos);
  const removePendingVideoById = useVideoStore(
    (state) => state.removePendingVideo
  );
  const [thumbnailWidth, setThumbnailWidth] = useState(320);
  const [editorWidth, setEditorWidth] = useState(576);
  const [editorOpen, setEditorOpen] = useState(true);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [civitaiUrl, setCivitaiUrl] = useState("");
  const [civitaiStatus, setCivitaiStatus] = useState("");
  const [missingCivitaiResources, setMissingCivitaiResources] = useState<
    MissingResource[]
  >([]);
  const [isImportingCivitai, setIsImportingCivitai] = useState(false);
  const [videoConfig, setVideoConfig] = useState<VideoConfigState>({
    configured: true,
    exists: true,
    ready: true,
    missing: [],
    message: "",
    audio: {
      configured: false,
      exists: false,
      ready: false,
      missing: [],
      message: "Set COMFYUI_AUDIO_WORKFLOW_PATH to enable Sound generation.",
    },
  });
  const [generationTarget, setGenerationTarget] = useState<"local" | "runpod">("local");
  const [runpodPods, setRunpodPods] = useState<RunpodPodOption[]>([]);
  const [selectedRunpodPodId, setSelectedRunpodPodId] = useState("");
  const [runpodBusy, setRunpodBusy] = useState(false);
  const [runpodSetupBusy, setRunpodSetupBusy] = useState(false);
  const [runpodStatus, setRunpodStatus] = useState("");
  const [pipelineModelsBusy, setPipelineModelsBusy] = useState(false);
  const [pipelineModelsStatus, setPipelineModelsStatus] = useState("");
  const [nodeInstallBusy, setNodeInstallBusy] = useState(false);
  const [nodeInstallStatus, setNodeInstallStatus] = useState("");
  const [censorSetup, setCensorSetup] = useState<CensorSetupStatus | null>(null);
  const [censorSetupChecking, setCensorSetupChecking] = useState(false);
  const [censorInstall, setCensorInstall] = useState<{ running: boolean; message: string }>({
    running: false,
    message: "",
  });
  const [runpodConnection, setRunpodConnection] = useState<RunpodConnectionStatus>({
    checked: false,
    comfyReachable: false,
    comfyInitializing: false,
    helperReachable: false,
    helperInitializing: false,
    helperOutdated: false,
    comfyError: "",
    helperError: "",
    comfyVersion: "",
    podDesiredStatus: "",
  });
  const [runpodRunningIds, setRunpodRunningIds] = useState<Set<string>>(new Set());
  const [videoPipelines, setVideoPipelines] = useState<VideoPipelineOption[]>([]);
  const [paimonOpen, setPaimonOpen] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  // Natural pixel size of the reference/start image, used to preview the output
  // resolution for resize-driven pipelines (LTX / 10Eros) that size the video
  // from the reference image rather than explicit width/height inputs.
  const [referenceSize, setReferenceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [startImagePreviewOpen, setStartImagePreviewOpen] = useState(false);
  const autoRunpodCheckKeyRef = useRef("");
  // True once the running-pod auto-select has run for the current stint in
  // RunPod mode, so it does not fight a manual pick from the dropdown.
  const autoPodSelectRef = useRef(false);
  const runpodConnectionRef = useRef<RunpodConnectionStatus | null>(null);
  // Cache the last-known RunPod connection status in a module-level store so
  // navigating away and back does not flash the status badges to "unchecked"
  // while the poller re-runs.
  const setRunpodConnectionCache = useRunpodDownloadStore(
    (state) => state.setConnection
  );
  const startPodModelDownload = useRunpodDownloadStore(
    (state) => state.startDownload
  );
  const podDownloading = useRunpodDownloadStore((state) =>
    selectedRunpodPodId ? Boolean(state.downloadingByPod[selectedRunpodPodId]) : false
  );
  const podDownloadMessage = useRunpodDownloadStore((state) =>
    selectedRunpodPodId ? state.messageByPod[selectedRunpodPodId] ?? "" : ""
  );

  const startEditorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!editorOpen) return;

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = editorWidth;
      const onMove = (moveEvent: PointerEvent) => {
        const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth;
        const maxWidth = Math.max(
          VIDEO_EDITOR_MIN_WIDTH,
          layoutWidth - VIDEO_GALLERY_MIN_WIDTH
        );
        setEditorWidth(
          Math.min(
            maxWidth,
            Math.max(
              VIDEO_EDITOR_MIN_WIDTH,
              startWidth + moveEvent.clientX - startX
            )
          )
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editorOpen, editorWidth]
  );

  const isGenerating = activeGeneration !== null;
  const queuedJobCount = generationQueue.length;
  const videoWorkflowReady =
    videoConfig.configured && videoConfig.exists && videoConfig.ready;
  const selectedRunpodPod = useMemo(
    () => runpodPods.find((pod) => pod.id === selectedRunpodPodId),
    [runpodPods, selectedRunpodPodId]
  );
  const selectedVideoPipeline = useMemo(
    () =>
      videoPipelines.find((pipeline) => pipeline.id === params.video_pipeline) ??
      videoPipelines.find((pipeline) => pipeline.id === params.video_model),
    [params.video_model, params.video_pipeline, videoPipelines]
  );
  const runpodTargetReady =
    generationTarget !== "runpod" || Boolean(selectedRunpodPod?.comfyUrl);
  // Requirement 4: only allow generation once every RunPod connection is live —
  // ComfyUI reachable AND the model-download helper reachable.
  const runpodConnected =
    generationTarget !== "runpod" ||
    (runpodConnection.comfyReachable && runpodConnection.helperReachable);
  const runpodPodRunning =
    runpodConnection.comfyReachable ||
    runpodConnection.podDesiredStatus.toUpperCase() === "RUNNING";
  const videoWorkflowReadyForTarget =
    generationTarget === "runpod"
      ? videoConfig.configured && videoConfig.exists
      : videoWorkflowReady;
  const videoRequiresSourceImage =
    selectedVideoPipeline?.mode === "i2v" ||
    (!selectedVideoPipeline && params.video_model !== "ltx-10eros");
  // The selected pipeline's own metadata is the source of truth: it knows whether
  // the workflow bakes in audio and which canvas fields actually reach a node.
  // Fall back to the per-file config only when no pipeline is resolved yet.
  const videoIncludesAudio = selectedVideoPipeline
    ? Boolean(selectedVideoPipeline.embedsAudio)
    : Boolean(videoConfig.includesAudio);
  const canvasSupport = selectedVideoPipeline?.canvas ?? FULL_CANVAS_SUPPORT;
  const showCanvasPanel =
    canvasSupport.resolution || canvasSupport.frames || canvasSupport.fps;
  const soundWorkflowReady =
    videoConfig.audio.configured && videoConfig.audio.exists && videoConfig.audio.ready;
  // A pipeline that embeds its own audio ignores the separate sound pass, so a
  // stale enable_sound toggle must not gate generation or spin up a second pass.
  const soundPassActive = params.enable_sound && !videoIncludesAudio;
  const canGenerate =
    params.prompt.trim().length > 0 &&
    (!videoRequiresSourceImage || Boolean(params.source_image)) &&
    (!soundPassActive || soundWorkflowReady) &&
    videoWorkflowReadyForTarget &&
    runpodTargetReady &&
    runpodConnected;

  const updateParams = useCallback(
    (update: Partial<VideoGenerationParams>) => {
      setParams((current) => ({ ...current, ...update }));
    },
    [setParams]
  );

  // Pick up a reference image handed off from the Image Generation gallery
  // ("비디오 생성" button in the detail modal) and preload it as the start image.
  useEffect(() => {
    const handoff = takeVideoReference();
    if (!handoff) return;
    setParams((current) => ({ ...current, source_image: handoff.url }));
    setEditorOpen(true);
  }, [setParams]);

  // Read the reference image's natural dimensions so resize-driven pipelines can
  // preview the expected output size.
  useEffect(() => {
    const src = params.source_image;
    if (!src) {
      setReferenceSize(null);
      return;
    }

    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (cancelled) return;
      setReferenceSize({
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    };
    image.onerror = () => {
      if (!cancelled) setReferenceSize(null);
    };
    image.src = src;

    return () => {
      cancelled = true;
    };
  }, [params.source_image]);

  const settingsForPipeline = useCallback(
    (pipeline: VideoPipelineOption | undefined, current: VideoGenerationParams) => ({
      ...(pipeline?.defaults ?? {}),
      ...(current.video_pipeline === pipeline?.id ? current.video_pipeline_settings : {}),
    }),
    []
  );


  const resetRunpodConnection = useCallback(() => {
    autoRunpodCheckKeyRef.current = "";
    setRunpodStatus("");
    setRunpodConnection({
      checked: false,
      comfyReachable: false,
      comfyInitializing: false,
      helperReachable: false,
      helperInitializing: false,
      helperOutdated: false,
      comfyError: "",
      helperError: "",
      comfyVersion: "",
      podDesiredStatus: "",
    });
  }, []);

  // Query every configured video pod's RunPod desiredStatus in one call and
  // remember which ids are RUNNING (used to flag the dropdown and auto-select).
  const refreshRunpodRunning = useCallback(async () => {
    try {
      const response = await fetch("/api/runpod/pods/running?kind=video", {
        cache: "no-store",
      });
      const data = await response.json();
      const pods = Array.isArray(data.pods)
        ? (data.pods as Array<{ id: string; running: boolean }>)
        : [];
      setRunpodRunningIds(new Set(pods.filter((pod) => pod.running).map((pod) => pod.id)));
      return pods;
    } catch {
      return [] as Array<{ id: string; running: boolean }>;
    }
  }, []);

  // When RunPod mode is turned on, pick the first RUNNING pod in the list. If
  // several are running the topmost wins; if none are running, say so and leave
  // the current selection alone.
  const autoSelectRunningRunpodPod = useCallback(async () => {
    const pods = await refreshRunpodRunning();
    const runningIds = new Set(pods.filter((pod) => pod.running).map((pod) => pod.id));
    const runningPods = runpodPods.filter((pod) => runningIds.has(pod.id));

    if (runningPods.length === 0) {
      setRunpodStatus(
        language === "ko"
          ? "실행 중인 pod가 없습니다. RunPod 콘솔에서 pod를 시작한 뒤 '상태 다시 확인'을 눌러주세요."
          : "No running pod found. Start one in the RunPod console, then press “Recheck status”."
      );
      return;
    }

    // Keep the current/remembered pod whenever it is still running — pods differ
    // in installed custom nodes and models, so hopping to another running pod
    // silently breaks pipelines (e.g. DaSiWa nodes only exist on the ltx25 pod).
    // Auto-select exists only to move the selection off a stopped pod.
    const savedPodId = (() => {
      try {
        return window.localStorage.getItem(VIDEO_SELECTED_RUNPOD_POD_KEY) ?? "";
      } catch {
        return "";
      }
    })();
    const preferred =
      runningPods.find((pod) => pod.id === selectedRunpodPodId) ??
      runningPods.find((pod) => pod.id === savedPodId);
    if (preferred) {
      setSelectedRunpodPodId(preferred.id);
      rememberVideoRunpodPod(preferred.id);
      return;
    }

    const [first] = runningPods;
    setSelectedRunpodPodId(first.id);
    rememberVideoRunpodPod(first.id);
    setRunpodStatus(
      language === "ko"
        ? runningPods.length > 1
          ? `실행 중인 pod ${runningPods.length}개 중 첫 번째(${first.label || first.podId || first.id})를 선택했습니다.`
          : `실행 중인 pod(${first.label || first.podId || first.id})를 선택했습니다.`
        : runningPods.length > 1
          ? `Selected the first of ${runningPods.length} running pods (${first.label || first.podId || first.id}).`
          : `Selected the running pod (${first.label || first.podId || first.id}).`
    );
  }, [language, refreshRunpodRunning, runpodPods, selectedRunpodPodId]);

  const selectGenerationTarget = useCallback(
    (target: "local" | "runpod") => {
      setGenerationTarget(target);
      try {
        window.localStorage.setItem(VIDEO_GENERATION_TARGET_KEY, target);
      } catch {}
      resetRunpodConnection();
      if (target === "local") {
        // Leaving RunPod mode arms the auto-select again for the next time it is
        // turned on (see the effect below).
        autoPodSelectRef.current = false;
      }
    },
    [resetRunpodConnection]
  );

  // Pick a running pod whenever RunPod mode is active — both when the user flips
  // the toggle and when the mode is restored from a previous visit — so the
  // selection is never left pointing at a stopped pod. Runs once per switch into
  // RunPod mode; a manual pick from the dropdown is not overridden.
  useEffect(() => {
    if (generationTarget !== "runpod" || runpodPods.length === 0) return;
    if (autoPodSelectRef.current) return;
    autoPodSelectRef.current = true;
    void autoSelectRunningRunpodPod();
  }, [autoSelectRunningRunpodPod, generationTarget, runpodPods]);

  const applyRunpodStatus = useCallback(
    (data: Record<string, unknown>) => {
      const comfyReachable = Boolean(data.comfyReachable);
      const helperReachable = Boolean(data.helperReachable);
      const comfyInitializing = !comfyReachable && Boolean(data.comfyInitializing);
      const helperInitializing = !helperReachable && Boolean(data.helperInitializing);
      const comfyError = String(data.comfyError || "");
      const helperError = String(data.helperError || "");

      const status: RunpodConnectionStatus = {
        checked: true,
        comfyReachable,
        comfyInitializing,
        helperReachable,
        helperInitializing,
        helperOutdated: helperReachable && Boolean(data.helperOutdated),
        comfyError,
        helperError,
        comfyVersion: String(data.comfyVersion || ""),
        podDesiredStatus: String(data.podDesiredStatus || ""),
      };
      setRunpodConnection(status);
      if (selectedRunpodPodId) {
        setRunpodConnectionCache(selectedRunpodPodId, status);
      }

      const serviceLine = (
        reachable: boolean,
        initializing: boolean,
        okLabel: string,
        name: string,
        detail: string
      ) => {
        if (reachable) return okLabel;
        const suffix = detail ? `: ${detail}` : "";
        if (initializing) {
          return language === "ko"
            ? `${name} 초기화 중${suffix}`
            : `${name} initializing${suffix}`;
        }
        return language === "ko"
          ? `${name} 미연결${suffix}`
          : `${name} unreachable${suffix}`;
      };

      setRunpodStatus(
        [
          data.podDesiredStatus
            ? `RunPod ${String(data.podDesiredStatus).toLowerCase()}`
            : "",
          data.startRequested
            ? language === "ko"
              ? "RunPod 시작 요청됨"
              : "RunPod start requested"
            : "",
          data.startError
            ? language === "ko"
              ? `시작 요청 실패: ${data.startError}`
              : `Start failed: ${data.startError}`
            : "",
          data.setupError
            ? language === "ko"
              ? `Helper 설치 실패: ${data.setupError}`
              : `Helper setup failed: ${data.setupError}`
            : "",
          data.portExposeError
            ? language === "ko"
              ? `포트 노출 실패: ${data.portExposeError}`
              : `Port expose failed: ${data.portExposeError}`
            : "",
          serviceLine(comfyReachable, comfyInitializing, "ComfyUI OK", "ComfyUI", comfyError),
          serviceLine(helperReachable, helperInitializing, "Helper OK", "Helper", helperError),
          Array.isArray(data.runtimePorts) && data.runtimePorts.length > 0
            ? `ports ${data.runtimePorts.length}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      );
    },
    [language, selectedRunpodPodId, setRunpodConnectionCache]
  );

  // Seed the connection status from the module-level cache when (re)mounting or
  // switching pods, so returning to the page shows the last-known state right
  // away instead of flashing to "unchecked" while the poller re-runs.
  useEffect(() => {
    if (!selectedRunpodPodId) return;
    const cached =
      useRunpodDownloadStore.getState().connectionByPod[selectedRunpodPodId];
    if (cached) {
      setRunpodConnection(cached);
    }
  }, [selectedRunpodPodId]);

  // Read-only status check (no start / port / helper side effects). The app must
  // never start or manipulate the pod here — it only queries its current state.
  const checkRunpodConnection = useCallback(async () => {
    if (!selectedRunpodPodId || runpodBusy) return;

    setRunpodBusy(true);
    setRunpodStatus("");
    try {
      void refreshRunpodRunning();
      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/status?auto=1`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "RunPod status failed.");
      }
      applyRunpodStatus(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to check RunPod.";
      setRunpodConnection({
        checked: true,
        comfyReachable: false,
        comfyInitializing: false,
        helperReachable: false,
        helperInitializing: false,
        helperOutdated: false,
        comfyError: message,
        helperError: "",
        comfyVersion: "",
        podDesiredStatus: "",
      });
      setRunpodStatus(message);
    } finally {
      setRunpodBusy(false);
    }
  }, [applyRunpodStatus, refreshRunpodRunning, runpodBusy, selectedRunpodPodId]);

  // Lightweight status refresh (no ensure/start/setup side effects) used for polling
  // while ComfyUI/helper are still booting, so the badges flip to OK on their own.
  const refreshRunpodStatus = useCallback(async () => {
    if (!selectedRunpodPodId) return;
    try {
      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/status?auto=1`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) return;
      applyRunpodStatus(data);
    } catch {
      // Keep the last known status; the next poll will retry.
    }
  }, [applyRunpodStatus, selectedRunpodPodId]);

  useEffect(() => {
    if (generationTarget !== "runpod" || !selectedRunpodPodId || isGenerating) return;
    const key = `${generationTarget}:${selectedRunpodPodId}`;
    if (autoRunpodCheckKeyRef.current === key) return;
    autoRunpodCheckKeyRef.current = key;
    void refreshRunpodStatus();
    void refreshRunpodRunning();
  }, [
    generationTarget,
    isGenerating,
    refreshRunpodRunning,
    refreshRunpodStatus,
    selectedRunpodPodId,
  ]);

  // Keep the latest connection snapshot in a ref so the polling interval below can
  // read it without being torn down and recreated on every status change.
  useEffect(() => {
    runpodConnectionRef.current = runpodConnection;
  }, [runpodConnection]);

  // Live read-only polling: while RunPod is the target and a pod is selected, poll
  // status every 5s until BOTH ComfyUI and the helper are reachable. This catches
  // the pod being started in the RunPod console and its ports finishing
  // initialization in real time. The poll only ever queries status (auto=1) and
  // never starts or mutates the pod. The interval is keyed on stable inputs (not
  // the status values) so it does not stop when consecutive polls return the same
  // "still initializing" state.
  useEffect(() => {
    if (generationTarget !== "runpod" || !selectedRunpodPodId || isGenerating) {
      return;
    }
    const interval = setInterval(() => {
      // A manual "Recheck status" is already in flight, or everything is
      // connected — skip this tick.
      if (runpodBusy) return;
      const current = runpodConnectionRef.current;
      if (current?.comfyReachable && current?.helperReachable) return;
      void refreshRunpodStatus();
    }, 5_000);
    return () => clearInterval(interval);
  }, [generationTarget, isGenerating, refreshRunpodStatus, runpodBusy, selectedRunpodPodId]);

  const setupRunpodHelper = useCallback(async () => {
    if (!selectedRunpodPodId || runpodSetupBusy || isGenerating) return;

    setRunpodSetupBusy(true);
    setRunpodStatus(language === "ko" ? "Helper 연결을 준비하는 중..." : "Setting up helper...");
    try {
      const response = await fetch(`/api/runpod/pods/${selectedRunpodPodId}/setup`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "RunPod helper setup failed.");
      }
      setRunpodStatus(
        language === "ko"
          ? "Helper 시작 요청을 보냈습니다. 잠시 후 상태를 다시 확인합니다."
          : "Helper start requested. Rechecking status shortly."
      );
      window.setTimeout(() => {
        void checkRunpodConnection();
      }, 1500);
    } catch (error) {
      setRunpodStatus(
        error instanceof Error ? error.message : "RunPod helper setup failed."
      );
    } finally {
      setRunpodSetupBusy(false);
    }
  }, [
    checkRunpodConnection,
    isGenerating,
    language,
    runpodSetupBusy,
    selectedRunpodPodId,
  ]);

  // Resolve the selected pipeline's required models (checkpoint, unet, vae, text
  // encoder, upscaler, distilled LoRA + the whole LoRA stack) from the model
  // catalog and download them onto the selected pod. The helper skips files that
  // already exist, so re-running is a safe no-op for anything already present.
  const downloadPipelineModels = useCallback(async () => {
    const pipelineId = params.video_pipeline || params.video_model;
    // A background download no longer blocks this: fresh models are appended to
    // the pod's running download queue, so the user can keep adding models.
    if (!selectedRunpodPodId || !pipelineId || pipelineModelsBusy) {
      return;
    }

    setPipelineModelsBusy(true);
    setPipelineModelsStatus(
      language === "ko" ? "필요 모델 목록을 확인하는 중..." : "Resolving required models..."
    );
    try {
      const response = await fetch(
        `/api/video/pipelines/${encodeURIComponent(pipelineId)}/models`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as {
        error?: string;
        total?: number;
        models?: Array<{
          path: string;
          hasUrl: boolean;
          resource: RunpodDownloadItem["resource"];
        }>;
        missingSource?: string[];
      };
      if (!response.ok) {
        throw new Error(data.error || "Failed to resolve pipeline models.");
      }

      const items: RunpodDownloadItem[] = (data.models ?? [])
        .filter((model) => model.hasUrl)
        .map((model) => ({ path: model.path, resource: model.resource }));

      if (items.length === 0) {
        setPipelineModelsStatus(
          language === "ko"
            ? "다운로드할 수 있는 모델 URL이 없습니다."
            : "No downloadable model URLs were found."
        );
        return;
      }

      const missing = data.missingSource ?? [];
      const missingNote =
        missing.length > 0
          ? language === "ko"
            ? ` (URL 미확보 ${missing.length}개는 수동 필요: ${missing
                .map((path) => path.split("/").pop())
                .join(", ")})`
            : ` (${missing.length} without a source must be added manually: ${missing
                .map((path) => path.split("/").pop())
                .join(", ")})`
          : "";
      setPipelineModelsStatus(
        (language === "ko"
          ? `${items.length}개 모델 다운로드를 시작합니다.`
          : `Starting download of ${items.length} model(s).`) + missingNote
      );

      await startPodModelDownload(selectedRunpodPodId, items, {
        ko: language === "ko",
      });
    } catch (error) {
      setPipelineModelsStatus(
        error instanceof Error ? error.message : "Failed to download pipeline models."
      );
    } finally {
      setPipelineModelsBusy(false);
    }
  }, [
    language,
    params.video_model,
    params.video_pipeline,
    pipelineModelsBusy,
    selectedRunpodPodId,
    startPodModelDownload,
  ]);

  // Detect which custom-node packs the selected pipeline needs (via the pod's
  // live /object_info) and install the missing ones onto the pod through the
  // helper (git clone + pip + ComfyUI restart), streaming progress.
  // Probe whether the censor prerequisites (NudeNet node + detector model) are
  // present on the currently selected target. Local and RunPod each have their own
  // status route; the result drives the install prompt in the censor section.
  const censorEnabled = params.censor?.enabled ?? false;
  const checkCensorSetup = useCallback(async () => {
    // Nothing to set up while off, or before a RunPod target has a pod chosen.
    if (!censorEnabled) {
      setCensorSetup(null);
      return;
    }
    const url =
      generationTarget === "runpod"
        ? selectedRunpodPodId
          ? `/api/runpod/pods/${selectedRunpodPodId}/censor-status`
          : ""
        : "/api/comfyui/censor-status";
    if (!url) {
      setCensorSetup(null);
      return;
    }
    setCensorSetupChecking(true);
    try {
      const res = await fetch(url, { cache: "no-store" });
      const data = (await res.json()) as CensorSetupStatus & { error?: string };
      setCensorSetup(res.ok ? data : null);
    } catch {
      setCensorSetup(null);
    } finally {
      setCensorSetupChecking(false);
    }
  }, [censorEnabled, generationTarget, selectedRunpodPodId]);

  // Re-check whenever censoring is toggled on or the target/pod changes. All state
  // updates live inside the async callback so the effect body stays side-effect free.
  useEffect(() => {
    void checkCensorSetup();
  }, [checkCensorSetup]);

  // Install the censor assets onto the active target, scoped to the mode: the local
  // route spawns setup-comfyui-censor.sh, the RunPod route installs nodes + fetches
  // the detector via the pod helper. Streams SSE progress, then re-checks status.
  const installCensor = useCallback(
    async (target: "local" | "runpod") => {
      if (censorInstall.running) return;
      const ko = language === "ko";
      if (target === "runpod" && !selectedRunpodPodId) return;
      const url =
        target === "runpod"
          ? `/api/runpod/pods/${selectedRunpodPodId}/censor/install/stream`
          : "/api/comfyui/censor/install/stream";

      setCensorInstall({ running: true, message: ko ? "설치 시작..." : "Starting install..." });
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Install failed.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError = "";
        const handle = (raw: string) => {
          if (!raw.startsWith("data:")) return;
          const event = JSON.parse(raw.slice(5).trim()) as {
            type?: string;
            message?: string;
          };
          if (event.type === "error") {
            streamError = event.message || "Install failed.";
          } else if (event.message) {
            setCensorInstall({ running: true, message: event.message });
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) handle(line);
        }
        if (buffer) handle(buffer);
        if (streamError) throw new Error(streamError);

        setCensorInstall({
          running: false,
          message: ko ? "설치 완료. 상태를 다시 확인합니다..." : "Installed. Rechecking...",
        });
        await checkCensorSetup();
      } catch (error) {
        setCensorInstall({
          running: false,
          message: error instanceof Error ? error.message : "Install failed.",
        });
      }
    },
    [censorInstall.running, language, selectedRunpodPodId, checkCensorSetup]
  );

  const installPipelineNodes = useCallback(async () => {
    const pipelineId = params.video_pipeline || params.video_model;
    if (!selectedRunpodPodId || !pipelineId || nodeInstallBusy) return;

    const ko = language === "ko";
    setNodeInstallBusy(true);
    setNodeInstallStatus(ko ? "누락된 커스텀 노드를 확인하는 중..." : "Checking for missing custom nodes...");
    try {
      const res = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/nodes?pipeline=${encodeURIComponent(pipelineId)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as {
        error?: string;
        packs?: Array<{ name: string; url: string }>;
        unmappedClassTypes?: string[];
        detected?: boolean;
        comfyReachable?: boolean;
      };
      if (!res.ok) throw new Error(data.error || "Failed to resolve pipeline nodes.");

      const packs = data.packs ?? [];
      const unmapped = data.unmappedClassTypes ?? [];
      const unmappedNote =
        unmapped.length > 0
          ? ko
            ? ` (수동 확인 필요: ${unmapped.join(", ")})`
            : ` (resolve manually: ${unmapped.join(", ")})`
          : "";

      if (packs.length === 0) {
        setNodeInstallStatus(
          (data.comfyReachable
            ? ko
              ? "필요한 커스텀 노드가 모두 설치되어 있습니다."
              : "All required custom nodes are already installed."
            : ko
              ? "ComfyUI에 연결할 수 없어 설치 상태를 확인하지 못했습니다."
              : "Could not reach ComfyUI to verify installed nodes.") + unmappedNote
        );
        return;
      }

      setNodeInstallStatus(
        (ko
          ? `${packs.length}개 노드 팩 설치 중... (pip 포함, 수 분 소요)`
          : `Installing ${packs.length} node pack(s)... (incl. pip, may take minutes)`) +
          unmappedNote
      );

      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/install-nodes/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repos: packs }),
        }
      );
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Node install failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      const handle = (raw: string) => {
        if (!raw.startsWith("data:")) return;
        const event = JSON.parse(raw.slice(5).trim()) as {
          type?: string;
          name?: string;
          status?: string;
          message?: string;
          installed?: string[];
        };
        if (event.type === "error") streamError = event.message || "Node install failed.";
        if (event.type === "repo" && event.name) {
          setNodeInstallStatus(
            ko
              ? `${event.name}: ${event.status}`
              : `${event.name}: ${event.status}`
          );
        }
        if (event.type === "complete") {
          const n = event.installed?.length ?? 0;
          setNodeInstallStatus(
            ko
              ? `설치 완료 (${n}개). ComfyUI를 재시작했습니다. 잠시 후 '상태 다시 확인'을 눌러주세요.`
              : `Installed ${n} pack(s). ComfyUI restarted — press “Recheck status” shortly.`
          );
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine) handle(dataLine);
        }
      }
      if (buffer) {
        const dataLine = buffer.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) handle(dataLine);
      }
      if (streamError) throw new Error(streamError);
    } catch (error) {
      setNodeInstallStatus(
        error instanceof Error ? error.message : "Failed to install custom nodes."
      );
    } finally {
      setNodeInstallBusy(false);
    }
  }, [language, nodeInstallBusy, params.video_model, params.video_pipeline, selectedRunpodPodId]);

  const removePendingVideo = useCallback(
    (video: GeneratedVideo) => removePendingVideoById(video.id),
    [removePendingVideoById]
  );

  const reuseVideoParams = useCallback(
    (video: GeneratedVideo) => {
      if (!video.params) return;
      setParams({ ...DEFAULT_VIDEO_PARAMS, ...video.params });
    },
    [setParams]
  );

  const importCivitaiMetadata = useCallback(async () => {
    if (!civitaiUrl.trim() || isImportingCivitai) return;

    setIsImportingCivitai(true);
    setCivitaiStatus("Fetching Civitai metadata...");
    setMissingCivitaiResources([]);

    try {
      const [response, modelsResponse] = await Promise.all([
        fetch("/api/civitai/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: civitaiUrl }),
        }),
        fetch("/api/models", { cache: "no-store" }),
      ]);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import Civitai metadata");
      }

      const imported = data as CivitaiImportResult;
      const modelsData = (await modelsResponse.json()) as LocalModelsResponse;
      const mapped = mapCivitaiParamsToVideoParams(imported);
      const missing = findMissingCivitaiResources(imported, modelsData);

      updateParams(mapped);
      setMissingCivitaiResources(missing);
      setCivitaiStatus(
        [
          imported.metadataHidden
            ? "Imported available media and size. Prompt metadata is hidden."
            : "Imported prompt, size, seed, and start image.",
          missing.length > 0
            ? `${missing.length} local resource${missing.length > 1 ? "s are" : " is"} missing.`
            : "Required resources are available locally.",
        ].join(" ")
      );
    } catch (error) {
      setCivitaiStatus(
        error instanceof Error ? error.message : "Failed to import Civitai metadata"
      );
    } finally {
      setIsImportingCivitai(false);
    }
  }, [civitaiUrl, isImportingCivitai, updateParams]);

  const refreshVideos = useCallback(() => {
    fetch("/api/videos")
      .then((res) => res.json())
      .then((data) => {
        setVideos(data.videos ?? []);
      })
      .catch(() => {});
  }, [setVideos]);

  // The workspace chips are the image gallery's workspaces; here they filter the
  // clips only — a workspace's images never appear on this screen.
  const activeWorkspaceId = useMediaWorkspaceStore(
    (state) => state.byMedia.videos.activeWorkspaceId
  );

  const applyVideoWorkspaces = useCallback(
    (video: GeneratedVideo, workspaces: string[]) => {
      setVideos((prev) =>
        prev.map((item) =>
          item.filename === video.filename ? { ...item, workspaces } : item
        )
      );
    },
    [setVideos]
  );

  const deleteVideo = useCallback(async (video: GeneratedVideo) => {
    const response = await fetch(
      "/api/videos/" + encodeURIComponent(video.filename),
      { method: "DELETE" }
    );
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      throw new Error(data?.error || "Failed to delete video.");
    }
    setVideos((current) => current.filter((item) => item.id !== video.id));
  }, [setVideos]);

  useEffect(() => {
    refreshVideos();
  }, [refreshVideos]);

  // Restore the persisted generation target after mount (kept out of the initial
  // render to avoid a hydration mismatch, matching the image page).
  useEffect(() => {
    try {
      if (window.localStorage.getItem(VIDEO_GENERATION_TARGET_KEY) === "runpod") {
        setGenerationTarget("runpod");
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const pods = (
          Array.isArray(data.runpodPods)
            ? (data.runpodPods as RunpodPodOption[])
            : []
        ).filter((pod) => pod.kind === "video");
        setRunpodPods(pods);
        setSelectedRunpodPodId((current) => {
          const savedPodId = (() => {
            try {
              return window.localStorage.getItem(VIDEO_SELECTED_RUNPOD_POD_KEY) ?? "";
            } catch {
              return "";
            }
          })();
          const podExists = (id: string) => pods.some((pod) => pod.id === id);
          const next =
            current && podExists(current)
              ? current
              : savedPodId && podExists(savedPodId)
                ? savedPodId
                : pods[0]?.id || "";

          rememberVideoRunpodPod(next);
          return next;
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/video/pipelines", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const pipelines = Array.isArray(data.pipelines)
          ? (data.pipelines as VideoPipelineOption[])
          : [];
        setVideoPipelines(pipelines);
        setParams((current) =>
          current.video_pipeline
            ? {
                ...current,
                video_pipeline_settings: {
                  ...(pipelines.find((pipeline) => pipeline.id === current.video_pipeline)
                    ?.defaults ?? {}),
                  ...(current.video_pipeline_settings ?? {}),
                },
              }
            : {
                ...current,
                video_pipeline: pipelines[0]?.id || current.video_model,
                video_pipeline_settings: pipelines[0]?.defaults ?? {},
              }
        );
      })
      .catch(() => {});
  }, [setParams]);

  // One-time restore of the sessionStorage progress snapshot after a full
  // reload (a no-op while the queue store is already live). The store snapshots
  // itself on every change, so no matching write effect is needed here.
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      useVideoGenerationQueueStore.getState().restoreStoredState();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    fetch("/api/video/config")
      .then((res) => res.json())
      .then((data) => {
        setVideoConfig({
          configured: Boolean(data.configured),
          exists: Boolean(data.exists),
          ready: data.ready !== false,
          missing: Array.isArray(data.missing) ? data.missing.map(String) : [],
          requiresSourceImage: data.requiresSourceImage !== false,
          includesAudio: Boolean(data.includesAudio),
          message: String(data.message ?? ""),
          audio: {
            configured: Boolean(data.audio?.configured),
            exists: Boolean(data.audio?.exists),
            ready: data.audio?.ready === true,
            missing: Array.isArray(data.audio?.missing)
              ? data.audio.missing.map(String)
              : [],
            message: String(data.audio?.message ?? ""),
          },
        });
      })
      .catch(() => {
        setVideoConfig({
          configured: false,
          exists: false,
          ready: false,
          missing: [],
          message: "Video generation configuration could not be checked.",
          audio: {
            configured: false,
            exists: false,
            ready: false,
            missing: [],
            message: "Sound generation configuration could not be checked.",
          },
        });
      });
  }, []);

  const durationLabel = useMemo(() => {
    const seconds = params.fps > 0 ? params.num_frames / params.fps : 0;
    const secondsLabel = seconds > 0 ? ` ≈ ${seconds.toFixed(1)}초` : "";
    return language === "ko"
      ? `${params.num_frames} frames · ${params.fps} fps${secondsLabel}`
      : `${params.num_frames} frames at ${params.fps} fps${
          seconds > 0 ? ` ≈ ${seconds.toFixed(1)}s` : ""
        }`;
  }, [language, params.fps, params.num_frames]);

  // For pipelines whose length/fps live in the Pipeline controls (LTX / 10Eros
  // use NO_CANVAS_SUPPORT), derive the real clip duration from those settings so
  // the user sees seconds next to "Length" and "Base FPS".
  const pipelineDuration = useMemo(() => {
    const controls = selectedVideoPipeline?.controls ?? [];
    const lengthControl = controls.find((control) => control.key === "length");
    const fpsControl = controls.find((control) => control.key === "frame_rate");
    if (!lengthControl || !fpsControl) return null;

    const settings = params.video_pipeline_settings ?? {};
    const frames = Number(settings.length ?? lengthControl.defaultValue);
    const fps = Number(settings.frame_rate ?? fpsControl.defaultValue);
    if (!Number.isFinite(frames) || !Number.isFinite(fps) || fps <= 0) {
      return null;
    }
    return { frames, fps, seconds: frames / fps };
  }, [selectedVideoPipeline, params.video_pipeline_settings]);

  // Resize-driven pipelines (10Eros / LTX) fit the reference image to a target
  // "Longer Side", preserving its aspect ratio. Estimate the resulting output
  // resolution so the user can see the width×height instead of guessing.
  const estimatedOutputSize = useMemo(() => {
    const controls = selectedVideoPipeline?.controls ?? [];
    const longerSideControl = controls.find(
      (control) => control.key === "longer_size"
    );
    if (!longerSideControl || !referenceSize) return null;
    if (referenceSize.width <= 0 || referenceSize.height <= 0) return null;

    const settings = params.video_pipeline_settings ?? {};
    const longerSide = Number(
      settings.longer_size ?? longerSideControl.defaultValue
    );
    if (!Number.isFinite(longerSide) || longerSide <= 0) return null;

    const long = Math.max(referenceSize.width, referenceSize.height);
    const short = Math.min(referenceSize.width, referenceSize.height);
    // LTX-family workflows expect dimensions on a 32px grid.
    const snap = (value: number) => Math.max(32, Math.round(value / 32) * 32);
    const outLong = snap(longerSide);
    const outShort = snap((short / long) * longerSide);
    const landscape = referenceSize.width >= referenceSize.height;

    return {
      longerSide,
      width: landscape ? outLong : outShort,
      height: landscape ? outShort : outLong,
    };
  }, [selectedVideoPipeline, referenceSize, params.video_pipeline_settings]);

  // The queue itself, its pump, and the SSE runner live in the module-level
  // queue store so a Paimon situation batch keeps generating after this page
  // unmounts. The page publishes its target/validation context so a background
  // enqueue still knows where to generate and what to pre-check.
  useEffect(() => {
    useVideoGenerationQueueStore.getState().setConfig({
      generationTarget,
      runpodPodId: selectedRunpodPodId,
      runpodReady: Boolean(selectedRunpodPod?.comfyUrl),
      requiresSourceImage: videoRequiresSourceImage,
      workflowReady: videoWorkflowReadyForTarget,
      workflowMessage: videoConfig.message,
      soundWorkflowReady,
      soundMessage: videoConfig.audio.message,
      includesAudio: videoIncludesAudio,
      ko: language === "ko",
    });
  }, [
    generationTarget,
    language,
    selectedRunpodPod?.comfyUrl,
    selectedRunpodPodId,
    soundWorkflowReady,
    videoConfig.audio.message,
    videoConfig.message,
    videoIncludesAudio,
    videoRequiresSourceImage,
    videoWorkflowReadyForTarget,
  ]);

  // `override` lets a caller queue params it just wrote to the store without
  // waiting for this component to re-render with them (the Paimon situation
  // runner composes a prompt and queues it in the same tick).
  const generate = useCallback((override?: VideoGenerationParams) => {
    useVideoGenerationQueueStore.getState().enqueue(override);
  }, []);

  const cancelGeneration = useCallback((videoId?: string) => {
    useVideoGenerationQueueStore.getState().cancel(videoId);
  }, []);

  // --- Paimon character-situation runs -------------------------------------
  // A saved situation becomes a clip: its image is installed as the start frame,
  // Paimon writes the motion/expression/camera prompt for the requested length,
  // and (with 자동 생성 on) the clip is queued through the module-scope queue
  // store, so the batch keeps generating after this page unmounts.
  const situationBatch = useVideoSituationStore((state) => state.batch);
  // A turn in flight disables the picker, so a pick can't interleave with it.
  const paimonLoading = useVideoPaimonStore(
    (state) => state.conversations[DEFAULT_CONVERSATION]?.loading ?? false
  );
  const cancelSituationBatch = useVideoSituationStore(
    (state) => state.cancelBatch
  );

  // The clip length the current settings produce — the picker's seconds field
  // starts here, whichever pair of fields this pipeline takes its length from.
  const situationSeconds = useMemo(() => {
    const seconds = videoDurationSeconds(selectedVideoPipeline, params);
    return seconds > 0 ? Math.max(1, Math.round(seconds)) : 5;
  }, [params, selectedVideoPipeline]);

  const runSituation = useCallback((request: SituationRunRequest) => {
    const store = useVideoSituationStore.getState();
    const options = {
      seconds: request.seconds,
      autoGenerate: request.autoGenerate,
      imageBySituation: request.imageBySituation,
    };

    if (request.situations.length > 1) {
      void store.runBatch(request.character, request.situations, options);
    } else {
      void store.compose(
        request.character,
        request.situations[0] ?? null,
        options
      );
    }
    setPaimonOpen(true);
  }, []);

  // Show in-flight generation cards ahead of the saved videos, newest first.
  // A generation still running has no workspace yet, so it stays visible under
  // every filter rather than vanishing the moment a chip is selected.
  const visibleVideos = useMemo(() => {
    const saved = videos.filter((video) =>
      fileMatchesWorkspace(video.workspaces, activeWorkspaceId)
    );
    if (pendingVideos.length === 0) return saved;
    const pendingIds = new Set(pendingVideos.map((video) => video.id));
    const rest = saved.filter((video) => !pendingIds.has(video.id));
    return [...pendingVideos, ...rest].sort((a, b) => b.timestamp - a.timestamp);
  }, [activeWorkspaceId, pendingVideos, videos]);

  // Only finished videos (with a playable URL) participate in the detail modal
  // and its prev/next navigation.
  const detailVideos = useMemo(
    () => visibleVideos.filter((video) => video.url),
    [visibleVideos]
  );
  // A stale id simply resolves to null and the modal stops rendering; no cleanup
  // effect is needed when the open video disappears (deleted / list refresh).
  const selectedVideo = useMemo(
    () => detailVideos.find((video) => video.id === selectedVideoId) ?? null,
    [detailVideos, selectedVideoId]
  );

  return (
    <>
    <div ref={layoutRef} className="flex h-screen bg-background">
      <AppSidebar />

      {editorOpen && (
        <aside
          className="flex shrink-0 flex-col overflow-hidden"
          style={{ width: editorWidth }}
        >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Video Generation</h1>
            <p className="text-xs text-muted-foreground">
              {generationTarget === "runpod"
                ? selectedRunpodPod?.label || selectedRunpodPod?.podId || "RunPod ComfyUI"
                : "Local ComfyUI video workflow"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-card/80 p-1">
              {[
                { value: "local" as const, label: language === "ko" ? "로컬" : "Local" },
                { value: "runpod" as const, label: "RunPod" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => selectGenerationTarget(item.value)}
                  disabled={isGenerating}
                  className={`h-7 rounded px-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                    generationTarget === item.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {generationTarget === "runpod" && (
              <select
                value={selectedRunpodPodId}
                onChange={(event) => {
                  setSelectedRunpodPodId(event.target.value);
                  rememberVideoRunpodPod(event.target.value);
                  resetRunpodConnection();
                }}
                disabled={isGenerating}
                className="h-9 max-w-44 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="RunPod target"
              >
                {runpodPods.length === 0 ? (
                  <option value="">{language === "ko" ? "Pod 없음" : "No pod"}</option>
                ) : (
                  runpodPods.map((pod) => (
                    <option key={pod.id} value={pod.id}>
                      {(runpodRunningIds.has(pod.id) ? "🟢 " : "⚪ ") +
                        (pod.label || pod.podId || pod.id)}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {generationTarget === "runpod" && (
            <EditorSection
              title="RunPod"
              description={
                language === "ko"
                  ? "선택한 pod의 ComfyUI/Helper 연결 상태만 조회합니다. 앱은 pod를 시작하지 않습니다."
                  : "Reads the selected pod's ComfyUI/Helper connection status only. This app never starts the pod."
              }
            >
              <p className="flex min-w-0 items-center gap-2 truncate text-xs text-muted-foreground">
                <Server className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate">
                  {selectedRunpodPod
                    ? `${selectedRunpodPod.label || selectedRunpodPod.podId || selectedRunpodPod.id} · ${selectedRunpodPod.comfyUrl || "ComfyUI URL 없음"}`
                    : language === "ko"
                      ? "설정에서 RunPod pod를 추가하세요."
                      : "Add a RunPod pod in Settings."}
                </span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    !runpodConnection.checked
                      ? "bg-muted text-muted-foreground"
                      : runpodConnection.comfyReachable
                        ? "bg-green-500/15 text-green-600"
                        : runpodConnection.comfyInitializing
                          ? "bg-yellow-500/15 text-yellow-600"
                          : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {!runpodConnection.checked ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : runpodConnection.comfyReachable ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : runpodConnection.comfyInitializing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3 w-3" />
                  )}
                  {!runpodConnection.checked
                    ? language === "ko"
                      ? "ComfyUI 미확인"
                      : "ComfyUI unchecked"
                    : runpodConnection.comfyReachable
                      ? "ComfyUI OK"
                      : runpodConnection.comfyInitializing
                        ? language === "ko"
                          ? "ComfyUI 초기화 중"
                          : "ComfyUI initializing"
                        : "ComfyUI ?"}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                    !runpodConnection.checked
                      ? "bg-muted text-muted-foreground"
                      : runpodConnection.helperReachable
                        ? "bg-green-500/15 text-green-600"
                        : runpodConnection.helperInitializing
                          ? "bg-yellow-500/15 text-yellow-600"
                          : "bg-destructive/15 text-destructive"
                  }`}
                >
                  {!runpodConnection.checked ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : runpodConnection.helperReachable ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : runpodConnection.helperInitializing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <AlertTriangle className="h-3 w-3" />
                  )}
                  {!runpodConnection.checked
                    ? language === "ko"
                      ? "Helper 미확인"
                      : "Helper unchecked"
                    : runpodConnection.helperReachable
                      ? "Helper OK"
                      : runpodConnection.helperInitializing
                        ? language === "ko"
                          ? "Helper 초기화 중"
                          : "Helper initializing"
                        : "Helper ?"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Requirement 3: helper init only appears when the helper has a
                    problem, and only while the pod is running (the app never
                    starts the pod — the user starts it in the RunPod console). */}
                {runpodConnection.checked && runpodPodRunning && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 gap-1.5"
                    onClick={() => void setupRunpodHelper()}
                    disabled={!selectedRunpodPodId || runpodSetupBusy || isGenerating}
                    title={
                      language === "ko"
                        ? "Helper를 (재)설치합니다. 노드 설치 기능을 쓰려면 최신 Helper로 업데이트하세요."
                        : "(Re)install the helper. Update to the latest helper to use node install."
                    }
                  >
                    {runpodSetupBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wrench className="h-3.5 w-3.5" />
                    )}
                    {runpodConnection.helperReachable
                      ? language === "ko"
                        ? "Helper 업데이트"
                        : "Update helper"
                      : language === "ko"
                        ? "Helper 초기화"
                        : "Init helper"}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 flex-1 gap-1.5"
                  onClick={() => void checkRunpodConnection()}
                  disabled={!selectedRunpodPodId || runpodBusy || isGenerating}
                >
                  {runpodBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  {language === "ko" ? "상태 다시 확인" : "Recheck status"}
                </Button>
              </div>
              {runpodConnection.checked && !runpodPodRunning && (
                <p className="flex items-start gap-1.5 rounded-md bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-700 dark:text-yellow-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {language === "ko"
                    ? "Pod가 실행 중이 아닙니다. RunPod 콘솔에서 직접 pod를 시작한 뒤 '상태 다시 확인'을 눌러주세요. (앱은 pod를 시작하지 않습니다.)"
                    : "Pod is not running. Start it yourself in the RunPod console, then press “Recheck status”. (This app never starts the pod.)"}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {runpodStatus ||
                  (language === "ko"
                    ? "pod를 선택하면 상태만 조회합니다. Helper에 문제가 있으면 'Helper 초기화'로 설치할 수 있고, 모두 연결되면 파이프라인을 골라 영상을 생성할 수 있습니다."
                    : "Selecting a pod only reads its status. If the helper has a problem, use “Init helper” to set it up; once everything is connected you can pick a pipeline and generate.")}
              </p>

              <div className="grid gap-2 border-t border-border/60 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold">
                    {language === "ko" ? "커스텀 노드" : "Custom nodes"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5"
                    onClick={() => void installPipelineNodes()}
                    disabled={
                      !selectedRunpodPodId ||
                      !runpodConnection.helperReachable ||
                      nodeInstallBusy ||
                      isGenerating
                    }
                    title={
                      language === "ko"
                        ? "이 파이프라인에 필요한 누락 커스텀 노드를 pod에 설치합니다 (git + pip + 재시작)"
                        : "Install the pipeline's missing custom nodes onto the pod (git + pip + restart)"
                    }
                  >
                    {nodeInstallBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wrench className="h-3.5 w-3.5" />
                    )}
                    {language === "ko" ? "노드 설치" : "Install nodes"}
                  </Button>
                </div>
                {nodeInstallStatus && (
                  <p className="text-[11px] text-muted-foreground">{nodeInstallStatus}</p>
                )}

                <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
                  <span className="min-w-0 truncate text-xs font-semibold">
                    {language === "ko" ? "파이프라인 모델" : "Pipeline models"}
                    {selectedVideoPipeline?.label ? (
                      <span className="ml-1 font-normal text-muted-foreground">
                        · {selectedVideoPipeline.label}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 gap-1.5"
                    onClick={() => void downloadPipelineModels()}
                    disabled={
                      !selectedRunpodPodId ||
                      !runpodConnection.helperReachable ||
                      pipelineModelsBusy ||
                      isGenerating
                    }
                    title={
                      language === "ko"
                        ? "선택한 파이프라인의 모델을 이 pod로 다운로드합니다 (이미 있으면 건너뜀)"
                        : "Download this pipeline's models onto the pod (existing files are skipped)"
                    }
                  >
                    {pipelineModelsBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {language === "ko" ? "모델 다운로드" : "Download models"}
                  </Button>
                </div>
                {podDownloading ? (
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {language === "ko"
                      ? "다운로드가 백그라운드에서 진행 중입니다. "
                      : "Downloading in the background. "}
                    <Link
                      href="/downloads"
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {language === "ko" ? "다운로드 매니저에서 확인" : "Open Download Manager"}
                    </Link>
                  </p>
                ) : (
                  (podDownloadMessage || pipelineModelsStatus) && (
                    <p className="text-[11px] text-muted-foreground">
                      {podDownloadMessage || pipelineModelsStatus}
                    </p>
                  )
                )}
                {!runpodConnection.helperReachable && (
                  <p className="text-[11px] text-muted-foreground">
                    {language === "ko"
                      ? "Helper가 연결되어야 다운로드할 수 있습니다."
                      : "The helper must be connected to download."}
                  </p>
                )}
              </div>
            </EditorSection>
          )}

          <EditorSection
            title="Import from Civitai"
            description={
              language === "ko"
                ? "이미지 또는 비디오 URL을 붙여넣어 호환되는 비디오 입력값을 불러옵니다."
                : "Paste an image or video URL to load compatible video fields."
            }
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Paste an image or video URL to load compatible video fields.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <a
                  href="https://civitai.red/images"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Civitai images"
                  title="Open Civitai images"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary"
                >
                  <LinkIcon className="h-4 w-4" />
                </a>
                <CopyLinkButton
                  url="https://civitai.red/images"
                  iconClassName="h-4 w-4"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary"
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={civitaiUrl}
                onChange={(event) => setCivitaiUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void importCivitaiMetadata();
                  }
                }}
                placeholder="https://civitai.red/images/..."
                className="h-9 text-xs"
              />
              <Button
                type="button"
                onClick={importCivitaiMetadata}
                disabled={!civitaiUrl.trim() || isImportingCivitai}
                className="h-9"
              >
                {isImportingCivitai ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Importing
                  </span>
                ) : (
                  "Import"
                )}
              </Button>
            </div>

            {civitaiStatus && (
              <p className="mt-2 text-xs text-muted-foreground">{civitaiStatus}</p>
            )}

            <CivitaiMissingResources
              resources={missingCivitaiResources}
              onDownloaded={(resource) => {
                setMissingCivitaiResources((current) =>
                  current.filter(
                    (item) =>
                      item.type !== resource.type ||
                      item.modelVersionId !== resource.modelVersionId ||
                      item.name !== resource.name
                  )
                );
              }}
            />
          </EditorSection>

          <EditorSection
            title={language === "ko" ? "Pipeline" : "Pipeline"}
            description={
              language === "ko"
                ? "RunPod Video 프로젝트의 ComfyUI workflow pipeline을 선택합니다."
                : "Choose the ComfyUI workflow pipeline used by the RunPod video project."
            }
          >
            <div className="grid gap-3">
              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">
                  {language === "ko" ? "Pipeline" : "Pipeline"}
                </Label>
                <select
                  value={params.video_pipeline || params.video_model}
                  onChange={(event) => {
                    const pipeline = videoPipelines.find(
                      (item) => item.id === event.target.value
                    );
                    const nextModel: VideoGenerationParams["video_model"] =
                      event.target.value.includes("wan")
                        ? event.target.value.includes("base")
                          ? "wan-base"
                          : "wan-smoothmix"
                        : "ltx-10eros";
                    updateParams({
                      video_pipeline: event.target.value,
                      video_model: nextModel,
                      video_pipeline_settings: settingsForPipeline(pipeline, params),
                    });
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {videoPipelines.length === 0 ? (
                    <option value={params.video_pipeline || params.video_model}>
                      {language === "ko" ? "Pipeline 로딩 중" : "Loading pipelines"}
                    </option>
                  ) : (
                    videoPipelines.map((pipeline) => (
                      <option key={pipeline.id} value={pipeline.id}>
                        {pipeline.label}
                      </option>
                    ))
                  )}
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {selectedVideoPipeline
                    ? `${selectedVideoPipeline.mode.toUpperCase()} · ${selectedVideoPipeline.workflowPath}`
                    : language === "ko"
                      ? "로컬 workflows 폴더의 API workflow를 사용합니다."
                      : "Uses an API workflow from the local workflows folder."}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedVideoPipeline?.mode === "t2v"
                  ? language === "ko"
                    ? "텍스트 기반 영상 모델이며 시작 이미지가 필요하지 않습니다."
                    : "Text-to-video preset; no start image is required."
                  : language === "ko"
                    ? "이미지 기반 영상 모델이며 시작 이미지가 필요합니다."
                    : "Image-to-video preset; a start image is required."}
              </p>
            </div>

            {selectedVideoPipeline?.controls?.length ? (
              <div className="space-y-3">
                {(["core", "sampling", "conditioning", "lora", "resize", "advanced"] as const)
                  .map((group) => {
                    const controls = selectedVideoPipeline.controls.filter(
                      (control) => control.group === group
                    );
                    if (controls.length === 0) return null;
                    const groupLabel =
                      group === "core"
                        ? "Core"
                        : group === "sampling"
                          ? "Sampling"
                          : group === "conditioning"
                            ? "Conditioning"
                            : group === "lora"
                              ? "LoRA"
                              : group === "resize"
                                ? "Resize"
                                : "Advanced";

                    return (
                      <div key={group} className="space-y-2">
                        <div className="text-xs font-semibold text-foreground">
                          {groupLabel}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {controls.map((control) => {
                            const value = pipelineSettingValue(params, control);
                            const setControlValue = (
                              nextValue: string | number | boolean
                            ) => {
                              updateParams({
                                video_pipeline_settings: {
                                  ...(params.video_pipeline_settings ?? {}),
                                  [control.key]: nextValue,
                                },
                              });
                            };

                            return (
                              <div key={control.key} className="min-w-0">
                                <div className="mb-1 flex items-center gap-1">
                                  <Label className="min-w-0 truncate text-[11px] text-muted-foreground">
                                    {control.label}
                                  </Label>
                                  <SettingHelpTooltip
                                    language={language}
                                    text={pipelineControlHelp(control)}
                                  />
                                </div>
                                {control.type === "select" ? (
                                  <select
                                    value={String(value)}
                                    onChange={(event) => setControlValue(event.target.value)}
                                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    {(control.options ?? []).map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                ) : control.type === "boolean" ? (
                                  <div className="flex h-9 items-center rounded-md border border-input px-2">
                                    <Switch
                                      checked={Boolean(value)}
                                      onCheckedChange={setControlValue}
                                    />
                                  </div>
                                ) : (
                                  <Input
                                    type={control.type === "number" ? "number" : "text"}
                                    min={control.min}
                                    max={control.max}
                                    step={control.step}
                                    value={String(value)}
                                    onChange={(event) =>
                                      setControlValue(
                                        control.type === "number"
                                          ? numericValue(
                                              event.target.value,
                                              Number(control.defaultValue)
                                            )
                                          : event.target.value
                                      )
                                    }
                                    className="h-9 text-xs"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : null}

            {pipelineDuration && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {language === "ko" ? (
                    <>
                      영상 길이 ≈{" "}
                      <span className="font-semibold text-foreground">
                        {pipelineDuration.seconds.toFixed(1)}초
                      </span>{" "}
                      (Length {pipelineDuration.frames} frames ÷ Base FPS{" "}
                      {pipelineDuration.fps} fps)
                    </>
                  ) : (
                    <>
                      Clip length ≈{" "}
                      <span className="font-semibold text-foreground">
                        {pipelineDuration.seconds.toFixed(1)}s
                      </span>{" "}
                      (Length {pipelineDuration.frames} frames ÷ Base FPS{" "}
                      {pipelineDuration.fps} fps)
                    </>
                  )}
                </p>
              </div>
            )}
          </EditorSection>

          <EditorSection
            title="Prompt"
            description={
              language === "ko"
                ? "장면, 움직임, 카메라, 마지막 프레임을 한 흐름으로 작성하세요."
                : "Describe the shot, motion, camera, and ending frame as one flow."
            }
          >
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                Prompt
              </Label>
              <Textarea
                placeholder="Describe the video you want to generate..."
                value={params.prompt}
                onChange={(event) => updateParams({ prompt: event.target.value })}
                className="h-36 resize-none text-sm"
              />
            </div>

            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                Negative Prompt
              </Label>
              <Textarea
                placeholder="What to exclude..."
                value={params.negative_prompt}
                onChange={(event) =>
                  updateParams({ negative_prompt: event.target.value })
                }
                className="h-28 resize-none text-sm"
              />
            </div>
          </EditorSection>

          <EditorSection
            title="Sound"
            description={
              videoIncludesAudio
                ? language === "ko"
                  ? "선택한 파이프라인이 영상에 사운드를 함께 생성합니다."
                  : "The selected pipeline renders sound together with the video."
                : language === "ko"
                  ? "별도 오디오 workflow가 준비된 경우 영상에 맞춘 사운드를 생성합니다."
                  : "Generate synchronized sound when a separate audio workflow is configured."
            }
          >
            {videoIncludesAudio ? (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                <Volume2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {language === "ko"
                    ? "이 파이프라인은 오디오를 자체 생성해 영상에 합칩니다. 별도 설정 없이 생성된 영상에 사운드가 포함됩니다."
                    : "This pipeline generates audio on its own and muxes it into the video, so sound is included with no extra setup."}
                </p>
              </div>
            ) : (
              <>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="flex items-center gap-2 text-xs font-medium text-foreground">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                    Generate Sound
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Uses a separate ComfyUI audio workflow when configured.
                  </p>
                </div>
                <Switch
                  checked={params.enable_sound}
                  disabled={!soundWorkflowReady || isGenerating}
                  onCheckedChange={(checked) =>
                    updateParams({
                      enable_sound: Boolean(checked),
                      sound_prompt:
                        checked && !params.sound_prompt.trim()
                          ? params.prompt
                          : params.sound_prompt,
                    })
                  }
                  aria-label="Generate sound"
                />
              </div>

              {!soundWorkflowReady ? (
                <p className="mt-2 text-xs text-yellow-500">
                  {videoConfig.audio.message ||
                    "Set COMFYUI_AUDIO_WORKFLOW_PATH to enable sound generation."}
                </p>
              ) : null}

              {params.enable_sound && (
                <div className="mt-3 grid gap-3">
                  <div>
                    <Label className="mb-2 block text-xs text-muted-foreground">
                      Sound Prompt
                    </Label>
                    <Textarea
                      placeholder="Describe the soundtrack, ambience, or sound effects..."
                      value={params.sound_prompt}
                      onChange={(event) =>
                        updateParams({ sound_prompt: event.target.value })
                      }
                      className="h-24 resize-none text-sm"
                    />
                  </div>
                  <div>
                    <Label className="mb-2 block text-xs text-muted-foreground">
                      Negative Sound Prompt
                    </Label>
                    <Textarea
                      placeholder="Sounds to exclude..."
                      value={params.negative_sound_prompt}
                      onChange={(event) =>
                        updateParams({ negative_sound_prompt: event.target.value })
                      }
                      className="h-20 resize-none text-sm"
                    />
                  </div>
                  <div className="max-w-48">
                    <Label className="mb-1.5 block text-xs text-muted-foreground">
                      Sound Seconds
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={300}
                      step={0.5}
                      value={params.sound_duration_seconds}
                      onChange={(event) =>
                        updateParams({
                          sound_duration_seconds: numericValue(
                            event.target.value,
                            params.sound_duration_seconds
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              )}
              </>
            )}
          </EditorSection>

          <Separator />

          <EditorSection
            title={language === "ko" ? "검열 (자동 모자이크)" : "Censor (auto-mosaic)"}
            description={
              language === "ko"
                ? "성기 등 지정 부위를 프레임마다 자동 탐지해 모자이크/블러 처리합니다. (NudeNet)"
                : "Automatically detects and mosaics/blurs the targeted regions (e.g. genitalia) on every frame. (NudeNet)"
            }
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground" />
                  {language === "ko" ? "자동 검열" : "Auto censor"}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {language === "ko"
                    ? "생성된 영상의 프레임 배치에 검열 노드를 삽입합니다."
                    : "Splices a censor node onto the generated frame batch."}
                </p>
              </div>
              <Switch
                checked={(params.censor ?? DEFAULT_CENSOR_SETTINGS).enabled}
                disabled={isGenerating}
                onCheckedChange={(checked) =>
                  updateParams({
                    censor: {
                      ...(params.censor ?? DEFAULT_CENSOR_SETTINGS),
                      enabled: Boolean(checked),
                    },
                  })
                }
                aria-label="Auto censor"
              />
            </div>

            {(params.censor ?? DEFAULT_CENSOR_SETTINGS).enabled && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">
                    {language === "ko" ? "방식" : "Method"}
                  </Label>
                  <select
                    value={(params.censor ?? DEFAULT_CENSOR_SETTINGS).method}
                    disabled={isGenerating}
                    onChange={(event) =>
                      updateParams({
                        censor: {
                          ...(params.censor ?? DEFAULT_CENSOR_SETTINGS),
                          method: event.target.value as CensorMethod,
                        },
                      })
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="pixelate">
                      {language === "ko" ? "모자이크" : "Pixelate"}
                    </option>
                    <option value="blur">{language === "ko" ? "블러" : "Blur"}</option>
                    <option value="gaussian_blur">
                      {language === "ko" ? "가우시안 블러" : "Gaussian blur"}
                    </option>
                  </select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">
                    {language === "ko" ? "탐지 임계값" : "Min score"}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={isGenerating}
                    value={(params.censor ?? DEFAULT_CENSOR_SETTINGS).min_score}
                    onChange={(event) =>
                      updateParams({
                        censor: {
                          ...(params.censor ?? DEFAULT_CENSOR_SETTINGS),
                          min_score: numericValue(
                            event.target.value,
                            DEFAULT_CENSOR_SETTINGS.min_score
                          ),
                        },
                      })
                    }
                    className="h-9 text-xs"
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">
                    {language === "ko" ? "강도(블록)" : "Blocks"}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    disabled={isGenerating}
                    value={(params.censor ?? DEFAULT_CENSOR_SETTINGS).blocks}
                    onChange={(event) =>
                      updateParams({
                        censor: {
                          ...(params.censor ?? DEFAULT_CENSOR_SETTINGS),
                          blocks: numericValue(
                            event.target.value,
                            DEFAULT_CENSOR_SETTINGS.blocks
                          ),
                        },
                      })
                    }
                    className="h-9 text-xs"
                  />
                </div>
              </div>
            )}

            {(params.censor ?? DEFAULT_CENSOR_SETTINGS).enabled && (
              <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
                {censorSetupChecking ? (
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {language === "ko" ? "검열 구성요소 확인 중..." : "Checking censor setup..."}
                  </p>
                ) : censorSetup?.notLocal ? (
                  <p className="text-yellow-500">
                    {language === "ko"
                      ? "로컬 ComfyUI가 아닙니다. 위에서 RunPod 대상을 선택하면 설치할 수 있습니다."
                      : "Not a local ComfyUI — select a RunPod target above to install."}
                  </p>
                ) : censorSetup?.notInstalled ? (
                  <p className="text-yellow-500">
                    {language === "ko"
                      ? "로컬 ComfyUI가 설치되어 있지 않습니다. 먼저 `npm run setup:comfyui`를 실행하세요."
                      : "Local ComfyUI is not installed — run `npm run setup:comfyui` first."}
                  </p>
                ) : censorSetup && !censorSetupReady(censorSetup) ? (
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 font-medium text-yellow-500">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      {language === "ko"
                        ? `검열 구성요소가 ${generationTarget === "runpod" ? "이 pod에" : "로컬에"} 없습니다`
                        : `Censor components are missing on ${generationTarget === "runpod" ? "this pod" : "local"}`}
                    </p>
                    <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
                      <li className={censorSetup.nodesInstalled ? "text-emerald-500" : ""}>
                        {language === "ko" ? "NudeNet 노드" : "NudeNet nodes"}:{" "}
                        {censorSetup.nodesInstalled
                          ? language === "ko" ? "설치됨" : "installed"
                          : language === "ko" ? "없음" : "missing"}
                      </li>
                      <li className={censorSetup.modelPresent ? "text-emerald-500" : ""}>
                        {language === "ko" ? "탐지 모델" : "Detector model"}:{" "}
                        {censorSetup.modelPresent
                          ? language === "ko" ? "있음" : "present"
                          : language === "ko" ? "없음" : "missing"}
                      </li>
                    </ul>
                    {!censorSetup.reachable && generationTarget === "runpod" && (
                      <p className="text-[11px] text-muted-foreground">
                        {language === "ko"
                          ? "ComfyUI에 연결하지 못했습니다. 설치를 진행하면 헬퍼가 자동 복구됩니다."
                          : "Couldn't reach ComfyUI; installing will self-heal the helper."}
                      </p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => void installCensor(generationTarget)}
                      disabled={
                        censorInstall.running ||
                        isGenerating ||
                        // The install path self-heals a down helper, so only a pod
                        // must be chosen — helper reachability is not required here.
                        (generationTarget === "runpod" && !selectedRunpodPodId)
                      }
                      title={
                        language === "ko"
                          ? "NudeNet 노드와 탐지 모델을 현재 대상에 설치합니다"
                          : "Install the NudeNet node and detector model onto the current target"
                      }
                    >
                      {censorInstall.running ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Wrench className="h-3.5 w-3.5" />
                      )}
                      {generationTarget === "runpod"
                        ? language === "ko" ? "RunPod에 설치" : "Install on RunPod"
                        : language === "ko" ? "로컬에 설치" : "Install locally"}
                    </Button>
                    {censorInstall.message && (
                      <p className="break-words text-[11px] text-muted-foreground">
                        {censorInstall.message}
                      </p>
                    )}
                  </div>
                ) : censorSetup && censorSetupReady(censorSetup) ? (
                  <p className="flex items-center gap-1.5 text-emerald-500">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    {language === "ko" ? "검열 구성요소 준비됨" : "Censor components ready"}
                  </p>
                ) : null}
              </div>
            )}
          </EditorSection>

          <Separator />

          <EditorSection
            title={language === "ko" ? "참조와 캔버스" : "Reference & Canvas"}
            description={
              language === "ko"
                ? [
                    videoRequiresSourceImage
                      ? "I2V pipeline은 시작 이미지가 필요합니다."
                      : "T2V pipeline은 시작 이미지가 선택 사항입니다.",
                    showCanvasPanel
                      ? ""
                      : "해상도·길이·FPS는 아래 Pipeline 설정에서 제어합니다.",
                  ]
                    .filter(Boolean)
                    .join(" ")
                : [
                    videoRequiresSourceImage
                      ? "I2V pipelines require a start image."
                      : "A start image is optional for T2V pipelines.",
                    showCanvasPanel
                      ? ""
                      : "Resolution, length, and FPS are controlled in the Pipeline section below.",
                  ]
                    .filter(Boolean)
                    .join(" ")
            }
          >
            <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <Label className="block text-xs text-muted-foreground">
                  Reference Image
                </Label>
                <VideoReferenceImport
                  language={language}
                  onSelect={(url) => updateParams({ source_image: url })}
                />
              </div>
              <ImageUpload
                label="Start Image"
                description={
                  videoRequiresSourceImage
                    ? "Required for the configured video workflow"
                    : "Optional for text-to-video workflows"
                }
                value={params.source_image}
                onChange={(url) => updateParams({ source_image: url })}
                onPreview={
                  params.source_image
                    ? () => setStartImagePreviewOpen(true)
                    : undefined
                }
              />
            </div>

            {showCanvasPanel ? (
              <div className="space-y-3 rounded-md border border-border bg-card/80 p-3 shadow-sm">
                {canvasSupport.resolution && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="mb-1.5 block text-xs text-muted-foreground">
                        Width
                      </Label>
                      <Input
                        type="number"
                        min={256}
                        max={2048}
                        step={8}
                        value={params.width}
                        onChange={(event) =>
                          updateParams({
                            width: numericValue(event.target.value, params.width),
                          })
                        }
                      />
                    </div>
                    <div>
                      <Label className="mb-1.5 block text-xs text-muted-foreground">
                        Height
                      </Label>
                      <Input
                        type="number"
                        min={256}
                        max={2048}
                        step={8}
                        value={params.height}
                        onChange={(event) =>
                          updateParams({
                            height: numericValue(event.target.value, params.height),
                          })
                        }
                      />
                    </div>
                  </div>
                )}

                {(canvasSupport.frames || canvasSupport.fps) && (
                  <div className="grid grid-cols-2 gap-2">
                    {canvasSupport.frames && (
                      <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">
                          Frames
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={240}
                          value={params.num_frames}
                          onChange={(event) =>
                            updateParams({
                              num_frames: numericValue(
                                event.target.value,
                                params.num_frames
                              ),
                            })
                          }
                        />
                      </div>
                    )}
                    {canvasSupport.fps && (
                      <div>
                        <Label className="mb-1.5 block text-xs text-muted-foreground">
                          FPS
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          value={params.fps}
                          onChange={(event) =>
                            updateParams({
                              fps: numericValue(event.target.value, params.fps),
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                )}

                {(canvasSupport.frames || canvasSupport.fps) && (
                  <p className="text-xs text-muted-foreground">{durationLabel}</p>
                )}
              </div>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {language === "ko"
                      ? "이 파이프라인은 가로·세로 크기를 직접 입력하지 않습니다. 출력 크기는 참조 이미지의 비율을 유지한 채 아래 Pipeline 설정의 Resize 값(Longer Side = 긴 변 px, Video Megapixels)에 맞춰 자동 결정됩니다. 길이·FPS는 Length·Base FPS로 제어합니다."
                      : "This pipeline has no direct width/height inputs. The output size keeps the reference image's aspect ratio and is set by the Resize controls in the Pipeline section below (Longer Side = longer edge in px, Video Megapixels). Length and FPS are controlled by Length and Base FPS."}
                  </p>
                </div>
                {estimatedOutputSize ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2">
                    <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {language === "ko" ? (
                        <>
                          참조 이미지 {referenceSize?.width}×{referenceSize?.height} →
                          예상 출력{" "}
                          <span className="font-semibold text-foreground">
                            약 {estimatedOutputSize.width}×
                            {estimatedOutputSize.height}
                          </span>{" "}
                          (긴 변 {estimatedOutputSize.longerSide}px · 32px 정렬 기준
                          추정)
                        </>
                      ) : (
                        <>
                          Reference {referenceSize?.width}×{referenceSize?.height} →
                          estimated output{" "}
                          <span className="font-semibold text-foreground">
                            ~{estimatedOutputSize.width}×
                            {estimatedOutputSize.height}
                          </span>{" "}
                          (longer side {estimatedOutputSize.longerSide}px, snapped
                          to 32px)
                        </>
                      )}
                    </p>
                  </div>
                ) : videoRequiresSourceImage ? (
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2">
                    <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {language === "ko"
                        ? "참조 이미지를 올리면 예상 출력 가로세로 크기를 계산해 드려요."
                        : "Upload a reference image to preview the estimated output width × height."}
                    </p>
                  </div>
                ) : null}
              </div>
            )}
            </div>
          </EditorSection>

          <Separator />

          <EditorSection
            title={language === "ko" ? "생성" : "Generation"}
            description={language === "ko" ? "Steps, CFG, seed를 설정합니다." : "Set steps, CFG, and seed."}
          >
            <div className="grid gap-3 xl:grid-cols-3">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Steps
              </Label>
              <Input
                type="number"
                min={1}
                max={150}
                value={params.num_inference_steps}
                onChange={(event) =>
                  updateParams({
                    num_inference_steps: numericValue(
                      event.target.value,
                      params.num_inference_steps
                    ),
                  })
                }
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                CFG
              </Label>
              <Input
                type="number"
                min={0}
                max={30}
                step={0.5}
                value={params.guidance_scale}
                onChange={(event) =>
                  updateParams({
                    guidance_scale: numericValue(
                      event.target.value,
                      params.guidance_scale
                    ),
                  })
                }
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                Seed
              </Label>
              <Input
                type="number"
                min={0}
                placeholder="Random"
                value={params.seed ?? ""}
                onChange={(event) =>
                  updateParams({
                    seed: event.target.value
                      ? numericValue(event.target.value, 0)
                      : null,
                  })
                }
              />
            </div>
            </div>
          </EditorSection>

          <Separator />

          <EditorSection
            title="VAE"
            description={
              language === "ko"
                ? "VAE decode tiling과 temporal chunk를 조정합니다."
                : "Adjust VAE decode tiling and temporal chunks."
            }
            defaultOpen={false}
          >
            <div>
              <div className="text-sm font-medium text-foreground">
                VAE Decode Tiling
              </div>
              <p className="text-xs text-muted-foreground">
                Larger temporal chunks reduce brightness flashes but use more VRAM.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <div>
                <Label className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Tile Size</span>
                  <SettingHelpTooltip
                    text={VAE_SETTING_HELP.tileSize[language]}
                    language={language}
                  />
                </Label>
                <Input type="number" min={128} max={1024} step={32}
                  value={params.vae_tile_size}
                  onChange={(event) => updateParams({ vae_tile_size: numericValue(event.target.value, params.vae_tile_size) })}
                />
              </div>
              <div>
                <Label className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Tile Overlap</span>
                  <SettingHelpTooltip
                    text={VAE_SETTING_HELP.tileOverlap[language]}
                    language={language}
                  />
                </Label>
                <Input type="number" min={0} max={256} step={16}
                  value={params.vae_tile_overlap}
                  onChange={(event) => updateParams({ vae_tile_overlap: numericValue(event.target.value, params.vae_tile_overlap) })}
                />
              </div>
              <div>
                <Label className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Temporal Size</span>
                  <SettingHelpTooltip
                    text={VAE_SETTING_HELP.temporalSize[language]}
                    language={language}
                  />
                </Label>
                <Input type="number" min={8} max={256} step={8}
                  value={params.vae_temporal_size}
                  onChange={(event) => updateParams({ vae_temporal_size: numericValue(event.target.value, params.vae_temporal_size) })}
                />
              </div>
              <div>
                <Label className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <span>Temporal Overlap</span>
                  <SettingHelpTooltip
                    text={VAE_SETTING_HELP.temporalOverlap[language]}
                    language={language}
                  />
                </Label>
                <Input type="number" min={0} max={128} step={4}
                  value={params.vae_temporal_overlap}
                  onChange={(event) => updateParams({ vae_temporal_overlap: numericValue(event.target.value, params.vae_temporal_overlap) })}
                />
              </div>
            </div>
          </EditorSection>
        </div>

        <div className="border-t border-border p-4">
          {status.state === "error" && (
            <p className="mb-2 text-xs text-destructive">{status.message}</p>
          )}
          {!videoWorkflowReadyForTarget && status.state !== "error" && (
            <p className="mb-2 text-xs text-yellow-500">
              {videoConfig.message || "Video workflow is not configured."}
            </p>
          )}
          {generationTarget === "runpod" && !runpodTargetReady && status.state !== "error" && (
            <p className="mb-2 text-xs text-yellow-500">
              Select a RunPod pod with a ComfyUI URL before generating video.
            </p>
          )}
          {generationTarget === "runpod" &&
            runpodTargetReady &&
            !runpodConnected &&
            status.state !== "error" && (
              <p className="mb-2 text-xs text-yellow-500">
                {language === "ko"
                  ? "RunPod ComfyUI와 Helper가 모두 연결된 뒤에 영상을 생성할 수 있습니다. 위 RunPod 패널에서 상태를 확인하세요."
                  : "Connect both RunPod ComfyUI and the helper before generating. Check the RunPod panel above."}
              </p>
            )}
          {videoWorkflowReadyForTarget &&
            videoRequiresSourceImage &&
            !params.source_image &&
            status.state !== "error" && (
              <p className="mb-2 text-xs text-yellow-500">
                Add a start image before generating video.
              </p>
            )}
          {status.state === "completed" && (
            <p className="mb-2 text-xs text-green-500">{status.message}</p>
          )}
          {status.state === "canceled" && (
            <p className="mb-2 text-xs text-muted-foreground">{status.message}</p>
          )}
          {(isGenerating || queuedJobCount > 0) && (
            <p className="mb-2 text-xs text-muted-foreground">
              {language === "ko"
                ? `실행 중 ${isGenerating ? 1 : 0}개 · 대기 ${queuedJobCount}개`
                : `Running ${isGenerating ? 1 : 0} · Queued ${queuedJobCount}`}
            </p>
          )}
          <div
            className={
              isGenerating ? "grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2" : ""
            }
          >
            <Button
              className="relative w-full cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/40 hover:brightness-110"
              size="lg"
              onClick={() => generate()}
              disabled={!canGenerate}
            >
              <span className="relative z-10 flex items-center justify-center gap-2 drop-shadow-sm">
                <Play className="h-4 w-4" />
                {isGenerating || queuedJobCount > 0
                  ? language === "ko" ? "대기열에 추가" : "Add to Queue"
                  : language === "ko" ? "영상 생성" : "Generate Video"}
              </span>
            </Button>

            {isGenerating && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => cancelGeneration()}
                className="gap-1.5"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
        </aside>
      )}

      {editorOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize video editor and gallery"
          onPointerDown={startEditorResize}
          className="group relative z-20 w-2 shrink-0 cursor-col-resize border-x border-border bg-muted/40 hover:bg-primary/20"
        >
          <GripVertical className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground group-hover:text-primary" />
        </div>
      )}

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setEditorOpen((open) => !open)}
              aria-label={editorOpen ? "Hide video editor" : "Show video editor"}
              title={editorOpen ? "Hide video editor" : "Show video editor"}
            >
              {editorOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <Film className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Video Gallery</h2>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                Video width
              </span>
              <Slider
                value={[thumbnailWidth]}
                onValueChange={(value) =>
                  setThumbnailWidth(Array.isArray(value) ? value[0] : value)
                }
                min={VIDEO_THUMBNAIL_MIN_WIDTH}
                max={VIDEO_THUMBNAIL_MAX_WIDTH}
                step={20}
                className="w-28"
              />
              <span className="w-8 text-right text-xs font-mono tabular-nums">
                {thumbnailWidth}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {activeWorkspaceId
                ? `${visibleVideos.filter((video) => video.url).length} / ${videos.length} videos`
                : `${videos.length} videos`}
            </span>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={refreshVideos}
              aria-label="Refresh videos"
            >
              <RefreshCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <WorkspaceBar media="videos" onDownloaded={() => refreshVideos()} />

        <div className="flex-1 overflow-y-auto p-4">
          {visibleVideos.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-muted-foreground">
              <div>
                <Film className="mx-auto mb-3 h-10 w-10 opacity-50" />
                <p className="text-sm">No videos yet</p>
                <p className="mt-1 text-xs">Generate your first video to get started</p>
              </div>
            </div>
          ) : (
            <div
              className="grid grid-flow-row-dense gap-4"
              style={{
                gridTemplateColumns:
                  "repeat(auto-fill, minmax(min(100%, " +
                  thumbnailWidth +
                  "px), 1fr))",
                gridAutoRows: "8px",
              }}
            >
              {visibleVideos.map((video) => (
                <VideoGalleryCard
                  key={video.id}
                  video={video}
                  language={language}
                  liveDetail={
                    video.id === activeGeneration?.id
                      ? generationDetails[0]
                      : undefined
                  }
                  onDelete={deleteVideo}
                  onCancelGeneration={(item) => cancelGeneration(item.id)}
                  onReuse={reuseVideoParams}
                  onRemovePending={removePendingVideo}
                  onOpenDetail={(item) => setSelectedVideoId(item.id)}
                  onWorkspacesChange={applyVideoWorkspaces}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
    <PaimonPanel
      store={useVideoPaimonStore}
      open={paimonOpen}
      onOpenChange={setPaimonOpen}
      subtitle={
        language === "ko"
          ? "현재 비디오 입력값을 읽고 설정을 수정합니다"
          : "Reads the current video inputs and edits them"
      }
      intro={
        language === "ko"
          ? "파이몬이에요. 현재 비디오 입력값을 보고 프롬프트, 모델, 사운드 설정을 다듬어드릴게요."
          : "Paimon here. I can refine the current video prompt, model, and sound settings."
      }
      placeholder={
        language === "ko"
          ? "이 시작 이미지로 카메라가 천천히 도는 영상 프롬프트를 만들어줘"
          : "Write an i2v prompt with a slow orbiting camera"
      }
      toolbar={
        <CharacterSituationPicker
          language={language}
          defaultSeconds={situationSeconds}
          minSeconds={1}
          maxSeconds={30}
          secondsHint={
            pipelineDuration
              ? `${pipelineDuration.frames} frames · ${pipelineDuration.fps} fps`
              : durationLabel
          }
          disabled={paimonLoading}
          batchRunning={situationBatch !== null}
          onRun={runSituation}
        />
      }
      footer={
        situationBatch && (
          <div className="flex items-center gap-2 border-t border-border bg-secondary/40 px-3 py-2 text-xs">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {language === "ko" ? "상황 순차 생성" : "Situations"}{" "}
              {situationBatch.done + 1}/{situationBatch.total} ·{" "}
              {situationBatch.current}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={cancelSituationBatch}
            >
              {language === "ko" ? "취소" : "Cancel"}
            </Button>
          </div>
        )
      }
    />
    {selectedVideo && (
      <VideoDetailModal
        key={selectedVideo.id}
        video={selectedVideo}
        videos={detailVideos}
        language={language}
        pipelines={videoPipelines}
        onClose={() => setSelectedVideoId(null)}
        onSelectVideo={(item) => setSelectedVideoId(item.id)}
        onReuse={reuseVideoParams}
        onDelete={deleteVideo}
      />
    )}
    <Dialog
      open={startImagePreviewOpen && Boolean(params.source_image)}
      onOpenChange={setStartImagePreviewOpen}
    >
      <DialogContent className="flex max-h-[92vh] w-auto max-w-[92vw] items-center justify-center border-none bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">
          {language === "ko" ? "시작 이미지 크게 보기" : "Start image preview"}
        </DialogTitle>
        {params.source_image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={params.source_image}
            alt={language === "ko" ? "시작 이미지" : "Start image"}
            className="max-h-[92vh] max-w-[92vw] rounded-md object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}
