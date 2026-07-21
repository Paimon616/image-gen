"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { CivitaiMissingResources } from "@/components/civitai-missing-resources";
import { CopyLinkButton } from "@/components/copy-link-button";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
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
  HelpCircle,
  LinkIcon,
  Loader2,
  Play,
  RefreshCcw,
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
  const activePromptIdRef = useRef("");
  const generationAbortControllerRef = useRef<AbortController | null>(null);

  const isGenerating = status.state === "generating";
  const videoWorkflowReady =
    videoConfig.configured && videoConfig.exists && videoConfig.ready;
  const videoRequiresSourceImage = params.video_model !== "ltx-10eros";
  const videoIncludesAudio = Boolean(videoConfig.includesAudio);
  const soundWorkflowReady =
    videoConfig.audio.configured && videoConfig.audio.exists && videoConfig.audio.ready;
  const canGenerate =
    params.prompt.trim().length > 0 &&
    (!videoRequiresSourceImage || Boolean(params.source_image)) &&
    (!params.enable_sound || soundWorkflowReady) &&
    !isGenerating &&
    videoWorkflowReady;
  const generateButtonProgress = isGenerating
    ? Math.max(buttonProgress, status.progress)
    : status.state === "completed"
      ? 100
      : 0;

  const updateParams = useCallback((update: Partial<VideoGenerationParams>) => {
    setParams((current) => ({ ...current, ...update }));
  }, []);

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

  useEffect(() => {
    refreshVideos();
  }, [refreshVideos]);

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
    if (!videoWorkflowReady) {
      setStatus({
        state: "error",
        progress: 0,
        message: videoConfig.message || "Video workflow is not configured.",
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
        body: JSON.stringify(params),
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
    params,
    soundWorkflowReady,
    videoConfig.audio.message,
    videoConfig.message,
    videoRequiresSourceImage,
    videoWorkflowReady,
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
    <div className="flex h-screen bg-background">
      <AppSidebar />

      <aside className="flex w-[36rem] max-w-[58vw] flex-col overflow-hidden border-r border-border">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-semibold">Video Generation</h1>
          <p className="text-xs text-muted-foreground">
            ComfyUI video workflow
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
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

          <section className="space-y-3 rounded-md border border-border bg-card/85 p-3 shadow-sm">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">
                {language === "ko" ? "영상 모델" : "Video Model"}
              </Label>
              <select
                value={params.video_model}
                onChange={(event) =>
                  updateParams({
                    video_model: event.target.value as VideoGenerationParams["video_model"],
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="wan-smoothmix">SmoothMix Wan 2.2 I2V</option>
                <option value="wan-base">Wan 2.2 Base I2V</option>
                <option value="ltx-10eros">LTX 2.3 10Eros T2V</option>
              </select>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {params.video_model === "ltx-10eros"
                  ? language === "ko"
                    ? "텍스트 기반 영상 모델이며 시작 이미지가 필요하지 않습니다."
                    : "Text-to-video preset; no start image is required."
                  : language === "ko"
                    ? "이미지 기반 영상 모델이며 시작 이미지가 필요합니다."
                    : "Image-to-video preset; a start image is required."}
              </p>
            </div>

            {params.video_model === "wan-smoothmix" && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">
                  {language === "ko" ? "Wan LoRA 강도 (0 = 끔)" : "Wan LoRA strengths (0 = off)"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="mb-1 block text-[11px] text-muted-foreground">SmoothXXX High/Low</Label>
                    <Input type="number" min={0} max={2} step={0.05}
                      value={params.smooth_xxx_strength}
                      onChange={(event) => updateParams({ smooth_xxx_strength: numericValue(event.target.value, params.smooth_xxx_strength) })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[11px] text-muted-foreground">Mating Press High/Low</Label>
                    <Input type="number" min={0} max={2} step={0.05}
                      value={params.mating_press_strength}
                      onChange={(event) => updateParams({ mating_press_strength: numericValue(event.target.value, params.mating_press_strength) })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[11px] text-muted-foreground">LightX2V High</Label>
                    <Input type="number" min={0} max={4} step={0.1}
                      value={params.lightx2v_high_strength}
                      onChange={(event) => updateParams({ lightx2v_high_strength: numericValue(event.target.value, params.lightx2v_high_strength) })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[11px] text-muted-foreground">LightX2V Low</Label>
                    <Input type="number" min={0} max={4} step={0.1}
                      value={params.lightx2v_low_strength}
                      onChange={(event) => updateParams({ lightx2v_low_strength: numericValue(event.target.value, params.lightx2v_low_strength) })}
                    />
                  </div>
                </div>
              </div>
            )}

            {params.video_model === "ltx-10eros" && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground">
                  {language === "ko" ? "LTX LoRA 강도 (0 = 끔)" : "LTX LoRA strengths (0 = off)"}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="mb-1 block text-[11px] text-muted-foreground">DR34ML4Y LTXXX V2</Label>
                    <Input type="number" min={0} max={2} step={0.05}
                      value={params.ltx_dr34_strength}
                      onChange={(event) => updateParams({ ltx_dr34_strength: numericValue(event.target.value, params.ltx_dr34_strength) })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block text-[11px] text-muted-foreground">DaSiWa Body Physics</Label>
                    <Input type="number" min={0} max={2} step={0.05}
                      value={params.ltx_dasiwa_strength}
                      onChange={(event) => updateParams({ ltx_dasiwa_strength: numericValue(event.target.value, params.ltx_dasiwa_strength) })}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          <div className="grid gap-3">
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

            <section className="rounded-md border border-border bg-card/80 p-3 shadow-sm">
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
            </section>
          </div>

          <Separator />

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

          <Separator />

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

          <Separator />

          <section className="space-y-3">
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
          </section>
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
          {!videoWorkflowReady && status.state !== "error" && (
            <p className="mb-2 text-xs text-yellow-500">
              {videoConfig.message || "Video workflow is not configured."}
            </p>
          )}
          {videoWorkflowReady &&
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

      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-medium">Video Gallery</h2>
          </div>
          <div className="flex items-center gap-2">
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
            <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {videos.map((video) => (
                <article
                  key={video.id}
                  className="overflow-hidden rounded-md border border-border bg-card shadow-sm"
                >
                  <div className="aspect-video bg-background">
                    {isGif(video) ? (
                      <img
                        src={video.url}
                        alt={video.params?.prompt || "Generated video"}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <video
                        src={video.url}
                        controls
                        playsInline
                        className="h-full w-full object-contain"
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
                            <audio
                              src={audio.url}
                              controls
                              className="h-8 w-full"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
