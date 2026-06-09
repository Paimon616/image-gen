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
      <DialogContent className="h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden p-3">
        <DialogTitle className="sr-only">Image Details</DialogTitle>
        <div className="grid h-full min-h-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-h-0 min-w-0 items-center justify-center overflow-auto rounded-lg bg-black/5">
            <img
              src={selectedImage.url}
              alt="Generated"
              className="h-auto max-h-full w-auto max-w-full object-contain"
            />
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            <div className="flex gap-2 flex-wrap">
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
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">Prompt</span>
                  <p className="mt-1">{selectedImage.params.prompt}</p>
                </div>
                {selectedImage.params.negative_prompt && (
                  <div>
                    <span className="text-muted-foreground text-xs">
                      Negative Prompt
                    </span>
                    <p className="mt-1 text-muted-foreground text-xs">
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
                    <span className="text-muted-foreground text-xs">LoRAs</span>
                    {selectedImage.params.loras.map(
                      (l: { path: string; scale: number }, i: number) => (
                        <p key={i} className="text-xs font-mono mt-1">
                          {l.path} ({l.scale})
                        </p>
                      )
                    )}
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
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
