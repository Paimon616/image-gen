"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  RotateCcw,
  Trash2,
  Wand2,
} from "lucide-react";
import { useStore } from "@/lib/store";
import { CivitaiOriginModal } from "@/components/civitai-origin-modal";
import { CopyLinkButton } from "@/components/copy-link-button";
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
  civitai_url?: string | null;
  source_url?: string | null;
  tags?: string[];
}

function MetadataRow({
  label,
  value,
  applied,
  onApply,
  applyTitle,
  appliedTitle,
}: {
  label: string;
  value: string | number;
  applied?: boolean;
  onApply?: () => void;
  applyTitle?: string;
  appliedTitle?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center justify-between gap-1">
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            title={applied ? appliedTitle : applyTitle}
            aria-label={applied ? appliedTitle : applyTitle}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {applied ? (
              <Check className="h-3 w-3 text-primary" />
            ) : (
              <Wand2 className="h-3 w-3" />
            )}
          </button>
        )}
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

function CopyIconButton({
  value,
  label,
  copiedLabel,
}: {
  value: string;
  label: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 shrink-0 gap-1 px-2 text-xs"
      onClick={handleClick}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-primary" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? copiedLabel : label}
    </Button>
  );
}

function ModelRow({
  asset,
  name,
  subtitle,
  action,
  onView,
}: {
  asset: LocalModelAsset | undefined;
  name: string;
  subtitle?: string;
  action: React.ReactNode;
  onView?: () => void;
}) {
  return (
    <div
      role={onView ? "button" : undefined}
      tabIndex={onView ? 0 : undefined}
      onClick={onView}
      onKeyDown={(event) => {
        if (onView && (event.key === "Enter" || event.key === " ")) onView();
      }}
      className={onView ? "flex cursor-pointer items-center gap-3 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:border-primary/50 hover:bg-accent/40" : "flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2"}
    >
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
      <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{action}</div>
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
  const [actualImageSize, setActualImageSize] = useState({ width: 0, height: 0 });
  const [modelInfo, setModelInfo] = useState<{
    asset?: LocalModelAsset;
    name: string;
    subtitle?: string;
  } | null>(null);
  const [modelAssets, setModelAssets] = useState<{
    checkpointAssets: LocalModelAsset[];
    loraAssets: LocalModelAsset[];
    embeddingAssets: LocalModelAsset[];
    upscalerAssets: LocalModelAsset[];
  }>({ checkpointAssets: [], loraAssets: [], embeddingAssets: [], upscalerAssets: [] });
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
          upscalerAssets: data.upscaleModelAssets ?? [],
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

  const metadataText = async () => {
    if (selectedImage.filename) {
      const response = await fetch("/api/images/" + selectedImage.filename + "/metadata");
      if (response.ok) return response.text();
    }

    return JSON.stringify(
      {
        id: selectedImage.id,
        filename: selectedImage.filename,
        url: selectedImage.url,
        timestamp: selectedImage.timestamp,
        createdAt: new Date(selectedImage.timestamp).toISOString(),
        params: selectedImage.params,
      },
      null,
      2
    );
  };

  const copyMetadata = async () => {
    await navigator.clipboard.writeText(await metadataText());
    setAppliedKey("metadata-copied");
    window.setTimeout(() => setAppliedKey(null), 1500);
  };

  const copyImage = async () => {
    const response = await fetch(selectedImage.url);
    const sourceBlob = await response.blob();
    let clipboardBlob = sourceBlob;

    if (sourceBlob.type !== "image/png") {
      const bitmap = await createImageBitmap(sourceBlob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
      bitmap.close();
      clipboardBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error("Image conversion failed"))),
          "image/png"
        )
      );
    }

    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": clipboardBlob }),
    ]);
    setAppliedKey("image-copied");
    window.setTimeout(() => setAppliedKey(null), 1500);
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
  const displayHiresScale =
    params && Number.isFinite(params.hires_upscale) && params.hires_upscale > 1
      ? params.hires_upscale
      : 1;
  const generationWidth = params
    ? selectedImage.sizeSemantics === "final"
      ? Math.max(8, Math.floor(params.width / displayHiresScale / 8) * 8)
      : params.width
    : 0;
  const generationHeight = params
    ? selectedImage.sizeSemantics === "final"
      ? Math.max(8, Math.floor(params.height / displayHiresScale / 8) * 8)
      : params.height
    : 0;
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => openDownloadPrompt("image")}
              className="absolute right-4 top-4 z-10 h-11 w-11 rounded-full bg-card/90 shadow-lg backdrop-blur hover:bg-card"
              aria-label={ko ? "이미지 다운로드" : "Download image"}
              title={ko ? "이미지 다운로드" : "Download image"}
            >
              <Download className="h-5 w-5" />
            </Button>
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
                  onLoad={(event) => setActualImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
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
              <Button size="sm" variant="outline" onClick={() => void copyImage()}>
                {appliedKey === "image-copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {ko ? "이미지 복사" : "Copy image"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void copyMetadata()}>
                {appliedKey === "metadata-copied" ? <Check className="h-4 w-4" /> : <FileJson className="h-4 w-4" />}
                {ko ? "메타데이터 복사" : "Copy metadata"}
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
                      <div className="flex shrink-0 items-center gap-1">
                        <CopyIconButton
                          value={params.prompt}
                          label={ko ? "복사" : "Copy"}
                          copiedLabel={ko ? "복사됨" : "Copied"}
                        />
                        <ApplyButton
                          applied={appliedKey === "prompt"}
                          label={ko ? "적용" : "Apply"}
                          appliedLabel={ko ? "적용됨" : "Applied"}
                          onClick={() => applyPartial("prompt", { prompt: params.prompt })}
                        />
                      </div>
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
                      <div className="flex shrink-0 items-center gap-1">
                        <CopyIconButton
                          value={params.negative_prompt}
                          label={ko ? "복사" : "Copy"}
                          copiedLabel={ko ? "복사됨" : "Copied"}
                        />
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
                      </div>
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
                          backend: params.backend,
                          width: params.width,
                          height: params.height,
                          num_inference_steps: params.num_inference_steps,
                          guidance_scale: params.guidance_scale,
                          sampler_name: params.sampler_name,
                          scheduler: params.scheduler,
                          clip_skip: params.clip_skip,
                          seed: params.seed,
                          generation_mode: params.generation_mode,
                          num_images: params.num_images,
                          output_format: params.output_format,
                          vae_name: params.vae_name,
                          prompt_weighting: params.prompt_weighting,
                          enable_safety_checker: params.enable_safety_checker,
                        })
                      }
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MetadataRow
                      label={ko ? "생성 백엔드" : "Generation backend"}
                      value={params.backend === "a1111" ? "AUTOMATIC1111" : params.backend === "forge" ? "ForgeUI" : "ComfyUI"}
                      applied={appliedKey === "backend"}
                      applyTitle={ko ? "백엔드 적용" : "Apply backend"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() => applyPartial("backend", { backend: params.backend })}
                    />
                    <MetadataRow
                      label={ko ? "출력 형식" : "Output format"}
                      value={(params.output_format || "png").toUpperCase()}
                      applied={appliedKey === "output-format"}
                      applyTitle={ko ? "출력 형식 적용" : "Apply output format"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() => applyPartial("output-format", { output_format: params.output_format })}
                    />
                    <MetadataRow
                      label={ko ? "생성 이미지 크기" : "Generation size"}
                      value={generationWidth + " × " + generationHeight}
                      applied={appliedKey === "size"}
                      applyTitle={ko ? "적용" : "Apply"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() =>
                        applyPartial("size", {
                          width: params.width,
                          height: params.height,
                        })
                      }
                    />
                    <MetadataRow
                      label={ko ? "최종 이미지 크기" : "Final image size"}
                      value={
                        actualImageSize.width && actualImageSize.height
                          ? actualImageSize.width + " × " + actualImageSize.height
                          : selectedImage.sizeSemantics === "final"
                            ? params.width + " × " + params.height
                            : Math.round(params.width * displayHiresScale) + " × " + Math.round(params.height * displayHiresScale)
                      }
                    />
                    {params.hires_upscale > 1 && (
                      <>
                        {params.upscale_model_name && (
                          <MetadataRow label={ko ? "업스케일러" : "Upscaler"} value={params.upscale_model_name} />
                        )}
                        <MetadataRow label={ko ? "업스케일 배율" : "Upscale factor"} value={params.hires_upscale + "×"} />
                        <MetadataRow label={ko ? "업스케일 스텝" : "Upscale steps"} value={params.hires_steps} />
                        <MetadataRow label={ko ? "업스케일 Denoise" : "Upscale denoise"} value={params.hires_denoise} />
                      </>
                    )}
                    <MetadataRow
                      label="Steps"
                      value={params.num_inference_steps}
                      applied={appliedKey === "steps"}
                      applyTitle={ko ? "적용" : "Apply"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() =>
                        applyPartial("steps", {
                          num_inference_steps: params.num_inference_steps,
                        })
                      }
                    />
                    <MetadataRow
                      label="CFG"
                      value={params.guidance_scale}
                      applied={appliedKey === "cfg"}
                      applyTitle={ko ? "적용" : "Apply"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() =>
                        applyPartial("cfg", {
                          guidance_scale: params.guidance_scale,
                        })
                      }
                    />
                    <MetadataRow
                      label="Sampler"
                      value={params.sampler_name}
                      applied={appliedKey === "sampler"}
                      applyTitle={ko ? "적용" : "Apply"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() =>
                        applyPartial("sampler", {
                          sampler_name: params.sampler_name,
                          scheduler: params.scheduler,
                        })
                      }
                    />
                    <MetadataRow
                      label={ko ? "스케줄러" : "Scheduler"}
                      value={params.scheduler || "normal"}
                      applied={appliedKey === "scheduler"}
                      applyTitle={ko ? "스케줄러 적용" : "Apply scheduler"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() => applyPartial("scheduler", { scheduler: params.scheduler })}
                    />
                    <MetadataRow
                      label="CLIP Skip"
                      value={params.clip_skip ?? 1}
                      applied={appliedKey === "clip-skip"}
                      applyTitle={ko ? "CLIP Skip 적용" : "Apply CLIP Skip"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() => applyPartial("clip-skip", { clip_skip: params.clip_skip })}
                    />
                    <MetadataRow
                      label="VAE"
                      value={params.vae_name || (ko ? "기본값" : "Default")}
                      applied={appliedKey === "vae"}
                      applyTitle={ko ? "VAE 적용" : "Apply VAE"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() => applyPartial("vae", { vae_name: params.vae_name })}
                    />
                    <MetadataRow
                      label={ko ? "생성 매수" : "Image count"}
                      value={params.num_images ?? 1}
                      applied={appliedKey === "image-count"}
                      applyTitle={ko ? "생성 매수 적용" : "Apply image count"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() => applyPartial("image-count", { num_images: params.num_images })}
                    />
                    {params.seed != null && (
                      <MetadataRow
                        label="Seed"
                        value={params.seed}
                        applied={appliedKey === "seed"}
                        applyTitle={ko ? "적용" : "Apply"}
                        appliedTitle={ko ? "적용됨" : "Applied"}
                        onApply={() =>
                          applyPartial("seed", { seed: params.seed })
                        }
                      />
                    )}
                    <MetadataRow
                      label={ko ? "생성 모드" : "Mode"}
                      value={params.generation_mode === "image_to_image" ? (ko ? "이미지 변환" : "Image to image") : params.generation_mode === "pose_reference" ? (ko ? "포즈 참조" : "Pose reference") : (ko ? "텍스트로 생성" : "Text to image")}
                      applied={appliedKey === "mode"}
                      applyTitle={ko ? "적용" : "Apply"}
                      appliedTitle={ko ? "적용됨" : "Applied"}
                      onApply={() =>
                        applyPartial("mode", {
                          generation_mode: params.generation_mode,
                        })
                      }
                    />
                    <MetadataRow
                      label={ko ? "프롬프트 가중치" : "Prompt weighting"}
                      value={params.prompt_weighting ? (ko ? "사용" : "Enabled") : (ko ? "사용 안 함" : "Disabled")}
                    />
                    <MetadataRow
                      label={ko ? "안전 필터" : "Safety checker"}
                      value={params.enable_safety_checker ? (ko ? "사용" : "Enabled") : (ko ? "사용 안 함" : "Disabled")}
                    />
                    {params.generation_mode === "image_to_image" && (
                      <>
                        <MetadataRow label={ko ? "변형 강도" : "Denoise strength"} value={params.denoise_strength} />
                        <MetadataRow label={ko ? "원본 확대 배율" : "Source resize"} value={(params.img2img_resize ?? 1) + "×"} />
                      </>
                    )}
                    {params.generation_mode === "pose_reference" && (
                      <>
                        <MetadataRow label={ko ? "포즈 ControlNet" : "Pose ControlNet"} value={params.pose_reference_model || (ko ? "지정 안 됨" : "Not set")} />
                        <MetadataRow label={ko ? "포즈 강도" : "Pose strength"} value={params.pose_reference_strength} />
                      </>
                    )}
                  </div>
                </section>

                <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      ADetailer
                    </h3>
                    <ApplyButton
                      applied={appliedKey === "adetailer"}
                      label={ko ? "적용" : "Apply"}
                      appliedLabel={ko ? "적용됨" : "Applied"}
                      onClick={() => applyPartial("adetailer", {
                        adetailer_enabled: params.adetailer_enabled,
                        adetailer_model: params.adetailer_model,
                        adetailer_checkpoint: params.adetailer_checkpoint,
                        adetailer_prompt: params.adetailer_prompt,
                        adetailer_negative_prompt: params.adetailer_negative_prompt,
                        adetailer_use_steps: params.adetailer_use_steps,
                        adetailer_steps: params.adetailer_steps,
                        adetailer_confidence: params.adetailer_confidence,
                        adetailer_mask_blur: params.adetailer_mask_blur,
                        adetailer_noise_multiplier: params.adetailer_noise_multiplier,
                        adetailer_inpaint_only_masked: params.adetailer_inpaint_only_masked,
                        adetailer_loras: params.adetailer_loras,
                        adetailer_denoise: params.adetailer_denoise,
                      })}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <MetadataRow label={ko ? "사용 상태" : "Status"} value={params.adetailer_enabled ? (ko ? "사용" : "Enabled") : (ko ? "사용 안 함" : "Disabled")} />
                    {params.adetailer_enabled && (<>
                      <MetadataRow label={ko ? "감지 모델" : "Detection model"} value={params.adetailer_model || (ko ? "기본값" : "Default")} />
                      <MetadataRow label={ko ? "얼굴 생성 모델" : "Face checkpoint"} value={params.adetailer_checkpoint || (ko ? "메인 모델" : "Main model")} />
                      <MetadataRow label={ko ? "얼굴 보정 스텝" : "Face steps"} value={params.adetailer_use_steps ? params.adetailer_steps : `${ko ? "메인 스텝" : "Main steps"} (${params.num_inference_steps})`} />
                      <MetadataRow label={ko ? "감지 신뢰도" : "Confidence"} value={params.adetailer_confidence} />
                      <MetadataRow label={ko ? "마스크 흐림" : "Mask blur"} value={params.adetailer_mask_blur} />
                      <MetadataRow label={ko ? "변형 강도" : "Denoise"} value={params.adetailer_denoise} />
                      <MetadataRow label={ko ? "노이즈 배율" : "Noise multiplier"} value={params.adetailer_noise_multiplier} />
                      <MetadataRow label={ko ? "마스크 영역만 보정" : "Inpaint masked only"} value={params.adetailer_inpaint_only_masked ? (ko ? "예" : "Yes") : (ko ? "아니요" : "No")} />
                    </>)}
                  </div>
                  {params.adetailer_enabled && (params.adetailer_prompt || params.adetailer_negative_prompt || params.adetailer_loras?.length > 0) && (
                    <div className="mt-3 space-y-2 text-xs">
                      {params.adetailer_prompt && <div><span className="font-semibold text-muted-foreground">{ko ? "얼굴 프롬프트" : "Face prompt"}</span><p className="mt-1 whitespace-pre-wrap break-words">{params.adetailer_prompt}</p></div>}
                      {params.adetailer_negative_prompt && <div><span className="font-semibold text-muted-foreground">{ko ? "얼굴 네거티브" : "Face negative"}</span><p className="mt-1 whitespace-pre-wrap break-words">{params.adetailer_negative_prompt}</p></div>}
                      {params.adetailer_loras?.length > 0 && <div><span className="font-semibold text-muted-foreground">ADetailer LoRA</span><p className="mt-1 break-words">{params.adetailer_loras.map((lora) => `${lora.path} (${lora.scale})`).join(", ")}</p></div>}
                    </div>
                  )}
                </section>

                {params.controlnets?.length > 0 && (
                  <section className="rounded-lg border border-border bg-card p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">ControlNet</h3>
                      <ApplyButton
                        applied={appliedKey === "controlnets"}
                        label={ko ? "적용" : "Apply"}
                        appliedLabel={ko ? "적용됨" : "Applied"}
                        onClick={() => applyPartial("controlnets", { controlnets: params.controlnets })}
                      />
                    </div>
                    <div className="mt-3 space-y-2">
                      {params.controlnets.map((controlnet, index) => (
                        <div key={`${controlnet.model}-${index}`} className="rounded-md border border-border bg-background p-2.5 text-xs">
                          <div className="font-semibold">#{index + 1} · {controlnet.model || (ko ? "모델 지정 안 됨" : "Model not set")}</div>
                          <div className="mt-1 grid grid-cols-3 gap-2 text-muted-foreground">
                            <span>{ko ? "강도" : "Strength"}: {controlnet.strength}</span>
                            <span>{ko ? "시작" : "Start"}: {controlnet.start_percent}</span>
                            <span>{ko ? "종료" : "End"}: {controlnet.end_percent}</span>
                          </div>
                          {controlnet.image && <div className="mt-1 truncate text-muted-foreground">{ko ? "참조" : "Reference"}: {controlnet.image}</div>}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

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
                        onView={() => setModelInfo({ asset: findAsset(modelAssets.checkpointAssets, params.model_name), name: findAsset(modelAssets.checkpointAssets, params.model_name)?.name ?? params.model_name, subtitle: ko ? "체크포인트" : "Checkpoint" })}
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
                        onView={() => setModelInfo({ asset: findAsset(modelAssets.loraAssets, lora.path), name: findAsset(modelAssets.loraAssets, lora.path)?.name ?? lora.path, subtitle: "LoRA · Weight " + lora.scale })}

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
                        onView={() => setModelInfo({ asset: findAsset(modelAssets.embeddingAssets, embedding.path), name: findAsset(modelAssets.embeddingAssets, embedding.path)?.name ?? embedding.path, subtitle: "Embedding" })}

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
                        asset={findAsset(modelAssets.upscalerAssets, params.upscale_model_name)}
                        name={findAsset(modelAssets.upscalerAssets, params.upscale_model_name)?.name ?? params.upscale_model_name}
                        onView={() => setModelInfo({ asset: findAsset(modelAssets.upscalerAssets, params.upscale_model_name), name: findAsset(modelAssets.upscalerAssets, params.upscale_model_name)?.name ?? params.upscale_model_name, subtitle: ko ? "업스케일러" : "Upscaler" })}
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
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <a
                              href={civitaiOrigin.pageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex w-fit items-center gap-1 font-medium text-primary hover:underline"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              {language === "ko" ? "Civitai에서 보기" : "View on Civitai"}
                            </a>
                            <CopyLinkButton
                              url={civitaiOrigin.pageUrl}
                              language={language}
                              showLabel
                              className="inline-flex w-fit items-center gap-1 font-medium text-primary hover:underline"
                            />
                          </div>
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

        <Dialog open={!!modelInfo} onOpenChange={(open) => { if (!open) setModelInfo(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{modelInfo?.name}</DialogTitle>
          <DialogDescription>{modelInfo?.subtitle || (ko ? "모델 정보" : "Model information")}</DialogDescription>
        </DialogHeader>
        {modelInfo && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <ModelMediaThumbnail src={modelInfo.asset?.thumbnail_url} alt={modelInfo.name} fallback={modelInfo.name.slice(0, 2).toUpperCase()} className="h-24 w-24 shrink-0" />
              <div className="min-w-0 space-y-2 text-sm">
                <div><span className="text-muted-foreground">{ko ? "파일" : "File"}:</span> <span className="break-all font-medium">{modelInfo.asset?.path || modelInfo.name}</span></div>
                {modelInfo.asset?.version && <div><span className="text-muted-foreground">{ko ? "버전" : "Version"}:</span> {modelInfo.asset.version}</div>}
                {modelInfo.asset?.base_model && <div><span className="text-muted-foreground">{ko ? "기반 모델" : "Base model"}:</span> {modelInfo.asset.base_model}</div>}
              </div>
            </div>
            {!!modelInfo.asset?.tags?.length && (
              <div className="flex flex-wrap gap-1.5">
                {modelInfo.asset.tags.map((tag) => <span key={tag} className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{tag}</span>)}
              </div>
            )}
            {(modelInfo.asset?.civitai_url || modelInfo.asset?.source_url) && (
              <Button variant="outline" render={<a href={modelInfo.asset.civitai_url || modelInfo.asset.source_url || "#"} target="_blank" rel="noreferrer" />}>
                <ExternalLink className="h-4 w-4" />
                {ko ? "원본 페이지 보기" : "View source"}
              </Button>
            )}
            {!modelInfo.asset && <p className="text-sm text-muted-foreground">{ko ? "로컬 모델 카탈로그에서 추가 정보를 찾지 못했습니다." : "No additional information was found in the local model catalog."}</p>}
          </div>
        )}
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
