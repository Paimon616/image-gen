"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ImageUpload } from "@/components/image-upload";
import { GenerationParams } from "@/components/generation-params";
import { ModelSelector } from "@/components/model-selector";
import { Gallery } from "@/components/gallery";
import { ImageViewer } from "@/components/image-viewer";
import { AppSidebar } from "@/components/app-sidebar";
import { getModelConfig } from "@/lib/types";
import { ImageIcon, ImageUp, ScanLine } from "lucide-react";

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

export default function Home() {
  const { params, setParams, status, setStatus, addImage, images } = useStore();
  const [localControlnets, setLocalControlnets] = useState<string[]>([]);
  const [buttonProgress, setButtonProgress] = useState(0);
  const [posePreviewUrl, setPosePreviewUrl] = useState<string | null>(null);
  const [posePreviewStatus, setPosePreviewStatus] = useState("");

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

  const generate = useCallback(async () => {
    if (!params.prompt.trim()) return;
    if (generationModeError) {
      setStatus({ state: "error", progress: 0, message: generationModeError });
      return;
    }

    setButtonProgress(1);
    setStatus({ state: "generating", progress: 1, message: "Queued..." });

    try {
      const res = await fetch("/api/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
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

          if (event === "progress") {
            const progress = Number(data?.progress ?? 0);
            const message = String(data?.message ?? "Generating...");
            setButtonProgress(progress);
            setStatus({ state: "generating", progress, message });
          }

          if (event === "complete") {
            if (data?.images) {
              data.images.forEach(addImage);
            }
            completed = true;
          }

          if (event === "error") {
            throw new Error(data?.error || "Generation failed");
          }
        }
      }

      setButtonProgress(100);
      setStatus({ state: "completed", progress: 100, message: "Done!" });
      setTimeout(() => {
        setButtonProgress(0);
        setStatus({ state: "idle", progress: 0, message: "" });
      }, 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setButtonProgress(0);
      setStatus({ state: "error", progress: 0, message });
    }
  }, [params, generationModeError, setStatus, addImage]);

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

  const isGenerating = status.state === "generating";
  const generateButtonProgress = isGenerating
    ? Math.max(buttonProgress, status.progress)
    : status.state === "completed"
      ? 100
      : 0;

  return (
    <div className="flex h-screen bg-background">
      <AppSidebar />

      {/* Left Sidebar - Controls */}
      <aside className="w-[42rem] xl:w-[52rem] max-w-[64vw] border-r border-border flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h1 className="text-lg font-semibold">Image Gen</h1>
          <p className="text-xs text-muted-foreground">{currentModel.name}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Model Selector */}
          <ModelSelector />

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
          <Button
            className="relative w-full overflow-hidden"
            size="lg"
            onClick={generate}
            disabled={isGenerating || !params.prompt.trim() || Boolean(generationModeError)}
            aria-busy={isGenerating}
          >
            <span
              className="absolute inset-y-0 left-0 bg-emerald-400 transition-[width] duration-500 ease-out"
              style={{ width: `${generateButtonProgress}%` }}
              aria-hidden="true"
            />
            <span className="absolute inset-0 bg-black/10 opacity-0 transition-opacity group-disabled/button:opacity-100" />
            {isGenerating ? (
              <span className="relative z-10 flex min-w-0 items-center gap-2">
                <span className="tabular-nums">
                  {Math.round(generateButtonProgress)}%
                </span>
                <span>Generating...</span>
              </span>
            ) : (
              <span className="relative z-10">
                {status.state === "completed" ? "Done" : "Generate"}
              </span>
            )}
          </Button>
        </div>
      </aside>

      {/* Main Content - Gallery */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-medium">Gallery</h2>
          <span className="text-xs text-muted-foreground">
            {images.length} images
          </span>
        </div>
        <Gallery />
      </main>

      {/* Image Viewer Dialog */}
      <ImageViewer />
    </div>
  );
}
