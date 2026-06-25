"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageUpload } from "@/components/image-upload";
import { GenerationParams } from "@/components/generation-params";
import { ModelSelector } from "@/components/model-selector";
import { CivitaiImport } from "@/components/civitai-import";
import { Gallery } from "@/components/gallery";
import { ImageViewer } from "@/components/image-viewer";
import { AppSidebar } from "@/components/app-sidebar";
import { Slider } from "@/components/ui/slider";
import type {
  GeneratedImage,
  GenerationParams as GenerationParamsType,
} from "@/lib/types";
import { getModelConfig } from "@/lib/types";
import { ImageIcon, ImageUp, ScanLine, X } from "lucide-react";

function choosePoseControlNet(controlnets: string[]) {
  return (
    controlnets.find((model) => /open\s*pose|openpose|pose/i.test(model)) ??
    controlnets[0] ??
    ""
  );
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

async function uploadImageFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = (await res.json()) as { url?: string; error?: string };

  if (!res.ok || !data.url) {
    throw new Error(data.error || "Upload failed");
  }

  return data.url;
}

function imageFileFromClipboard(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));

  return imageItem?.getAsFile() ?? null;
}

interface GenerationQueueItem {
  id: string;
  params: GenerationParamsType;
}

function cloneGenerationParams(params: GenerationParamsType) {
  return JSON.parse(JSON.stringify(params)) as GenerationParamsType;
}

