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
      <DialogContent className="!block h-[96vh] max-h-[96vh] w-[96vw] max-w-[96vw] overflow-hidden bg-black p-0">
        <DialogTitle className="sr-only">Image Details</DialogTitle>
        <div className="relative h-full w-full">
          <img
            src={selectedImage.url}
            alt="Generated"
            className="absolute inset-0 m-auto block h-auto max-h-full w-auto max-w-full object-contain"
          />

          <div className="absolute left-4 top-4 right-20 flex gap-2 flex-wrap">
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

          <div className="absolute bottom-4 left-4 max-h-[40vh] w-[min(34rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-white/10 bg-black/75 p-4 text-white shadow-xl backdrop-blur">
            {selectedImage.params && (
              <div className="space-y-3 text-sm">
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
