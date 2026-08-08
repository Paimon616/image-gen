"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CivitaiMissingResources } from "@/components/civitai-missing-resources";
import { CopyLinkButton } from "@/components/copy-link-button";
import { EditorSection } from "@/components/editor-section";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import {
  DEFAULT_VIDEO_PARAMS,
  type CivitaiImportResult,
  type GeneratedVideo,
  type GenerationStatus,
  type GenerationParams,
  type VideoGenerationParams,
} from "@/lib/types";
import {
  findMissingCivitaiResources,
  type LocalModelsResponse,
  type MissingResource,
} from "@/lib/civitai-resource-matching";
import {
  Film,
  GripVertical,
  Bot,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  LinkIcon,
  Loader2,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCcw,
  Server,
  Send,
  Wrench,
  RotateCcw,
  Trash2,
  Volume2,
  X,
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
  comfyError: string;
  helperError: string;
}

interface VideoPipelineOption {
  id: string;
  label: string;
  description: string;
  workflowPath: string;
  mode: "i2v" | "t2v";
  experimental?: boolean;
  defaults: Record<string, string | number | boolean>;
  controls: VideoPipelineControlOption[];
}

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

interface GenerationDetail {
  id: string;
  stage: string;
  message: string;
  node_id?: string;
  node_type?: string;
  step?: number;
  total_steps?: number;
  elapsed_ms?: number;
}

const VIDEO_GENERATION_STATE_KEY = "image-gen-video-generation-state";

interface StoredVideoGenerationState {
  status: GenerationStatus;
  buttonProgress: number;
  activePromptId: string;
  details: GenerationDetail[];
}

function parseSseEvent(rawEvent: string) {
  const event =
    rawEvent
      .split("\n")
      .find((line) => line.startsWith("event: "))
      ?.slice("event: ".length)
      .trim() ?? "message";
  const data = rawEvent
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");

  return {
    event,
    data: data ? JSON.parse(data) : null,
  };
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

function detailKey(detail: Omit<GenerationDetail, "id">) {
  return [
    detail.stage,
    detail.node_id ?? "",
    detail.node_type ?? "",
    detail.step ?? "",
    detail.total_steps ?? "",
    detail.message,
  ].join(":");
}

function readStoredGenerationState(): StoredVideoGenerationState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(VIDEO_GENERATION_STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredVideoGenerationState>;
    if (!parsed.status || !Array.isArray(parsed.details)) return null;

    return {
      status: parsed.status,
      buttonProgress: Number(parsed.buttonProgress ?? parsed.status.progress ?? 0),
      activePromptId: String(parsed.activePromptId ?? ""),
      details: parsed.details,
    };
  } catch {
    return null;
  }
}

function writeStoredGenerationState(state: StoredVideoGenerationState) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(VIDEO_GENERATION_STATE_KEY, JSON.stringify(state));
}

function clearStoredGenerationState() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(VIDEO_GENERATION_STATE_KEY);
}

function isGif(video: GeneratedVideo) {
  return video.contentType === "image/gif" || video.filename.toLowerCase().endsWith(".gif");
}

const VIDEO_PARAM_KEYS = new Set(Object.keys(DEFAULT_VIDEO_PARAMS));

function sanitizeVideoParamsPatch(value: unknown): Partial<VideoGenerationParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const patch: Partial<VideoGenerationParams> = {};
  Object.entries(value).forEach(([key, nextValue]) => {
    if (VIDEO_PARAM_KEYS.has(key)) {
      (patch as Record<string, unknown>)[key] = nextValue;
    }
  });
  return patch;
}

