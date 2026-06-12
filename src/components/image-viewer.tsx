"use client";

import { Download, RotateCcw, Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getModelConfig } from "@/lib/types";

function MetadataRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-foreground">
        {value}
      </div>
    </div>
  );
}

function TextSection({
  label,
  children,
  muted = false,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div
        className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${
          muted ? "text-muted-foreground" : "text-foreground"
        }`}
      >
        {children}
      </div>
    </section>
  );
}

export function ImageViewer() {
  const { selectedImage, setSelectedImage, loadParamsFromImage, removeImage } =
    useStore();

  if (!selectedImage) return null;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = selectedImage.url;
    a.download = selectedImage.filename;
    a.click();
  };

  const handleDelete = async () => {
    await fetch(`/api/images/${selectedImage.filename}`, { method: "DELETE" });
    removeImage(selectedImage.id);
    setSelectedImage(null);
  };

  const handleReuse = () => {
    loadParamsFromImage(selectedImage);
    setSelectedImage(null);
  };

  const params = selectedImage.params;

  return (
    <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
      <DialogContent className="!block h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-[96vw]">
        <DialogTitle className="sr-only">Image Details</DialogTitle>

        <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] bg-background">
          <div className="relative min-w-0 overflow-auto border-r border-border bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--border)_55%,transparent)_1px,transparent_0)] [background-size:24px_24px]">
            <div className="flex min-h-full min-w-full p-6">
              <div className="m-auto rounded-lg border border-border bg-card p-2 shadow-lg">
                <img
                  src={selectedImage.url}
                  alt="Generated"
                  className="block h-auto max-h-none w-auto max-w-none rounded-md"
                />
              </div>
            </div>
          </div>

          <aside className="flex min-h-0 flex-col bg-card">
            <header className="border-b border-border bg-secondary/50 px-5 py-4 pr-12">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                Generated Image
              </div>
              <div className="mt-1 truncate text-sm font-semibold text-foreground">
                {selectedImage.filename}
              </div>
              <div className="mt-1 text-xs font-medium text-muted-foreground">
                {new Date(selectedImage.timestamp).toLocaleString()}
              </div>
            </header>

            <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
              <Button size="sm" onClick={handleReuse}>
                <RotateCcw className="h-4 w-4" />
                Reuse
              </Button>
              <Button size="sm" variant="outline" onClick={handleDownload}>
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>

            {params && (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background/70 p-5">
                <TextSection label="Prompt">{params.prompt || "No prompt"}</TextSection>

                {params.negative_prompt && (
                  <TextSection label="Negative Prompt" muted>
                    {params.negative_prompt}
                  </TextSection>
                )}

                <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Generation
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MetadataRow label="Size" value={`${params.width} x ${params.height}`} />
                    <MetadataRow label="Steps" value={params.num_inference_steps} />
                    <MetadataRow label="CFG" value={params.guidance_scale} />
                    <MetadataRow label="Sampler" value={params.sampler_name} />
                    {params.seed != null && (
                      <MetadataRow label="Seed" value={params.seed} />
                    )}
                    <MetadataRow label="Mode" value={params.generation_mode} />
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {params.model && (
                      <Badge
                        variant="outline"
                        className="rounded-md border-primary/25 bg-primary/10 text-primary"
                      >
                        {getModelConfig(params.model).name}
                      </Badge>
                    )}
                    {params.model_name && (
                      <Badge variant="secondary" className="rounded-md">
                        {params.model_name}
                      </Badge>
                    )}
                    {params.upscale_model_name && (
                      <Badge
                        variant="outline"
                        className="rounded-md border-accent/35 bg-accent/10 text-accent-foreground"
                      >
                        Upscaler: {params.upscale_model_name}
                      </Badge>
                    )}
                  </div>
                </section>

                {params.loras?.length > 0 && (
                  <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      LoRA
                    </h3>
                    <div className="mt-2 space-y-2">
                      {params.loras.map(
                        (lora: { path: string; scale: number }, index: number) => (
                          <div
                            key={`${lora.path}-${index}`}
                            className="rounded-md border border-border bg-background px-3 py-2"
                          >
                            <div className="truncate text-xs font-mono text-foreground">
                              {lora.path}
                            </div>
                            <div className="mt-1 text-xs font-semibold text-muted-foreground">
                              Weight {lora.scale}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </section>
                )}
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
