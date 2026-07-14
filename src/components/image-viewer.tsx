"use client";

import { useEffect, useRef, useState } from "react";
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
  Wand2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { CivitaiOriginModal } from "@/components/civitai-origin-modal";
import { ModelMediaThumbnail } from "@/components/model-media-thumbnail";
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
import { getModelConfig, type GenerationParams } from "@/lib/types";

interface LocalModelAsset {
  path: string;
  name: string;
  version: string;
  base_model: string;
  thumbnail_url: string | null;
}

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
  action,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        {action}
      </div>
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

function ApplyButton({
  applied,
  label,
  appliedLabel,
  onClick,
}: {
  applied: boolean;
  label: string;
  appliedLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 shrink-0 gap-1 px-2 text-xs"
      onClick={onClick}
    >
      {applied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Wand2 className="h-3.5 w-3.5" />
      )}
      {applied ? appliedLabel : label}
    </Button>
  );
}

function ModelRow({
  asset,
  name,
  subtitle,
  action,
}: {
  asset: LocalModelAsset | undefined;
  name: string;
  subtitle?: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
      <ModelMediaThumbnail
        src={asset?.thumbnail_url}
        alt={name}
        fallback={name.slice(0, 2).toUpperCase() || "M"}
        className="h-11 w-11 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{name}</div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {action}
    </div>
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
    setParams,
    removeImage,
    language,
  } = useStore();
  const ko = language === "ko";
  const [originModalOpen, setOriginModalOpen] = useState(false);
  const [modelAssets, setModelAssets] = useState<{
    checkpointAssets: LocalModelAsset[];
    loraAssets: LocalModelAsset[];
    embeddingAssets: LocalModelAsset[];
  }>({ checkpointAssets: [], loraAssets: [], embeddingAssets: [] });
  const [appliedKey, setAppliedKey] = useState<string | null>(null);
  const appliedTimer = useRef<number | null>(null);
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

  useEffect(() => {
    fetch("/api/models", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) =>
        setModelAssets({
          checkpointAssets: data.checkpointAssets ?? [],
          loraAssets: data.loraAssets ?? [],
          embeddingAssets: data.embeddingAssets ?? [],
        })
      )
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (appliedTimer.current) window.clearTimeout(appliedTimer.current);
  }, []);

  const applyPartial = (key: string, update: Partial<GenerationParams>) => {
    setParams(update);
    if (appliedTimer.current) window.clearTimeout(appliedTimer.current);
    setAppliedKey(key);
    appliedTimer.current = window.setTimeout(() => setAppliedKey(null), 1500);
  };

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

  const applyLora = (lora: { path: string; scale: number }) => {
    const current = useStore.getState().params;
    const loras = current.loras.some((item) => item.path === lora.path)
      ? current.loras.map((item) =>
          item.path === lora.path ? { ...item, scale: lora.scale } : item
        )
      : [...current.loras, lora];
    applyPartial(`lora-${lora.path}`, { loras });
  };

  const applyEmbedding = (embedding: { path: string; tokens: string }) => {
    const current = useStore.getState().params;
    const embeddings = current.embeddings.some(
      (item) => item.path === embedding.path
    )
      ? current.embeddings.map((item) =>
          item.path === embedding.path ? { ...item, tokens: embedding.tokens } : item
        )
      : [...current.embeddings, embedding];
    applyPartial(`embedding-${embedding.path}`, { embeddings });
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
  const referenceImages = params
    ? [
        {
          key: "source_image",
          label: ko ? "소스 (이미지→이미지)" : "Source (image-to-image)",
          url: params.source_image,
        },
        {
          key: "pose_reference_image",
          label: ko ? "포즈 레퍼런스" : "Pose reference",
          url: params.pose_reference_image,
        },
        { key: "style_image", label: ko ? "스타일" : "Style", url: params.style_image },
        {
          key: "character_image",
          label: ko ? "캐릭터" : "Character",
          url: params.character_image,
        },
      ].filter((item) => item.url)
    : [];
  const findAsset = (assets: LocalModelAsset[], path: string) =>
    assets.find((asset) => asset.path === path);
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
                <TextSection
                  label="Prompt"
                  action={
                    params.prompt ? (
                      <ApplyButton
                        applied={appliedKey === "prompt"}
                        label={ko ? "적용" : "Apply"}
                        appliedLabel={ko ? "적용됨" : "Applied"}
                        onClick={() => applyPartial("prompt", { prompt: params.prompt })}
                      />
                    ) : undefined
                  }
                >
                  {params.prompt || "No prompt"}
                </TextSection>

                {params.negative_prompt && (
                  <TextSection
                    label="Negative Prompt"
                    muted
                    action={
                      <ApplyButton
                        applied={appliedKey === "negative_prompt"}
                        label={ko ? "적용" : "Apply"}
                        appliedLabel={ko ? "적용됨" : "Applied"}
                        onClick={() =>
                          applyPartial("negative_prompt", {
                            negative_prompt: params.negative_prompt,
                          })
                        }
                      />
                    }
                  >
                    {params.negative_prompt}
                  </TextSection>
                )}

                <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {ko ? "생성 정보" : "Generation"}
                    </h3>
                    <ApplyButton
                      applied={appliedKey === "generation"}
                      label={ko ? "적용" : "Apply"}
                      appliedLabel={ko ? "적용됨" : "Applied"}
                      onClick={() =>
                        applyPartial("generation", {
                          width: params.width,
                          height: params.height,
                          num_inference_steps: params.num_inference_steps,
                          guidance_scale: params.guidance_scale,
                          sampler_name: params.sampler_name,
                          scheduler: params.scheduler,
                          clip_skip: params.clip_skip,
                          seed: params.seed,
                          generation_mode: params.generation_mode,
                        })
                      }
                    />
                  </div>
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
                </section>

                <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {ko ? "모델" : "Models"}
                  </h3>
                  <div className="mt-3 space-y-2">
                    {params.model_name && (
                      <ModelRow
                        asset={findAsset(modelAssets.checkpointAssets, params.model_name)}
                        name={
                          findAsset(modelAssets.checkpointAssets, params.model_name)?.name ??
                          params.model_name
                        }
                        subtitle={`${getModelConfig(params.model).name} · ${
                          ko ? "체크포인트" : "Checkpoint"
                        }`}
                        action={
                          <ApplyButton
                            applied={appliedKey === "checkpoint"}
                            label={ko ? "적용" : "Apply"}
                            appliedLabel={ko ? "적용됨" : "Applied"}
                            onClick={() =>
                              applyPartial("checkpoint", {
                                model: params.model,
                                model_name: params.model_name,
                              })
                            }
                          />
                        }
                      />
                    )}

                    {params.loras?.map((lora, index) => (
                      <ModelRow
                        key={`lora-${lora.path}-${index}`}
                        asset={findAsset(modelAssets.loraAssets, lora.path)}
                        name={
                          findAsset(modelAssets.loraAssets, lora.path)?.name ?? lora.path
                        }
                        subtitle={`LoRA · Weight ${lora.scale}`}
                        action={
                          <ApplyButton
                            applied={appliedKey === `lora-${lora.path}`}
                            label={ko ? "적용" : "Apply"}
                            appliedLabel={ko ? "적용됨" : "Applied"}
                            onClick={() => applyLora(lora)}
                          />
                        }
                      />
                    ))}

                    {params.embeddings?.map((embedding, index) => (
                      <ModelRow
                        key={`embedding-${embedding.path}-${index}`}
                        asset={findAsset(modelAssets.embeddingAssets, embedding.path)}
                        name={
                          findAsset(modelAssets.embeddingAssets, embedding.path)?.name ??
                          embedding.path
                        }
                        subtitle={
                          embedding.tokens
                            ? `Embedding · ${embedding.tokens}`
                            : "Embedding"
                        }
                        action={
                          <ApplyButton
                            applied={appliedKey === `embedding-${embedding.path}`}
                            label={ko ? "적용" : "Apply"}
                            appliedLabel={ko ? "적용됨" : "Applied"}
                            onClick={() => applyEmbedding(embedding)}
                          />
                        }
                      />
                    ))}

                    {params.upscale_model_name && (
                      <ModelRow
                        asset={undefined}
                        name={params.upscale_model_name}
                        subtitle={ko ? "업스케일러" : "Upscaler"}
                        action={
                          <ApplyButton
                            applied={appliedKey === "upscaler"}
                            label={ko ? "적용" : "Apply"}
                            appliedLabel={ko ? "적용됨" : "Applied"}
                            onClick={() =>
                              applyPartial("upscaler", {
                                upscale_model_name: params.upscale_model_name,
                              })
                            }
                          />
                        }
                      />
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

                {referenceImages.length > 0 && (
                  <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {ko ? "레퍼런스 이미지" : "Reference Images"}
                    </h3>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {referenceImages.map((reference) => (
                        <div key={reference.key} className="space-y-1.5">
                          <div className="overflow-hidden rounded-md border border-border bg-background">
                            <img
                              src={reference.url as string}
                              alt={reference.label}
                              className="aspect-square w-full object-cover"
                            />
                          </div>
                          <div className="truncate text-xs font-medium text-muted-foreground">
                            {reference.label}
                          </div>
                        </div>
                      ))}
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