function VideoPaimonPanel({
  params,
  language,
  open,
  onOpenChange,
  onApplyParams,
}: {
  params: VideoGenerationParams;
  language: AppLanguage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplyParams: (patch: Partial<VideoGenerationParams>) => void;
}) {
  const [messages, setMessages] = useState<
    { id: string; role: "user" | "assistant"; content: string }[]
  >([
    {
      id: "intro",
      role: "assistant",
      content:
        language === "ko"
          ? "파이몬이에요. 현재 비디오 입력값을 보고 프롬프트, 모델, 사운드 설정을 다듬어드릴게요."
          : "Paimon here. I can refine the current video prompt, model, and sound settings.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resetChat = useCallback(() => {
    setMessages([
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          language === "ko"
            ? "파이몬이에요. 현재 비디오 입력값을 보고 프롬프트, 모델, 사운드 설정을 다듬어드릴게요."
            : "Paimon here. I can refine the current video prompt, model, and sound settings.",
      },
    ]);
    setDraft("");
    setError("");
  }, [language]);

  const askPaimon = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user" as const,
      content: text,
    };
    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant" as const,
      content: "",
    };
    const nextMessages = [...messages, userMessage];

    setMessages([...nextMessages, assistantMessage]);
    setDraft("");
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/paimon/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(({ role, content }) => ({ role, content })),
          currentParams: params,
          attachments: [],
        }),
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !response.body || !contentType.includes("text/event-stream")) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "Paimon request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          const { event, data } = parseSseEvent(rawEvent);

          if (event === "delta") {
            const delta = String(data?.text ?? "");
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: message.content + delta }
                  : message
              )
            );
          }

          if (event === "done") {
            const reply = String(data?.reply ?? "");
            const patch = sanitizeVideoParamsPatch(data?.paramsPatch);
            if (Object.keys(patch).length > 0) onApplyParams(patch);
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, content: reply || message.content || "Done." }
                  : message
              )
            );
          }

          if (event === "error") {
            throw new Error(String(data?.error ?? "Paimon failed."));
          }
        }
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Paimon failed.";
      setError(message);
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantMessage.id
            ? { ...item, content: language === "ko" ? `오류: ${message}` : `Error: ${message}` }
            : item
        )
      );
    } finally {
      setBusy(false);
    }
  }, [busy, draft, language, messages, onApplyParams, params]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      <section
        className={`flex h-[min(76vh,620px)] w-[min(calc(100vw-2rem),420px)] origin-bottom-right flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl transition-[opacity,transform,filter] duration-[180ms] ease-out ${
          open
            ? "translate-y-0 scale-100 opacity-100 blur-0"
            : "pointer-events-none translate-y-3 scale-95 opacity-0 blur-[1px]"
        } motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-0 motion-reduce:transition-none`}
      >
        <header className="flex h-12 items-center justify-between border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold">Paimon 파이몬</h3>
              <p className="truncate text-[11px] text-muted-foreground">
                {language === "ko" ? "비디오 생성 정보를 수정합니다" : "Edits video generation settings"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={resetChat}
              disabled={busy}
              aria-label="Reset Paimon chat"
              title={language === "ko" ? "채팅 초기화" : "Reset chat"}
            >
              <RotateCcw />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              aria-label="Close Paimon"
            >
              <X />
            </Button>
          </div>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-5 ${
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-secondary text-secondary-foreground"
                }`}
              >
                {message.content || (language === "ko" ? "작성 중..." : "Writing...")}
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {language === "ko" ? "파이몬이 생각하는 중" : "Paimon is thinking"}
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <form
          className="border-t border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void askPaimon();
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void askPaimon();
                }
              }}
              placeholder={
                language === "ko"
                  ? "예: 이 장면을 LTX용 자연스러운 카메라 움직임으로 정리해줘"
                  : "Example: Rewrite this as a natural LTX camera-motion prompt"
              }
              className="max-h-28 min-h-10 resize-none text-sm"
            />
            <Button
              type="submit"
              size="icon-lg"
              disabled={!draft.trim() || busy}
              aria-label="Send to Paimon"
            >
              {busy ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
        </form>
      </section>
      <Button
        type="button"
        size="icon-lg"
        className={`size-12 rounded-full shadow-xl transition-[transform,background-color,box-shadow] duration-200 ease-out hover:scale-105 ${
          open ? "rotate-3 shadow-2xl ring-2 ring-primary/25" : "rotate-0"
        } motion-reduce:transform-none motion-reduce:transition-none`}
        onClick={() => onOpenChange(!open)}
        aria-label="Open Paimon"
        title="Paimon 파이몬"
      >
        <MessageCircle
          className={`size-5 transition-transform duration-200 ${
            open ? "scale-90" : "scale-100"
          } motion-reduce:transform-none`}
        />
      </Button>
    </div>
  );
}

const VIDEO_EDITOR_MIN_WIDTH = 320;
const VIDEO_GALLERY_MIN_WIDTH = 320;
const VIDEO_THUMBNAIL_MIN_WIDTH = 180;
const VIDEO_THUMBNAIL_MAX_WIDTH = 560;

function VideoGalleryCard({
  video,
  onDelete,
}: {
  video: GeneratedVideo;
  onDelete: (video: GeneratedVideo) => Promise<void>;
}) {
  const articleRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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

  return (
    <article
      ref={articleRef}
      className="relative overflow-hidden rounded-md border border-border bg-card shadow-sm"
    >
      <div ref={contentRef}>
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
  const [params, setParams] = useState<VideoGenerationParams>(DEFAULT_VIDEO_PARAMS);
  const [status, setStatus] = useState<GenerationStatus>({
    state: "idle",
    progress: 0,
    message: "",
  });
  const [buttonProgress, setButtonProgress] = useState(0);
  const [generationDetails, setGenerationDetails] = useState<GenerationDetail[]>([]);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
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
  const [runpodConnection, setRunpodConnection] = useState<RunpodConnectionStatus>({
    checked: false,
    comfyReachable: false,
    comfyInitializing: false,
    helperReachable: false,
    helperInitializing: false,
    comfyError: "",
    helperError: "",
  });
  const [videoPipelines, setVideoPipelines] = useState<VideoPipelineOption[]>([]);
  const [paimonOpen, setPaimonOpen] = useState(false);
  const activePromptIdRef = useRef("");
  const autoRunpodCheckKeyRef = useRef("");
  const runpodPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationAbortControllerRef = useRef<AbortController | null>(null);

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

  const isGenerating = status.state === "generating";
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
  const videoWorkflowReadyForTarget =
    generationTarget === "runpod"
      ? videoConfig.configured && videoConfig.exists
      : videoWorkflowReady;
  const videoRequiresSourceImage =
    selectedVideoPipeline?.mode === "i2v" ||
    (!selectedVideoPipeline && params.video_model !== "ltx-10eros");
  const videoIncludesAudio = Boolean(videoConfig.includesAudio);
  const soundWorkflowReady =
    videoConfig.audio.configured && videoConfig.audio.exists && videoConfig.audio.ready;
  const canGenerate =
    params.prompt.trim().length > 0 &&
    (!videoRequiresSourceImage || Boolean(params.source_image)) &&
    (!params.enable_sound || soundWorkflowReady) &&
    !isGenerating &&
    videoWorkflowReadyForTarget &&
    runpodTargetReady;
  const generateButtonProgress = isGenerating
    ? Math.max(buttonProgress, status.progress)
    : status.state === "completed"
      ? 100
      : 0;

  const updateParams = useCallback((update: Partial<VideoGenerationParams>) => {
    setParams((current) => ({ ...current, ...update }));
  }, []);

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
      comfyError: "",
      helperError: "",
    });
  }, []);

  const applyRunpodStatus = useCallback(
    (data: Record<string, unknown>) => {
      const comfyReachable = Boolean(data.comfyReachable);
      const helperReachable = Boolean(data.helperReachable);
      const comfyInitializing = !comfyReachable && Boolean(data.comfyInitializing);
      const helperInitializing = !helperReachable && Boolean(data.helperInitializing);
      const comfyError = String(data.comfyError || "");
      const helperError = String(data.helperError || "");

      setRunpodConnection({
        checked: true,
        comfyReachable,
        comfyInitializing,
        helperReachable,
        helperInitializing,
        comfyError,
        helperError,
      });

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
    [language]
  );

  const checkRunpodConnection = useCallback(async () => {
    if (!selectedRunpodPodId || runpodBusy) return;

    setRunpodBusy(true);
    setRunpodStatus("");
    try {
      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/status?ensure=1`,
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
        comfyError: message,
        helperError: "",
      });
      setRunpodStatus(message);
    } finally {
      setRunpodBusy(false);
    }
  }, [applyRunpodStatus, runpodBusy, selectedRunpodPodId]);

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
  }, [generationTarget, isGenerating, refreshRunpodStatus, selectedRunpodPodId]);

  // Auto re-check while a service is still initializing, then stop once it is
  // ready (or the target/pod changes). This mirrors runpod-video's live polling.
  useEffect(() => {
    if (runpodPollRef.current) {
      clearTimeout(runpodPollRef.current);
      runpodPollRef.current = null;
    }
    if (
      generationTarget !== "runpod" ||
      !selectedRunpodPodId ||
      isGenerating ||
      runpodBusy ||
      !runpodConnection.checked
    ) {
      return;
    }
    if (!runpodConnection.comfyInitializing && !runpodConnection.helperInitializing) {
      return;
    }
    runpodPollRef.current = setTimeout(() => {
      void refreshRunpodStatus();
    }, 6_000);
    return () => {
      if (runpodPollRef.current) {
        clearTimeout(runpodPollRef.current);
        runpodPollRef.current = null;
      }
    };
  }, [
    generationTarget,
    isGenerating,
    refreshRunpodStatus,
    runpodBusy,
    runpodConnection.checked,
    runpodConnection.comfyInitializing,
    runpodConnection.helperInitializing,
    selectedRunpodPodId,
  ]);

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

  const appendGenerationDetail = useCallback(
    (detail: Omit<GenerationDetail, "id">) => {
      const key = detailKey(detail);

      setGenerationDetails((current) => {
        if (current[0]?.id === key) {
          return [
            {
              ...current[0],
              ...detail,
              id: key,
            },
            ...current.slice(1),
          ];
        }

        return [{ ...detail, id: key }, ...current].slice(0, 8);
      });
    },
    []
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
  }, []);

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
  }, []);

  useEffect(() => {
    refreshVideos();
  }, [refreshVideos]);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const pods = Array.isArray(data.runpodPods)
          ? (data.runpodPods as RunpodPodOption[])
          : [];
        setRunpodPods(pods);
        setSelectedRunpodPodId((current) => current || pods[0]?.id || "");
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
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = readStoredGenerationState();
      if (!stored) return;

      setStatus(stored.status);
      setButtonProgress(stored.buttonProgress);
      setGenerationDetails(stored.details);
      activePromptIdRef.current = stored.activePromptId;

      if (stored.status.state === "generating") {
        appendGenerationDetail({
          stage: "restored",
          message: "Restored local progress after returning to this page.",
        });
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [appendGenerationDetail]);

  useEffect(() => {
    if (
      status.state !== "generating" &&
      status.state !== "canceled" &&
      status.state !== "error"
    ) {
      return;
    }

    writeStoredGenerationState({
      status,
      buttonProgress,
      activePromptId: activePromptIdRef.current,
      details: generationDetails,
    });
  }, [buttonProgress, generationDetails, status]);

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

  const durationLabel = useMemo(
    () => `${params.num_frames} frames at ${params.fps} fps`,
    [params.fps, params.num_frames]
  );

  const generate = useCallback(async () => {
    if (!params.prompt.trim()) return;
    if (videoRequiresSourceImage && !params.source_image) {
      setStatus({
        state: "error",
        progress: 0,
        message: "Add a start image before generating video.",
      });
      return;
    }
    if (!videoWorkflowReadyForTarget) {
      setStatus({
        state: "error",
        progress: 0,
        message: videoConfig.message || "Video workflow is not configured.",
      });
      return;
    }
    if (generationTarget === "runpod" && !selectedRunpodPod?.comfyUrl) {
      setStatus({
        state: "error",
        progress: 0,
        message: "Select a RunPod pod with a ComfyUI URL before generating video.",
      });
      return;
    }
    if (params.enable_sound && !soundWorkflowReady) {
      setStatus({
        state: "error",
        progress: 0,
        message: videoConfig.audio.message || "Sound workflow is not configured.",
      });
      return;
    }

    const abortController = new AbortController();
    activePromptIdRef.current = "";
    generationAbortControllerRef.current = abortController;
    setGenerationDetails([]);
    setButtonProgress(1);
    setStatus({ state: "generating", progress: 1, message: "Queued..." });
    appendGenerationDetail({
      stage: "queued",
      message: "Queued request in Image Gen.",
      elapsed_ms: 0,
    });

    try {
      const res = await fetch("/api/video/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...params,
          generationTarget,
          runpodPodId: generationTarget === "runpod" ? selectedRunpodPodId : undefined,
        }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Video generation failed");
      }

      if (!res.body) {
        throw new Error("Video generation stream did not start");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completed = false;

      while (!completed) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;
          const { event, data } = parseSseEvent(rawEvent);

          if (event === "queued") {
            activePromptIdRef.current = String(data?.prompt_id ?? "");
          }

          if (event === "progress") {
            const progress = Number(data?.progress ?? 0);
            const message = String(data?.message ?? "Generating video...");
            setButtonProgress(progress);
            setStatus({ state: "generating", progress, message });
            appendGenerationDetail({
              stage: String(data?.stage ?? "progress"),
              message,
              node_id: data?.node_id ? String(data.node_id) : undefined,
              node_type: data?.node_type ? String(data.node_type) : undefined,
              step:
                typeof data?.step === "number" ? Number(data.step) : undefined,
              total_steps:
                typeof data?.total_steps === "number"
                  ? Number(data.total_steps)
                  : undefined,
              elapsed_ms:
                typeof data?.elapsed_ms === "number"
                  ? Number(data.elapsed_ms)
                  : undefined,
            });
          }

          if (event === "detail") {
            const message = String(data?.message ?? "Working...");
            setStatus((current) => ({
              ...current,
              message,
            }));
            appendGenerationDetail({
              stage: String(data?.stage ?? "detail"),
              message,
              node_id: data?.node_id ? String(data.node_id) : undefined,
              node_type: data?.node_type ? String(data.node_type) : undefined,
              elapsed_ms:
                typeof data?.elapsed_ms === "number"
                  ? Number(data.elapsed_ms)
                  : undefined,
            });
          }

          if (event === "complete") {
            const generatedVideos = (data?.videos ?? []) as GeneratedVideo[];
            setVideos((current) => [...generatedVideos, ...current]);
            completed = true;
          }

          if (event === "error") {
            throw new Error(data?.error || "Video generation failed");
          }
        }
      }

      setButtonProgress(100);
      setStatus({ state: "completed", progress: 100, message: "Done!" });
      appendGenerationDetail({
        stage: "complete",
        message: params.enable_sound
          ? "Video and sound saved locally."
          : "Video saved locally.",
      });
      setTimeout(() => {
        setButtonProgress(0);
        setStatus({ state: "idle", progress: 0, message: "" });
        clearStoredGenerationState();
      }, 2000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setButtonProgress(0);
        setStatus({ state: "canceled", progress: 0, message: "Canceled." });
        clearStoredGenerationState();
        return;
      }

      setButtonProgress(0);
      setStatus({
        state: "error",
        progress: 0,
        message: error instanceof Error ? error.message : "Video generation failed",
      });
    } finally {
      generationAbortControllerRef.current = null;
      activePromptIdRef.current = "";
    }
  }, [
    appendGenerationDetail,
    generationTarget,
    params,
    selectedRunpodPod?.comfyUrl,
    selectedRunpodPodId,
    soundWorkflowReady,
    videoConfig.audio.message,
    videoConfig.message,
    videoRequiresSourceImage,
    videoWorkflowReadyForTarget,
  ]);

  const cancelGeneration = useCallback(() => {
    const promptId = activePromptIdRef.current;

    generationAbortControllerRef.current?.abort();

    if (promptId) {
      void fetch("/api/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      }).catch(() => {});
    }

    setButtonProgress(0);
    setStatus({ state: "canceled", progress: 0, message: "Canceled." });
    appendGenerationDetail({
      stage: "canceled",
      message: "Cancel requested.",
    });
    clearStoredGenerationState();
  }, [appendGenerationDetail]);

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
                  onClick={() => {
                    setGenerationTarget(item.value);
                    resetRunpodConnection();
                  }}
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
                      {pod.label || pod.podId || pod.id}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {generationTarget === "runpod" && (
            <section className="space-y-3 rounded-md border border-border bg-card/85 p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
                    <Server className="h-4 w-4 shrink-0 text-primary" />
                    <span className="truncate">RunPod</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {selectedRunpodPod
                      ? `${selectedRunpodPod.label || selectedRunpodPod.podId || selectedRunpodPod.id} · ${selectedRunpodPod.comfyUrl || "ComfyUI URL 없음"}`
                      : language === "ko"
                        ? "설정에서 RunPod pod를 추가하세요."
                        : "Add a RunPod pod in Settings."}
                  </p>
                </div>
              </div>
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
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void setupRunpodHelper()}
                  disabled={!selectedRunpodPodId || runpodSetupBusy || isGenerating}
                >
                  {runpodSetupBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Wrench className="h-3.5 w-3.5" />
                  )}
                  {language === "ko" ? "Helper 연결" : "Setup helper"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void checkRunpodConnection()}
                  disabled={!selectedRunpodPodId || runpodBusy || isGenerating}
                >
                  {runpodBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="h-3.5 w-3.5" />
                  )}
                  {language === "ko" ? "다시 시도" : "Retry"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {runpodStatus ||
                  (language === "ko"
                    ? "pod를 선택하면 상태만 자동으로 확인합니다. 시작·포트 노출·helper 설치가 필요하면 '다시 시도'를 누르세요."
                    : "Selecting a pod only checks status. Use Retry when pod start, port expose, or helper setup is needed.")}
              </p>
            </section>
          )}

          <section className="rounded-md border border-border bg-card/85 p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">
                  Import from Civitai
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
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
          </section>

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
              language === "ko"
                ? "별도 오디오 workflow가 준비된 경우 영상에 맞춘 사운드를 생성합니다."
                : "Generate synchronized sound when a separate audio workflow is configured."
            }
          >
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

              {videoIncludesAudio ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  The configured video workflow already embeds generated audio.
                </p>
              ) : !soundWorkflowReady ? (
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
          </EditorSection>

          <Separator />

          <EditorSection
            title={language === "ko" ? "참조와 캔버스" : "Reference & Canvas"}
            description={
              language === "ko"
                ? "I2V pipeline은 시작 이미지가 필요합니다."
                : "I2V pipelines require a start image."
            }
          >
            <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                Reference Image
              </Label>
              <ImageUpload
                label="Start Image"
                description={
                  videoRequiresSourceImage
                    ? "Required for the configured video workflow"
                    : "Optional for text-to-video workflows"
                }
                value={params.source_image}
                onChange={(url) => updateParams({ source_image: url })}
              />
            </div>

            <div className="space-y-3 rounded-md border border-border bg-card/80 p-3 shadow-sm">
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

              <div className="grid grid-cols-2 gap-2">
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
              </div>

              <p className="text-xs text-muted-foreground">{durationLabel}</p>
            </div>
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
          {generationDetails.length > 0 && (
            <div className="mb-3 rounded-md border border-border bg-card/85 p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-foreground">
                  Generation details
                </div>
                {isGenerating && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Live
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {generationDetails.map((detail) => (
                  <div
                    key={detail.id}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 rounded-md bg-background/75 px-2 py-1.5 text-xs"
                  >
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {formatElapsed(detail.elapsed_ms)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">
                        {detail.message}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{detail.stage}</span>
                        {detail.node_type && <span>{detail.node_type}</span>}
                        {detail.node_id && <span>node {detail.node_id}</span>}
                        {typeof detail.step === "number" &&
                          typeof detail.total_steps === "number" && (
                            <span>
                              step {detail.step}/{detail.total_steps}
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
          <div
            className={
              isGenerating ? "grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2" : ""
            }
          >
            <Button
              className={`relative w-full overflow-hidden ${
                isGenerating
                  ? "bg-zinc-800 text-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-100 disabled:opacity-100 dark:bg-zinc-800 dark:disabled:bg-zinc-800"
                  : ""
              }`}
              size="lg"
              onClick={generate}
              disabled={!canGenerate}
              aria-busy={isGenerating}
            >
              <span
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-sky-500 via-cyan-400 to-emerald-400 transition-[width] duration-500 ease-out"
                style={{ width: `${isGenerating ? generateButtonProgress : 0}%` }}
                aria-hidden="true"
              />
              {isGenerating ? (
                <span className="relative z-10 flex min-w-0 items-center gap-2 drop-shadow-sm">
                  <span className="tabular-nums">
                    {Math.round(generateButtonProgress)}%
                  </span>
                  <span>Generating...</span>
                </span>
              ) : (
                <span className="relative z-10 flex items-center gap-2 drop-shadow-sm">
                  <Play className="h-4 w-4" />
                  Generate Video
                </span>
              )}
            </Button>

            {isGenerating && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={cancelGeneration}
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
              {videos.length} videos
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

        <div className="flex-1 overflow-y-auto p-4">
          {videos.length === 0 ? (
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
              {videos.map((video) => (
                <VideoGalleryCard
                  key={video.id}
                  video={video}
                  onDelete={deleteVideo}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
    <VideoPaimonPanel
      params={params}
      language={language}
      open={paimonOpen}
      onOpenChange={setPaimonOpen}
      onApplyParams={updateParams}
    />
    </>
  );
}
