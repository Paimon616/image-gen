"use client";

import { useCallback } from "react";
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

export default function Home() {
  const { params, setParams, status, setStatus, addImage, images } = useStore();

  const generate = useCallback(async () => {
    if (!params.prompt.trim()) return;

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
  }, [params, setStatus, addImage]);

  const isGenerating = status.state === "generating";
  const currentModel = getModelConfig(params.model);

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
            disabled={isGenerating || !params.prompt.trim()}
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
