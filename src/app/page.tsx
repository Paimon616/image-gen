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
import { ImageIcon, ScanLine } from "lucide-react";

function choosePoseControlNet(controlnets: string[]) {
  return (
    controlnets.find((model) => /open\s*pose|openpose|pose/i.test(model)) ??
    controlnets[0] ??
    ""
  );
}

export default function Home() {
  const { params, setParams, status, setStatus, addImage, images } = useStore();
  const [localControlnets, setLocalControlnets] = useState<string[]>([]);

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
  const poseReferenceError = useMemo(() => {
    if (params.generation_mode !== "pose_reference") return "";
    if (!supportsPoseReference) {
      return "Pose Reference mode requires Local ComfyUI.";
    }
    if (!params.pose_reference_image) {
      return "Add a pose reference image before generating.";
    }
    if (!params.pose_reference_model.trim()) {
      return "Select an OpenPose/pose ControlNet model first.";
    }
    return "";
  }, [
    params.generation_mode,
    params.pose_reference_image,
    params.pose_reference_model,
    supportsPoseReference,
  ]);

  const generate = useCallback(async () => {
    if (!params.prompt.trim()) return;
    if (poseReferenceError) {
      setStatus({ state: "error", progress: 0, message: poseReferenceError });
      return;
    }

    setStatus({ state: "generating", progress: 0, message: "Generating..." });

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Generation failed");
      }

      if (data.images) {
        data.images.forEach(addImage);
      }

      setStatus({ state: "completed", progress: 100, message: "Done!" });
      setTimeout(() => setStatus({ state: "idle", progress: 0, message: "" }), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setStatus({ state: "error", progress: 0, message });
    }
  }, [params, poseReferenceError, setStatus, addImage]);

  const isGenerating = status.state === "generating";

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
            <div className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-card/30 p-1">
              {[
                {
                  mode: "text_to_image" as const,
                  label: "Text to Image",
                  icon: ImageIcon,
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
                    onChange={(url) => setParams({ pose_reference_image: url })}
                  />
                </div>

                <div className="space-y-3 rounded-md border border-border bg-card/30 p-3">
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

                  {poseReferenceError && (
                    <p className="text-xs text-yellow-500">{poseReferenceError}</p>
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
            className="w-full"
            size="lg"
            onClick={generate}
            disabled={isGenerating || !params.prompt.trim() || Boolean(poseReferenceError)}
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Generating...
              </span>
            ) : (
              "Generate"
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
