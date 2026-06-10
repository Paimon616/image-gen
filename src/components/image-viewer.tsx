"use client";

import { useStore } from "@/lib/store";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getModelConfig } from "@/lib/types";

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

  return (
    <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
      <DialogContent className="!block h-[96vh] max-h-[96vh] w-[96vw] max-w-[96vw] overflow-hidden bg-black p-0 sm:max-w-[96vw]">
        <DialogTitle className="sr-only">Image Details</DialogTitle>
        <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)]">
          <div className="relative min-w-0 overflow-auto">
            <div className="flex min-h-full min-w-full p-4 pr-6">
              <img
                src={selectedImage.url}
                alt="Generated"
                className="m-auto block h-auto max-h-none w-auto max-w-none shrink-0"
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col border-l border-white/10 bg-black/85 text-white">
            <div className="flex flex-wrap gap-2 p-4 pr-12">
              <Button size="sm" onClick={handleReuse}>
                Reuse Params
              </Button>
              <Button size="sm" variant="secondary" onClick={handleDownload}>
                Download
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            </div>
            {selectedImage.params && (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 pt-0 text-sm">
                <div>
                  <span className="text-xs text-white/60">Prompt</span>
                  <p className="mt-1">{selectedImage.params.prompt}</p>
                </div>
                {selectedImage.params.negative_prompt && (
                  <div>
                    <span className="text-xs text-white/60">
                      Negative Prompt
                    </span>
                    <p className="mt-1 text-xs text-white/60">
                      {selectedImage.params.negative_prompt}
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {selectedImage.params.model && (
                    <Badge variant="outline">
                      {getModelConfig(selectedImage.params.model).name}
                    </Badge>
                  )}
                  <Badge variant="secondary">
                    {selectedImage.params.width}×{selectedImage.params.height}
                  </Badge>
                  <Badge variant="secondary">
                    Steps: {selectedImage.params.num_inference_steps}
                  </Badge>
                  <Badge variant="secondary">
                    CFG: {selectedImage.params.guidance_scale}
                  </Badge>
                  {selectedImage.params.seed != null && (
                    <Badge variant="secondary">
                      Seed: {selectedImage.params.seed}
                    </Badge>
                  )}
                </div>
                {selectedImage.params.loras?.length > 0 && (
                  <div>
                    <span className="text-xs text-white/60">LoRAs</span>
                    {selectedImage.params.loras.map(
                      (l: { path: string; scale: number }, i: number) => (
                        <p key={i} className="mt-1 text-xs font-mono">
                          {l.path} ({l.scale})
                        </p>
                      )
                    )}
                  </div>
                )}
                <div className="text-xs text-white/60">
                  {new Date(selectedImage.timestamp).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
