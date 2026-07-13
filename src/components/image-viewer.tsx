"use client";

import { useState } from "react";
import {
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileJson,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { CivitaiOriginModal } from "@/components/civitai-origin-modal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function metadataDownloadFilename(filename: string) {
  return `${filename.replace(/\.[^/.]+$/, "") || "image"}-metadata.json`;
}

export function ImageViewer() {
  const {
    images,
    selectedImage,
    setSelectedImage,
    loadParamsFromImage,
    removeImage,
    language,
  } = useStore();
  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [scrappingImageId, setScrappingImageId] = useState<string | null>(null);
  const [scrappedImageId, setScrappedImageId] = useState<string | null>(null);
  const [imageSizeMode, setImageSizeMode] = useState<{
    imageId: string | null;
    original: boolean;
  }>({ imageId: null, original: false });
  const [downloadPrompt, setDownloadPrompt] = useState<{
    kind: "image" | "metadata";
    filename: string;
  } | null>(null);

  if (!selectedImage) return null;

  const openDownloadPrompt = (kind: "image" | "metadata") => {
    const filename =
      kind === "image"
        ? selectedImage.filename || "image.png"
        : metadataDownloadFilename(selectedImage.filename);
    setDownloadPrompt({ kind, filename });
  };

  const downloadImage = (filename: string) => {
    const a = document.createElement("a");
    a.href = selectedImage.url;
    a.download = filename;
    a.click();
  };

  const downloadMetadata = (filename: string) => {
    if (selectedImage.filename) {
      const a = document.createElement("a");
      a.href = `/api/images/${selectedImage.filename}/metadata`;
      a.download = filename;
      a.click();
      return;
    }

    const metadata = {
      id: selectedImage.id,
      filename: selectedImage.filename,
      url: selectedImage.url,
      timestamp: selectedImage.timestamp,
      createdAt: new Date(selectedImage.timestamp).toISOString(),
      params: selectedImage.params,
    };
    const blob = new Blob([JSON.stringify(metadata, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const confirmDownload = () => {
    if (!downloadPrompt) return;

    const filename = downloadPrompt.filename.trim();
    if (!filename) return;

    if (downloadPrompt.kind === "image") {
      downloadImage(filename);
    } else {
      downloadMetadata(filename);
    }
    setDownloadPrompt(null);
  };

  const handleDelete = async () => {
    await fetch(`/api/images/${selectedImage.filename}`, { method: "DELETE" });
    removeImage(selectedImage.id);
    setSelectedImage(null);
  };

  const handleReuse = () => {
    if (!selectedImage.params) return;

    loadParamsFromImage(selectedImage);
    setSelectedImage(null);
  };

  const handleScrap = async () => {
    if (!selectedImage.params) return;

    setScrappingImageId(selectedImage.id);

    try {
      const response = await fetch("/api/scrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          generatedImage: selectedImage,
          params: selectedImage.params,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to scrap generated image.");
      }

      setScrappedImageId(selectedImage.id);
    } catch {
      setScrappedImageId(null);
    } finally {
      setScrappingImageId(null);
    }
  };

  const params = selectedImage.params;
  const civitaiOrigin = selectedImage.civitaiOrigin;
  const isScrapping = scrappingImageId === selectedImage.id;
  const isScrapped = scrappedImageId === selectedImage.id;
  const isOriginalSize =
    imageSizeMode.imageId === selectedImage.id && imageSizeMode.original;
  const selectedIndex = images.findIndex((image) => image.id === selectedImage.id);
  const previousImage =
    selectedIndex > 0 ? images[selectedIndex - 1] : images.at(-1) ?? null;
  const nextImage =
    selectedIndex >= 0 && selectedIndex < images.length - 1
      ? images[selectedIndex + 1]
      : images[0] ?? null;
  const hasNavigation = images.length > 1;

  const showPreviousImage = () => {
    if (previousImage) setSelectedImage(previousImage);
  };

  const showNextImage = () => {
    if (nextImage) setSelectedImage(nextImage);
  };

  return (
    <>
    <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
      <DialogContent className="!block h-[94vh] max-h-[94vh] w-[96vw] max-w-[96vw] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-[96vw]">
        <DialogTitle className="sr-only">Image Details</DialogTitle>

        <div className="grid h-full w-full grid-cols-[minmax(0,1fr)_minmax(22rem,34rem)] bg-background">
          <div className="relative min-w-0 overflow-auto border-r border-border bg-[radial-gradient(circle_at_1px_1px,color-mix(in_oklch,var(--border)_55%,transparent)_1px,transparent_0)] [background-size:24px_24px]">
            {hasNavigation && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={showPreviousImage}
                  className="absolute left-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
                  aria-label="Previous image"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={showNextImage}
                  className="absolute right-4 top-1/2 z-10 h-11 w-11 -translate-y-1/2 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
                  aria-label="Next image"
                >
                  <ChevronRight className="h-5 w-5" />
                </Button>
              </>
            )}
            <div className="flex h-full min-h-0 min-w-full p-6">
              <button
                type="button"
                onClick={() =>
                  setImageSizeMode((current) => ({
                    imageId: selectedImage.id,
                    original:
                      current.imageId === selectedImage.id ? !current.original : true,
                  }))
                }
                className={`m-auto rounded-lg border border-border bg-card p-2 shadow-lg ${
                  isOriginalSize
                    ? "cursor-zoom-out"
                    : "flex max-h-full max-w-full cursor-zoom-in"
                }`}
                aria-label={
                  isOriginalSize ? "Show fitted image" : "Show original size image"
                }
              >
                <img
                  src={selectedImage.url}
                  alt="Generated"
                  className={
                    isOriginalSize
                      ? "block h-auto max-h-none w-auto max-w-none rounded-md"
                      : "block h-auto max-h-[calc(94vh-4rem)] max-w-full rounded-md object-contain"
                  }
                />
              </button>
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
              <Button size="sm" onClick={handleReuse} disabled={!params}>
                <RotateCcw className="h-4 w-4" />
                Reuse
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDownloadPrompt("image")}
              >
                <Download className="h-4 w-4" />
                Download
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openDownloadPrompt("metadata")}
              >
                <FileJson className="h-4 w-4" />
                Metadata
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleScrap()}
                disabled={!params || isScrapping}
              >
                {isScrapped ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <BookmarkPlus className="h-4 w-4" />
                )}
                Scrap
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

                {civitaiOrigin && (
                  <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {language === "ko" ? "원본 Civitai 이미지" : "Original Civitai image"}
                    </h3>
                    <div className="mt-3 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setOriginModalOpen(true)}
                        className="h-24 w-24 shrink-0 overflow-hidden rounded-md border border-border transition-colors hover:border-primary/50"
                        aria-label={
                          language === "ko"
                            ? "원본 Civitai 이미지 크게 보기"
                            : "View original Civitai image"
                        }
                      >
                        <img
                          src={civitaiOrigin.imageUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </button>
                      <div className="flex min-w-0 flex-col justify-center gap-1.5 text-xs">
                        {civitaiOrigin.username && (
                          <span className="truncate text-muted-foreground">
                            {language === "ko" ? "작성자" : "By"}{" "}
                            <span className="font-medium text-foreground">
                              {civitaiOrigin.username}
                            </span>
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {language === "ko"
                            ? "이 이미지는 이 스크랩을 그대로 생성했습니다."
                            : "Generated from this scrap unchanged."}
                        </span>
                        {civitaiOrigin.pageUrl && (
                          <a
                            href={civitaiOrigin.pageUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-fit items-center gap-1 font-medium text-primary hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {language === "ko" ? "Civitai에서 보기" : "View on Civitai"}
                          </a>
                        )}
                      </div>
                    </div>
                  </section>
                )}

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

    <Dialog
      open={!!downloadPrompt}
      onOpenChange={(open) => {
        if (!open) setDownloadPrompt(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {downloadPrompt?.kind === "metadata"
              ? "메타데이터 다운로드"
              : "이미지 다운로드"}
          </DialogTitle>
          <DialogDescription>
            저장할 파일명을 입력하세요.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirmDownload();
          }}
        >
          <Input
            autoFocus
            value={downloadPrompt?.filename ?? ""}
            onChange={(event) =>
              setDownloadPrompt((current) =>
                current ? { ...current, filename: event.target.value } : current
              )
            }
            onFocus={(event) => {
              const dotIndex = event.target.value.lastIndexOf(".");
              event.target.setSelectionRange(
                0,
                dotIndex > 0 ? dotIndex : event.target.value.length
              );
            }}
          />
          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDownloadPrompt(null)}
            >
              취소
            </Button>
            <Button type="submit" disabled={!downloadPrompt?.filename.trim()}>
              <Download className="h-4 w-4" />
              다운로드
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <CivitaiOriginModal
      origin={civitaiOrigin ?? null}
      open={originModalOpen}
      onOpenChange={setOriginModalOpen}
      language={language}
    />
    </>
  );
}
