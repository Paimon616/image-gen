"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ImageUpload } from "@/components/image-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_VIDEO_PARAMS,
  type CivitaiImportResult,
  type GeneratedVideo,
  type GenerationStatus,
  type GenerationParams,
  type VideoGenerationParams,
} from "@/lib/types";
import { Film, LinkIcon, Loader2, Play, RefreshCcw, X } from "lucide-react";

interface VideoConfigState {
  configured: boolean;
  exists: boolean;
  ready: boolean;
  missing: string[];
  message: string;
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
  if (typeof importedParams.width === "number") mapped.width = importedParams.width;
  if (typeof importedParams.height === "number") mapped.height = importedParams.height;
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
  const [params, setParams] = useState<VideoGenerationParams>(DEFAULT_VIDEO_PARAMS);
  const [status, setStatus] = useState<GenerationStatus>({
    state: "idle",
    progress: 0,
    message: "",
  });
  const [buttonProgress, setButtonProgress] = useState(0);
  const [videos, setVideos] = useState<GeneratedVideo[]>([]);
  const [civitaiUrl, setCivitaiUrl] = useState("");
  const [civitaiStatus, setCivitaiStatus] = useState("");
  const [isImportingCivitai, setIsImportingCivitai] = useState(false);
  const [videoConfig, setVideoConfig] = useState<VideoConfigState>({
    configured: true,
    exists: true,
    ready: true,
    missing: [],
    message: "",
  });
  const activePromptIdRef = useRef("");
  const generationAbortControllerRef = useRef<AbortController | null>(null);

  const isGenerating = status.state === "generating";
  const videoWorkflowReady =
    videoConfig.configured && videoConfig.exists && videoConfig.ready;
  const canGenerate =
    params.prompt.trim().length > 0 &&
    Boolean(params.source_image) &&
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

  const importCivitaiMetadata = useCallback(async () => {
    if (!civitaiUrl.trim() || isImportingCivitai) return;

    setIsImportingCivitai(true);
    setCivitaiStatus("Fetching Civitai metadata...");

    try {
      const response = await fetch("/api/civitai/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: civitaiUrl }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to import Civitai metadata");
      }

      const imported = data as CivitaiImportResult;
      const mapped = mapCivitaiParamsToVideoParams(imported);

      updateParams(mapped);
      setCivitaiStatus(
        imported.metadataHidden
          ? "Imported available media and size. Prompt metadata is hidden."
          : "Imported prompt, size, seed, and start image."
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
    fetch("/api/video/config")
      .then((res) => res.json())
      .then((data) => {
        setVideoConfig({
          configured: Boolean(data.configured),
          exists: Boolean(data.exists),
          ready: data.ready !== false,
          missing: Array.isArray(data.missing) ? data.missing.map(String) : [],
          message: String(data.message ?? ""),
        });
      })
      .catch(() => {
        setVideoConfig({
          configured: false,
          exists: false,
          ready: false,
          missing: [],
          message: "Video generation configuration could not be checked.",
        });
      });
  }, []);

  const durationLabel = useMemo(
    () => `${params.num_frames} frames at ${params.fps} fps`,
    [params.fps, params.num_frames]
  );

  const generate = useCallback(async () => {
    if (!params.prompt.trim()) return;
    if (!params.source_image) {
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

    const abortController = new AbortController();
    activePromptIdRef.current = "";
    generationAbortControllerRef.current = abortController;
    setButtonProgress(1);
    setStatus({ state: "generating", progress: 1, message: "Queued..." });

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
      setTimeout(() => {
        setButtonProgress(0);
        setStatus({ state: "idle", progress: 0, message: "" });
      }, 2000);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setButtonProgress(0);
        setStatus({ state: "canceled", progress: 0, message: "Canceled." });
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
  }, [params, videoConfig.message, videoWorkflowReady]);

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
  }, []);

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
              <a
                href="https://civitai.red/images"
                target="_blank"
                rel="noreferrer"
                aria-label="Open Civitai images"
                title="Open Civitai images"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary shadow-sm transition-colors hover:border-primary/35 hover:bg-secondary"
              >
                <LinkIcon className="h-4 w-4" />
              </a>
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
          </div>

          <Separator />

          <div className="grid gap-3 xl:grid-cols-2">
            <div>
              <Label className="mb-2 block text-xs text-muted-foreground">
                Reference Image
              </Label>
              <ImageUpload
                label="Start Image"
                description="Required for Wan image-to-video"
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
        </div>

        <div className="border-t border-border p-4">
          {status.state === "error" && (
            <p className="mb-2 text-xs text-destructive">{status.message}</p>
          )}
          {!videoWorkflowReady && status.state !== "error" && (
            <p className="mb-2 text-xs text-yellow-500">
              {videoConfig.message || "Video workflow is not configured."}
            </p>
          )}
          {videoWorkflowReady && !params.source_image && status.state !== "error" && (
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