export default function Home() {
  const {
    params,
    setParams,
    status,
    setStatus,
    addImage,
    addImages,
    updateImage,
    images,
  } = useStore();
  const [localControlnets, setLocalControlnets] = useState<string[]>([]);
  const [posePreviewUrl, setPosePreviewUrl] = useState<string | null>(null);
  const [posePreviewStatus, setPosePreviewStatus] = useState("");
  const [sourceImagePreviewOpen, setSourceImagePreviewOpen] = useState(false);
  const [galleryColumns, setGalleryColumns] = useState(3);
  const [generationQueue, setGenerationQueue] = useState<GenerationQueueItem[]>([]);
  const [activeGeneration, setActiveGeneration] =
    useState<GenerationQueueItem | null>(null);
  const activePromptIdRef = useRef("");
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationRef = useRef<GenerationQueueItem | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        const controlnets = data.controlnets ?? [];
        setLocalControlnets(controlnets);
        if (!params.pose_reference_model && controlnets.length > 0) {
          setParams({ pose_reference_model: choosePoseControlNet(controlnets) });
        }
      })
      .catch(() => {});
  }, [params.pose_reference_model, setParams]);

  useEffect(() => {
    if (params.generation_mode !== "image_to_image") return;

    const handlePaste = async (event: ClipboardEvent) => {
      const file = imageFileFromClipboard(event);

      if (!file) return;

      event.preventDefault();
      try {
        const url = await uploadImageFile(file);
        setParams({ source_image: url });
      } catch (error) {
        setStatus({
          state: "error",
          progress: 0,
          message: error instanceof Error ? error.message : "Upload failed",
        });
      }
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [params.generation_mode, setParams, setStatus]);

  const currentModel = getModelConfig(params.model);
  const supportsPoseReference = currentModel.provider === "comfyui";
  const generationModeError = useMemo(() => {
    if (params.generation_mode === "image_to_image" && !params.source_image) {
      return "Add a source image before generating.";
    }
    if (params.generation_mode === "pose_reference") {
      if (!supportsPoseReference) {
        return "Pose Reference mode requires Local ComfyUI.";
      }
      if (!params.pose_reference_image) {
        return "Add a pose reference image before generating.";
      }
      if (!params.pose_reference_model.trim()) {
        return "Select an OpenPose/pose ControlNet model first.";
      }
    }
    return "";
  }, [
    params.generation_mode,
    params.pose_reference_image,
    params.pose_reference_model,
    params.source_image,
    supportsPoseReference,
  ]);

  const runGenerationJob = useCallback(async (job: GenerationQueueItem) => {
    const { id, params: jobParams } = job;

    const abortController = new AbortController();
    activePromptIdRef.current = "";
    generationAbortControllerRef.current = abortController;
    updateImage(id, {
      generation: {
        state: "waiting",
        progress: 1,
        message: "Queued...",
      },
    });

    try {
      const res = await fetch("/api/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobParams),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      if (!res.body) {
        throw new Error("Generation stream did not start");
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
            updateImage(id, {
              generation: {
                state: "waiting",
                progress: 1,
                message: "Waiting for ComfyUI...",
              },
            });
          }

          if (event === "progress") {
            const progress = Number(data?.progress ?? 0);
            const message = String(data?.message ?? "Generating...");
            const isStepProgress =
              data?.step != null && data?.total_steps != null;
            updateImage(id, {
              generation: {
                state: isStepProgress ? "generating" : "waiting",
                progress,
                message,
              },
            });
          }

          if (event === "complete") {
            const generatedImages: GeneratedImage[] = Array.isArray(data?.images)
              ? data.images
              : [];

            if (generatedImages.length === 0) {
              throw new Error("Generation completed without an image.");
            }

            const [firstImage, ...additionalImages] = generatedImages;
            updateImage(id, {
              ...firstImage,
              params: firstImage.params ?? jobParams,
              generation: {
                state: "completed",
                progress: 100,
                message: "Done",
              },
            });

            if (additionalImages.length > 0) {
              addImages(
                additionalImages.map((image) => ({
                  ...image,
                  generation: {
                    state: "completed" as const,
                    progress: 100,
                    message: "Done",
                  },
                }))
              );
            }

            completed = true;
          }

          if (event === "error") {
            throw new Error(data?.error || "Generation failed");
          }
        }
      }

      setStatus({ state: "completed", progress: 100, message: "Done!" });
      setTimeout(() => {
        setStatus({ state: "idle", progress: 0, message: "" });
      }, 2000);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        updateImage(id, {
          generation: {
            state: "canceled",
            progress: 0,
            message: "Canceled.",
          },
        });
        setStatus({ state: "canceled", progress: 0, message: "Canceled." });
        return;
      }

      const message = err instanceof Error ? err.message : "Unknown error";
      updateImage(id, {
        generation: {
          state: "error",
          progress: 0,
          message,
        },
      });
      setStatus({ state: "error", progress: 0, message });
    } finally {
      generationAbortControllerRef.current = null;
      activePromptIdRef.current = "";
      activeGenerationRef.current = null;
      setActiveGeneration(null);
    }
  }, [addImages, setStatus, updateImage]);

  useEffect(() => {
    if (activeGenerationRef.current || activeGeneration || generationQueue.length === 0) {
      return;
    }

    const [nextJob] = generationQueue;
    activeGenerationRef.current = nextJob;
    setGenerationQueue((queue) =>
      queue[0]?.id === nextJob.id ? queue.slice(1) : queue
    );
    setActiveGeneration(nextJob);
    void runGenerationJob(nextJob);
  }, [activeGeneration, generationQueue, runGenerationJob]);

  const generate = useCallback(() => {
    if (!params.prompt.trim()) return;
    if (generationModeError) {
      setStatus({ state: "error", progress: 0, message: generationModeError });
      return;
    }

    const jobParams = cloneGenerationParams(params);
    const id = crypto.randomUUID();

    addImage({
      id,
      url: "",
      filename: "",
      params: jobParams,
      timestamp: Date.now(),
      generation: {
        state: "queued",
        progress: 0,
        message: "Queued",
      },
    });
    setGenerationQueue((queue) => [...queue, { id, params: jobParams }]);
    setStatus({ state: "idle", progress: 0, message: "" });
  }, [addImage, generationModeError, params, setStatus]);

  const cancelGeneration = useCallback((imageId?: string) => {
    const targetId = imageId ?? activeGeneration?.id;

    if (!targetId) return;

    const queuedJob = generationQueue.find((job) => job.id === targetId);

    if (queuedJob) {
      setGenerationQueue((queue) => queue.filter((job) => job.id !== targetId));
      updateImage(targetId, {
        generation: {
          state: "canceled",
          progress: 0,
          message: "Canceled.",
        },
      });
      setStatus({ state: "canceled", progress: 0, message: "Canceled." });
      return;
    }

    const runningJob = activeGenerationRef.current ?? activeGeneration;

    if (runningJob?.id !== targetId) return;

    const promptId = activePromptIdRef.current;

    generationAbortControllerRef.current?.abort();

    if (promptId) {
      void fetch("/api/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      }).catch(() => {});
    }

    updateImage(targetId, {
      generation: {
        state: "canceled",
        progress: 0,
        message: "Canceled.",
      },
    });

    setStatus({ state: "canceled", progress: 0, message: "Canceled." });
  }, [activeGeneration, generationQueue, setStatus, updateImage]);

  const previewPose = useCallback(async () => {
    if (!params.pose_reference_image) return;

    setPosePreviewStatus("Generating pose preview...");
    setPosePreviewUrl(null);
    try {
      const res = await fetch("/api/pose-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: params.pose_reference_image,
          resolution: Math.max(params.width, params.height),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Pose preview failed");
      }

      setPosePreviewUrl(data.url);
      setPosePreviewStatus("");
    } catch (error) {
      setPosePreviewStatus(
        error instanceof Error ? error.message : "Pose preview failed"
      );
    }
  }, [params.pose_reference_image, params.width, params.height]);

  const isGenerating = Boolean(activeGeneration);
  const queuedJobCount = generationQueue.length;

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Left Sidebar - Controls */}
      <aside className="w-[42rem] xl:w-[52rem] max-w-[64vw] border-r border-border flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Image Generation</h1>
          <p className="text-xs text-muted-foreground">{currentModel.name}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Model Selector */}
          <ModelSelector />

          <CivitaiImport />

          <Separator />

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <div className="grid grid-cols-3 gap-1.5 rounded-md border border-border bg-card/80 p-1 shadow-sm">
              {[
                {
                  mode: "text_to_image" as const,
                  label: "Text to Image",
                  icon: ImageIcon,
                },
                {
                  mode: "image_to_image" as const,
                  label: "Image to Image",
                  icon: ImageUp,
                },
                {
                  mode: "pose_reference" as const,
                  label: "Pose Reference",
                  icon: ScanLine,
                },
              ].map((item) => {
                const Icon = item.icon;
                const active = params.generation_mode === item.mode;

                return (
                  <button
                    key={item.mode}
                    type="button"
                    onClick={() => setParams({ generation_mode: item.mode })}
                    className={`flex h-9 items-center justify-center gap-2 rounded px-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Prompt */}
          <div className="grid gap-3 xl:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Prompt</Label>
            <Textarea
              placeholder="Describe the image you want to generate..."
              value={params.prompt}
              onChange={(e) => setParams({ prompt: e.target.value })}
              className="h-36 text-sm resize-none"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">
              Negative Prompt
            </Label>
            <Textarea
              placeholder="What to exclude..."
              value={params.negative_prompt}
              onChange={(e) => setParams({ negative_prompt: e.target.value })}
              className="h-36 text-sm resize-none"
            />
          </div>
          </div>

          {params.generation_mode === "pose_reference" && (
            <>
              <Separator />
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <Label className="text-xs text-muted-foreground">
                      Pose Reference
                    </Label>
                    {!supportsPoseReference && (
                      <span className="text-xs text-yellow-500">
                        Local ComfyUI only
                      </span>
                    )}
                  </div>
                  <ImageUpload
                    label="Pose Image"
                    description="Drop or click to upload a pose reference"
                    value={params.pose_reference_image}
                    onChange={(url) => {
                      setParams({ pose_reference_image: url });
                      setPosePreviewUrl(null);
                      setPosePreviewStatus("");
                    }}
                  />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={previewPose}
                      disabled={!params.pose_reference_image || posePreviewStatus === "Generating pose preview..."}
                    >
                      {posePreviewStatus === "Generating pose preview..."
                        ? "Previewing..."
                        : "Preview Pose"}
                    </Button>
                    {posePreviewStatus && (
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {posePreviewStatus}
                      </span>
                    )}
                  </div>
                  {posePreviewUrl && (
                    <div className="mt-2 overflow-hidden rounded-md border border-border bg-card">
                      <img
                        src={posePreviewUrl}
                        alt="OpenPose preview"
                        className="h-40 w-full object-contain"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-md border border-border bg-card/80 p-3 shadow-sm">
                  <div>
                    <Label className="mb-2 block text-xs text-muted-foreground">
                      ControlNet
                    </Label>
                    {localControlnets.length > 0 ? (
                      <select
                        value={params.pose_reference_model}
                        onChange={(e) =>
                          setParams({ pose_reference_model: e.target.value })
                        }
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        <option value="">Select pose ControlNet...</option>
                        {localControlnets.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={params.pose_reference_model}
                        onChange={(e) =>
                          setParams({ pose_reference_model: e.target.value })
                        }
                        placeholder="openpose controlnet file"
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    )}
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        Strength
                      </Label>
                      <span className="text-xs font-mono">
                        {params.pose_reference_strength.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      value={params.pose_reference_strength}
                      onChange={(e) =>
                        setParams({
                          pose_reference_strength: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-primary"
                    />
                  </div>

                  {generationModeError && (
                    <p className="text-xs text-yellow-500">{generationModeError}</p>
                  )}
                </div>
              </div>
            </>
          )}

          {params.generation_mode === "image_to_image" && (
            <>
              <Separator />
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <div>
                  <Label className="mb-2 block text-xs text-muted-foreground">
                    Source Image
                  </Label>
                  <ImageUpload
                    label="Source Image"
                    description="Drop or click to upload a source image"
                    value={params.source_image}
                    onChange={(url) => setParams({ source_image: url })}
                    onPreview={
                      params.source_image
                        ? () => setSourceImagePreviewOpen(true)
                        : undefined
                    }
                  />
                </div>

                <div className="space-y-3 rounded-md border border-border bg-card/80 p-3 shadow-sm">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">
                        Denoise
                      </Label>
                      <span className="text-xs font-mono">
                        {params.denoise_strength.toFixed(2)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={params.denoise_strength}
                      onChange={(e) =>
                        setParams({
                          denoise_strength: parseFloat(e.target.value),
                        })
                      }
                      className="w-full accent-primary"
                    />
                  </div>

                  {generationModeError && (
                    <p className="text-xs text-yellow-500">{generationModeError}</p>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Reference Images */}
          {(currentModel.supports.ip_adapter || currentModel.supports.face_id) && (
            <>
              <Separator />
              <div className="grid gap-3 xl:grid-cols-2">
                {currentModel.supports.ip_adapter && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      Style Reference
                    </Label>
                    <ImageUpload
                      label="Style Image"
                      description="Drop or click to upload style reference"
                      value={params.style_image}
                      onChange={(url) => setParams({ style_image: url })}
                    />
                  </div>
                )}

                {currentModel.supports.face_id && (
                  <div>
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      Character Reference
                    </Label>
                    <ImageUpload
                      label="Character Image"
                      description="Drop or click to upload character reference"
                      value={params.character_image}
                      onChange={(url) => setParams({ character_image: url })}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {/* Generation Parameters */}
          <GenerationParams />
        </div>

        {/* Generate Button */}
        <div className="p-4 border-t border-border">
          {status.state === "error" && (
            <p className="text-xs text-destructive mb-2">{status.message}</p>
          )}
          {status.state === "completed" && (
            <p className="text-xs text-green-500 mb-2">{status.message}</p>
          )}
          {status.state === "canceled" && (
            <p className="text-xs text-muted-foreground mb-2">{status.message}</p>
          )}
          {(isGenerating || queuedJobCount > 0) && (
            <p className="mb-2 text-xs text-muted-foreground">
              실행 중 {isGenerating ? 1 : 0}개 · 대기 {queuedJobCount}개
            </p>
          )}
          <div
            className={
              isGenerating ? "grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2" : ""
            }
          >
            <Button
              className="relative w-full overflow-hidden"
              size="lg"
              onClick={generate}
              disabled={!params.prompt.trim() || Boolean(generationModeError)}
            >
              <span className="relative z-10 drop-shadow-sm">
                {isGenerating || queuedJobCount > 0 ? "Add to Queue" : "Generate"}
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

      {/* Main Content - Gallery */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium">Gallery</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">가로 columns</span>
              <Slider
                value={[galleryColumns]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setGalleryColumns(val);
                }}
                min={1}
                max={10}
                step={1}
                style={{ width: "50px" }}
              />
              <span className="w-6 text-center text-xs font-mono tabular-nums text-foreground">
                {galleryColumns}
              </span>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {images.length} images
          </span>
        </div>
        <Gallery onCancelGeneration={(image) => cancelGeneration(image.id)} columns={galleryColumns} />
      </main>

      {/* Image Viewer Dialog */}
      <ImageViewer />

      <Dialog
        open={sourceImagePreviewOpen && Boolean(params.source_image)}
        onOpenChange={setSourceImagePreviewOpen}
      >
        <DialogContent className="max-h-[92vh] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-5xl">
          <DialogHeader className="border-b border-border bg-secondary/50 px-5 py-4">
            <DialogTitle>Source Image</DialogTitle>
            <DialogDescription className="truncate">
              {params.source_image}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[calc(92vh-5rem)] items-center justify-center bg-background p-3">
            {params.source_image && (
              <img
                src={params.source_image}
                alt="Source Image"
                className="max-h-[calc(92vh-7rem)] max-w-full object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
