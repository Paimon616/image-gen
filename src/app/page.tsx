"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { imageMatchesWorkspace, useStore } from "@/lib/store";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ImageUpload } from "@/components/image-upload";
import { GenerationParams } from "@/components/generation-params";
import { ModelSelector } from "@/components/model-selector";
import { CivitaiImport } from "@/components/civitai-import";
import { MetadataImport } from "@/components/metadata-import";
import { Gallery } from "@/components/gallery";
import { WorkspaceBar } from "@/components/workspace-bar";
import { ImageViewer } from "@/components/image-viewer";
import { AppSidebar } from "@/components/app-sidebar";
import { EditorSection } from "@/components/editor-section";
import { FieldHelp } from "@/components/field-help";
import { PaimonChat, type PaimonAttachment } from "@/components/paimon-chat";
import { Slider } from "@/components/ui/slider";
import type {
  CivitaiOrigin,
  GeneratedImage,
  GenerationParams as GenerationParamsType,
} from "@/lib/types";
import { getModelConfig, randomGenerationSeed } from "@/lib/types";
import {
  GripVertical,
  Download,
  FolderMinus,
  FolderX,
  FolderPlus,
  ImageIcon,
  ImageUp,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Trash2,
  X,
} from "lucide-react";

interface RunpodPodOption {
  id: string;
  label: string;
  podId: string;
  comfyUrl: string;
}

const EDITOR_MIN_WIDTH = 320;
const GALLERY_MIN_WIDTH = 320;
const THUMBNAIL_MIN_WIDTH = 140;
const THUMBNAIL_MAX_WIDTH = 420;

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

async function uploadImageFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = (await res.json()) as { url?: string; error?: string };

  if (!res.ok || !data.url) {
    throw new Error(data.error || "Upload failed");
  }

  return data.url;
}

function imageFileFromClipboard(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? []);
  const imageItem = items.find((item) => item.type.startsWith("image/"));

  return imageItem?.getAsFile() ?? null;
}

interface GenerationQueueItem {
  id: string;
  params: GenerationParamsType;
  civitaiOrigin?: CivitaiOrigin;
  workspaceId?: string;
  generationTarget: "local" | "runpod";
  runpodPodId?: string;
}

function cloneGenerationParams(params: GenerationParamsType) {
  return JSON.parse(JSON.stringify(params)) as GenerationParamsType;
}

export default function Home() {
  const {
    params,
    setParams,
    status,
    setStatus,
    addImage,
    addImages,
    updateImage,
    images,
    pendingImages,
    language,
    workspaces,
    activeWorkspaceId,
    removeImage,
    setImageWorkspace,
    setImageWorkspaces,
  } = useStore();
  const ko = language === "ko";
  const [localControlnets, setLocalControlnets] = useState<string[]>([]);
  const [posePreviewUrl, setPosePreviewUrl] = useState<string | null>(null);
  const [posePreviewStatus, setPosePreviewStatus] = useState("");
  const [sourceImagePreviewOpen, setSourceImagePreviewOpen] = useState(false);
  const [thumbnailWidth, setThumbnailWidth] = useState(240);
  const [editorWidth, setEditorWidth] = useState(720);
  const [editorOpen, setEditorOpen] = useState(true);
  const [gallerySelectionMode, setGallerySelectionMode] = useState(false);
  const [selectedGalleryImageIds, setSelectedGalleryImageIds] = useState<Set<string>>(
    new Set()
  );
  const [batchWorkspaceId, setBatchWorkspaceId] = useState("");
  const [batchActionBusy, setBatchActionBusy] = useState(false);
  const [batchDownloadBusy, setBatchDownloadBusy] = useState(false);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const [generationQueue, setGenerationQueue] = useState<GenerationQueueItem[]>([]);
  const [generationTarget, setGenerationTarget] = useState<"local" | "runpod">("local");
  const [runpodPods, setRunpodPods] = useState<RunpodPodOption[]>([]);
  const [selectedRunpodPodId, setSelectedRunpodPodId] = useState("");
  const [activeGeneration, setActiveGeneration] =
    useState<GenerationQueueItem | null>(null);
  const [paimonAttachments, setPaimonAttachments] =
    useState<PaimonAttachment[]>([]);
  const activePromptIdRef = useRef("");
  const generationAbortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationRef = useRef<GenerationQueueItem | null>(null);

  const startEditorResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!editorOpen) return;

      event.preventDefault();
      const startX = event.clientX;
      const startWidth = editorWidth;

      const onMove = (moveEvent: PointerEvent) => {
        const layoutWidth = layoutRef.current?.clientWidth ?? window.innerWidth;
        const maxWidth = Math.max(
          EDITOR_MIN_WIDTH,
          layoutWidth - GALLERY_MIN_WIDTH
        );
        setEditorWidth(
          Math.min(
            maxWidth,
            Math.max(
              EDITOR_MIN_WIDTH,
              startWidth + moveEvent.clientX - startX
            )
          )
        );
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [editorOpen, editorWidth]
  );

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

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const pods = Array.isArray(data.runpodPods)
          ? (data.runpodPods as RunpodPodOption[])
          : [];
        setRunpodPods(pods);
        setSelectedRunpodPodId((current) => current || pods[0]?.id || "");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (params.generation_mode !== "image_to_image") return;

    const handlePaste = async (event: ClipboardEvent) => {
      const file = imageFileFromClipboard(event);

      if (!file) return;

      event.preventDefault();
      try {
        const url = await uploadImageFile(file);
        setParams({ source_image: url });
      } catch (error) {
        setStatus({
          state: "error",
          progress: 0,
          message: error instanceof Error ? error.message : "Upload failed",
        });
      }
    };

    window.addEventListener("paste", handlePaste);

    return () => {
      window.removeEventListener("paste", handlePaste);
    };
  }, [params.generation_mode, setParams, setStatus]);

  const currentModel = getModelConfig(params.model);
  const supportsPoseReference = currentModel.provider === "comfyui";
  const galleryBatchImages = useMemo(() => {
    const visiblePending = pendingImages.filter((image) =>
      imageMatchesWorkspace(image, activeWorkspaceId)
    );
    const pendingIds = new Set(visiblePending.map((image) => image.id));

    return [
      ...visiblePending,
      ...images.filter((image) => !pendingIds.has(image.id)),
    ];
  }, [activeWorkspaceId, images, pendingImages]);
  const selectedGalleryImages = useMemo(
    () =>
      galleryBatchImages.filter((image) =>
        selectedGalleryImageIds.has(image.id)
      ),
    [galleryBatchImages, selectedGalleryImageIds]
  );
  const selectedPersistedGalleryImages = useMemo(
    () => selectedGalleryImages.filter((image) => Boolean(image.filename)),
    [selectedGalleryImages]
  );
  const selectedGalleryCount = selectedGalleryImages.length;
  const selectedPersistedGalleryCount = selectedPersistedGalleryImages.length;
  const selectedBatchWorkspaceId = batchWorkspaceId || workspaces[0]?.id || "";

  const toggleGallerySelectionMode = useCallback(() => {
    setGallerySelectionMode((enabled) => {
      if (enabled) {
        setSelectedGalleryImageIds(new Set());
      }
      return !enabled;
    });
  }, []);

  const toggleGalleryImageSelection = useCallback((image: GeneratedImage) => {
    setSelectedGalleryImageIds((current) => {
      const next = new Set(current);
      if (next.has(image.id)) {
        next.delete(image.id);
      } else {
        next.add(image.id);
      }
      return next;
    });
  }, []);

  const deleteSelectedGalleryImages = useCallback(async () => {
    if (selectedGalleryImages.length === 0 || batchActionBusy) return;

    setBatchActionBusy(true);
    try {
      for (const image of selectedGalleryImages) {
        if (image.filename) {
          await fetch(`/api/images/${image.filename}`, { method: "DELETE" });
        }
        removeImage(image.id);
      }
      setSelectedGalleryImageIds(new Set());
    } finally {
      setBatchActionBusy(false);
    }
  }, [batchActionBusy, removeImage, selectedGalleryImages]);

  const updateSelectedGalleryWorkspace = useCallback(
    async (assigned: boolean) => {
      if (!selectedBatchWorkspaceId || selectedPersistedGalleryImages.length === 0) {
        return;
      }

      setBatchActionBusy(true);
      try {
        for (const image of selectedPersistedGalleryImages) {
          await setImageWorkspace(image, selectedBatchWorkspaceId, assigned);
        }
        setSelectedGalleryImageIds(new Set());
      } finally {
        setBatchActionBusy(false);
      }
    },
    [selectedBatchWorkspaceId, selectedPersistedGalleryImages, setImageWorkspace]
  );

  const clearSelectedGalleryWorkspaces = useCallback(async () => {
    if (selectedPersistedGalleryImages.length === 0 || batchActionBusy) return;

    setBatchActionBusy(true);
    try {
      for (const image of selectedPersistedGalleryImages) {
        await setImageWorkspaces(image, []);
      }
      setSelectedGalleryImageIds(new Set());
    } finally {
      setBatchActionBusy(false);
    }
  }, [batchActionBusy, selectedPersistedGalleryImages, setImageWorkspaces]);

  const downloadSelectedGalleryImages = useCallback(async () => {
    if (
      selectedPersistedGalleryImages.length === 0 ||
      batchActionBusy ||
      batchDownloadBusy
    ) {
      return;
    }

    setBatchDownloadBusy(true);
    try {
      const filenames = selectedPersistedGalleryImages
        .map((image) => image.filename)
        .filter((filename): filename is string => Boolean(filename));

      // A single saved image downloads directly (no zip round-trip needed);
      // multiple images are bundled server-side into one zip.
      if (filenames.length === 1) {
        const a = document.createElement("a");
        a.href = `/api/images/${filenames[0]}`;
        a.download = filenames[0];
        a.click();
        return;
      }

      const res = await fetch("/api/images/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filenames }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to build zip archive");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `images-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setStatus({
        state: "error",
        progress: 0,
        message: error instanceof Error ? error.message : "Download failed",
      });
    } finally {
      setBatchDownloadBusy(false);
    }
  }, [batchActionBusy, batchDownloadBusy, selectedPersistedGalleryImages, setStatus]);

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

  const runGenerationJob = useCallback(async (job: GenerationQueueItem) => {
    const {
      id,
      params: jobParams,
      civitaiOrigin,
      workspaceId,
      generationTarget: jobGenerationTarget,
      runpodPodId,
    } = job;

    const abortController = new AbortController();
    activePromptIdRef.current = "";
    generationAbortControllerRef.current = abortController;
    updateImage(id, {
      generation: {
        state: "waiting",
        progress: 1,
        message: "Queued...",
      },
    });

    try {
      const res = await fetch("/api/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...jobParams,
          civitaiOrigin,
          workspaceId,
          generationTarget: jobGenerationTarget,
          runpodPodId,
        }),
        signal: abortController.signal,
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

          if (event === "queued") {
            activePromptIdRef.current = String(data?.prompt_id ?? "");
            updateImage(id, {
              generation: {
                state: "waiting",
                progress: 1,
                message: "Waiting for ComfyUI...",
              },
            });
          }

          if (event === "progress") {
            const progress = Number(data?.progress ?? 0);
            const message = String(data?.message ?? "Generating...");
            const isStepProgress =
              data?.step != null && data?.total_steps != null;
            updateImage(id, {
              generation: {
                state: isStepProgress ? "generating" : "waiting",
                progress,
                message,
              },
            });
          }

          if (event === "complete") {
            const generatedImages: GeneratedImage[] = Array.isArray(data?.images)
              ? data.images
              : [];

            if (generatedImages.length === 0) {
              throw new Error("Generation completed without an image.");
            }

            const [firstImage, ...additionalImages] = generatedImages;
            updateImage(id, {
              ...firstImage,
              params: firstImage.params ?? jobParams,
              generation: {
                state: "completed",
                progress: 100,
                message: "Done",
              },
            });

            if (additionalImages.length > 0) {
              addImages(
                additionalImages.map((image) => ({
                  ...image,
                  generation: {
                    state: "completed" as const,
                    progress: 100,
                    message: "Done",
                  },
                }))
              );
            }

            // Refresh workspace image counts after auto-registering the result.
            if (workspaceId) {
              void useStore.getState().fetchWorkspaces();
            }

            completed = true;
          }

          if (event === "error") {
            throw new Error(data?.error || "Generation failed");
          }
        }
      }

      setStatus({ state: "completed", progress: 100, message: "Done!" });
      setTimeout(() => {
        setStatus({ state: "idle", progress: 0, message: "" });
      }, 2000);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        updateImage(id, {
          generation: {
            state: "canceled",
            progress: 0,
            message: "Canceled.",
          },
        });
        setStatus({ state: "canceled", progress: 0, message: "Canceled." });
        return;
      }

      const message = err instanceof Error ? err.message : "Unknown error";
      updateImage(id, {
        generation: {
          state: "error",
          progress: 0,
          message,
        },
      });
      setStatus({ state: "error", progress: 0, message });
    } finally {
      generationAbortControllerRef.current = null;
      activePromptIdRef.current = "";
      activeGenerationRef.current = null;
      setActiveGeneration(null);
    }
  }, [addImages, setStatus, updateImage]);

  useEffect(() => {
    if (activeGenerationRef.current || activeGeneration || generationQueue.length === 0) {
      return;
    }

    const [nextJob] = generationQueue;
    activeGenerationRef.current = nextJob;
    setGenerationQueue((queue) =>
      queue[0]?.id === nextJob.id ? queue.slice(1) : queue
    );
    setActiveGeneration(nextJob);
    void runGenerationJob(nextJob);
  }, [activeGeneration, generationQueue, runGenerationJob]);

  const generate = useCallback(() => {
    if (!params.prompt.trim()) return;
    if (generationModeError) {
      setStatus({ state: "error", progress: 0, message: generationModeError });
      return;
    }
    if (generationTarget === "runpod" && !selectedRunpodPodId) {
      setStatus({
        state: "error",
        progress: 0,
        message: "RunPod target is not configured.",
      });
      return;
    }

    const jobParams = cloneGenerationParams(params);
    if (jobParams.seed == null || jobParams.seed < 0) {
      jobParams.seed = randomGenerationSeed();
    }
    const id = crypto.randomUUID();
    const civitaiOrigin = useStore.getState().civitaiReference ?? undefined;
    const workspaceId = useStore.getState().activeWorkspaceId ?? undefined;

    addImage({
      id,
      url: "",
      filename: "",
      params: jobParams,
      timestamp: Date.now(),
      civitaiOrigin,
      workspaces: workspaceId ? [workspaceId] : [],
      generation: {
        state: "queued",
        progress: 0,
        message: "Queued",
      },
    });
    setGenerationQueue((queue) => [
      ...queue,
      {
        id,
        params: jobParams,
        civitaiOrigin,
        workspaceId,
        generationTarget,
        runpodPodId: generationTarget === "runpod" ? selectedRunpodPodId : undefined,
      },
    ]);
    setStatus({ state: "idle", progress: 0, message: "" });
  }, [
    addImage,
    generationModeError,
    generationTarget,
    params,
    selectedRunpodPodId,
    setStatus,
  ]);

  const toggleImageInPaimon = useCallback((image: GeneratedImage) => {
    setPaimonAttachments((current) => {
      const attachmentId = `gallery:${image.id}`;
      if (current.some((attachment) => attachment.id === attachmentId)) {
        return current.filter((attachment) => attachment.id !== attachmentId);
      }

      const attachment: PaimonAttachment = {
        id: attachmentId,
        kind: "gallery_image",
        label: "갤러리 이미지",
        url:
          image.url ||
          (image.filename ? `/api/images/${image.filename}` : ""),
        metadata: {
          id: image.id,
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          filename: image.filename,
          timestamp: image.timestamp,
          sizeSemantics: image.sizeSemantics,
          params: image.params,
          civitaiOrigin: image.civitaiOrigin,
        },
      };

      return [...current, attachment].slice(-6);
    });
  }, []);
  const paimonImageIds = useMemo(
    () =>
      new Set(
        paimonAttachments
          .map((attachment) => attachment.metadata?.id)
          .filter((id): id is string => typeof id === "string")
      ),
    [paimonAttachments]
  );


  const cancelGeneration = useCallback((imageId?: string) => {
    const targetId = imageId ?? activeGeneration?.id;

    if (!targetId) return;

    const queuedJob = generationQueue.find((job) => job.id === targetId);

    if (queuedJob) {
      setGenerationQueue((queue) => queue.filter((job) => job.id !== targetId));
      updateImage(targetId, {
        generation: {
          state: "canceled",
          progress: 0,
          message: "Canceled.",
        },
      });
      setStatus({ state: "canceled", progress: 0, message: "Canceled." });
      return;
    }

    const runningJob = activeGenerationRef.current ?? activeGeneration;

    if (runningJob?.id !== targetId) return;

    const promptId = activePromptIdRef.current;

    generationAbortControllerRef.current?.abort();

    if (promptId) {
      void fetch("/api/generate/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt_id: promptId }),
      }).catch(() => {});
    }

    updateImage(targetId, {
      generation: {
        state: "canceled",
        progress: 0,
        message: "Canceled.",
      },
    });

    setStatus({ state: "canceled", progress: 0, message: "Canceled." });
  }, [activeGeneration, generationQueue, setStatus, updateImage]);

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

  const isGenerating = Boolean(activeGeneration);
  const queuedJobCount = generationQueue.length;
  const runpodTargetMissing = generationTarget === "runpod" && !selectedRunpodPodId;

  return (
    <div ref={layoutRef} className="flex h-screen">
      <AppSidebar />

      {/* Left Sidebar - Controls */}
      {editorOpen && (
        <aside className="flex shrink-0 flex-col overflow-hidden" style={{ width: editorWidth }}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{ko ? "이미지 생성" : "Image Generation"}</h1>
            <p className="text-xs text-muted-foreground">{currentModel.name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-card/80 p-1">
              {[
                { value: "local" as const, label: ko ? "로컬" : "Local" },
                { value: "runpod" as const, label: "RunPod" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setGenerationTarget(item.value)}
                  className={`h-7 rounded px-2 text-xs font-semibold transition-colors ${
                    generationTarget === item.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {generationTarget === "runpod" && (
              <select
                value={selectedRunpodPodId}
                onChange={(event) => setSelectedRunpodPodId(event.target.value)}
                className="h-9 max-w-40 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="RunPod target"
              >
                {runpodPods.length === 0 ? (
                  <option value="">{ko ? "Pod 없음" : "No pod"}</option>
                ) : (
                  runpodPods.map((pod) => (
                    <option key={pod.id} value={pod.id}>
                      {pod.label || pod.podId || pod.id}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <EditorSection title={ko ? "가져오기" : "Import"} description={ko ? "Civitai URL이나 이미지 메타데이터에서 프롬프트와 설정을 가져옵니다." : "Import prompts and settings from Civitai or image metadata."}>
          <CivitaiImport />
          <MetadataImport />
          </EditorSection>

          <EditorSection title={ko ? "모델" : "Models"} description={ko ? "기본 모델과 LoRA, 임베딩을 선택합니다." : "Choose the base model, LoRA, and embeddings."}>
            <ModelSelector />
          </EditorSection>

          <EditorSection title={ko ? "구성" : "Composition"} description={ko ? "생성 모드와 프롬프트, 참조 이미지를 설정합니다." : "Set the generation mode, prompt, and visual references."}>

          <div className="space-y-2">
            <FieldHelp label={ko ? "생성 모드" : "Mode"} help={ko ? "텍스트 생성, 이미지 변환, 포즈 참조 중 작업 방식을 선택합니다." : "Choose text generation, image-to-image, or pose reference workflow."} />
            <div className="grid grid-cols-3 gap-1.5 rounded-md border border-border bg-card/80 p-1 shadow-sm">
              {[
                {
                  mode: "text_to_image" as const,
                  label: ko ? "텍스트로 생성" : "Text to Image",
                  icon: ImageIcon,
                },
                {
                  mode: "image_to_image" as const,
                  label: ko ? "이미지 변환" : "Image to Image",
                  icon: ImageUp,
                },
                {
                  mode: "pose_reference" as const,
                  label: ko ? "포즈 참조" : "Pose Reference",
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
          <div className="space-y-3">
          <div>
            <FieldHelp className="mb-2" label={ko ? "프롬프트" : "Prompt"} help={ko ? "생성할 이미지의 피사체, 구도, 조명과 스타일을 설명합니다." : "Describe the subject, composition, lighting, and style to generate."} />
            <Textarea
              placeholder={ko ? "생성할 이미지를 설명하세요..." : "Describe the image you want to generate..."}
              value={params.prompt}
              onChange={(e) => setParams({ prompt: e.target.value })}
              className="min-h-36 resize-y text-sm"
            />
          </div>

          <div>
            <FieldHelp className="mb-2" label={ko ? "네거티브 프롬프트" : "Negative Prompt"} help={ko ? "이미지에서 제외하거나 억제할 요소를 입력합니다." : "Describe elements that should be excluded or suppressed."} />
            <Textarea
              placeholder={ko ? "제외할 요소를 입력하세요..." : "What to exclude..."}
              value={params.negative_prompt}
              onChange={(e) => setParams({ negative_prompt: e.target.value })}
              className="min-h-36 resize-y text-sm"
            />
          </div>
          </div>

          {params.generation_mode === "pose_reference" && (
            <>
              <Separator />
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_16rem]">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <FieldHelp label={ko ? "포즈 참조 이미지" : "Pose Reference"} help={ko ? "인물의 자세만 추출해 새 이미지의 구도에 반영합니다. 선명한 전신 사진일수록 인식이 안정적입니다." : "Extracts a person's pose and applies it to the new composition; clear full-body images work best."} />
                    {!supportsPoseReference && (
                      <span className="text-xs text-yellow-500">
                        Local ComfyUI only
                      </span>
                    )}
                  </div>
                  <ImageUpload
                    label={ko ? "포즈 이미지" : "Pose Image"}
                    description={ko ? "포즈 참조 이미지를 끌어놓거나 클릭해 업로드하세요" : "Drop or click to upload a pose reference"}
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
                    <FieldHelp className="mb-2" label="ControlNet" help={ko ? "포즈의 관절 정보를 해석할 ControlNet 모델입니다. OpenPose 계열 모델을 선택하세요." : "The ControlNet model that interprets pose joints; choose an OpenPose model."} />
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
                      <FieldHelp label={ko ? "포즈 강도" : "Strength"} help={ko ? "참조 포즈를 결과가 얼마나 강하게 따를지 조절합니다. 높을수록 자세는 정확하지만 자연스러움이 줄 수 있습니다." : "Controls how strongly the result follows the reference pose; higher values are stricter but may look less natural."} />
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
                  <FieldHelp className="mb-2" label={ko ? "원본 이미지" : "Source Image"} help={ko ? "이미지 변환의 출발점입니다. 프롬프트와 디노이즈 강도에 따라 이 이미지를 다시 그립니다." : "The starting image for image-to-image; it is redrawn according to the prompt and denoise strength."} />
                  <ImageUpload
                    label={ko ? "원본 이미지" : "Source Image"}
                    description={ko ? "원본 이미지를 끌어놓거나 클릭해 업로드하세요" : "Drop or click to upload a source image"}
                    value={params.source_image}
                    onChange={(url) => setParams({ source_image: url })}
                    previewClassName="h-40 w-full object-contain bg-background"
                    onPreview={
                      params.source_image
                        ? () => setSourceImagePreviewOpen(true)
                        : undefined
                    }
                  />
                </div>

                <div className="space-y-3 rounded-md border border-border bg-card/80 p-3 shadow-sm">
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <FieldHelp label={ko ? "변형 강도" : "Denoise"} help={ko ? "원본을 얼마나 새로 그릴지 조절합니다. 낮으면 원본을 보존하고, 높으면 프롬프트에 맞춰 크게 변형합니다." : "Controls how much of the source is redrawn; low values preserve it, high values transform it strongly."} />
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

                  {(params.backend === "a1111" || params.backend === "forge") && (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <FieldHelp label={ko ? "확대 배율" : "Resize by"} help={ko ? "이미지 변환 전에 원본을 확대할 배율입니다. 배율이 높을수록 메모리 사용량과 처리 시간이 증가합니다." : "Scale applied before image-to-image; higher values use more memory and processing time."} />
                        <span className="text-xs font-mono">
                          {params.img2img_resize.toFixed(2)}×
                        </span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={4}
                        step={0.05}
                        value={params.img2img_resize}
                        onChange={(e) =>
                          setParams({
                            img2img_resize: parseFloat(e.target.value),
                          })
                        }
                        className="w-full accent-primary"
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Upscales the source by this factor. Pick an Upscaler in
                        Advanced to add ESRGAN detail before the img2img pass.
                      </p>
                    </div>
                  )}

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
                    <FieldHelp className="mb-2" label={ko ? "스타일 참조" : "Style Reference"} help={ko ? "참조 이미지의 색감, 질감과 화풍을 결과에 반영합니다. 피사체 구조보다 시각적 분위기에 영향을 줍니다." : "Transfers color, texture, and visual style from a reference image rather than its exact structure."} />
                    <ImageUpload
                      label={ko ? "스타일 이미지" : "Style Image"}
                      description={ko ? "스타일 참조 이미지를 업로드하세요" : "Drop or click to upload style reference"}
                      value={params.style_image}
                      onChange={(url) => setParams({ style_image: url })}
                    />
                  </div>
                )}

                {currentModel.supports.face_id && (
                  <div>
                    <FieldHelp className="mb-2" label={ko ? "캐릭터 참조" : "Character Reference"} help={ko ? "참조 인물의 얼굴 특징과 정체성을 새 이미지에서 유지하도록 돕습니다." : "Helps preserve the referenced person's facial features and identity in the new image."} />
                    <ImageUpload
                      label={ko ? "캐릭터 이미지" : "Character Image"}
                      description={ko ? "캐릭터 참조 이미지를 업로드하세요" : "Drop or click to upload character reference"}
                      value={params.character_image}
                      onChange={(url) => setParams({ character_image: url })}
                    />
                  </div>
                )}
              </div>
            </>
          )}
          </EditorSection>

          <EditorSection title={ko ? "출력" : "Output"} description={ko ? "생성 백엔드와 최종 이미지 크기, 생성 매수를 설정합니다." : "Choose the generation backend, final size, and image count."}>
            <GenerationParams section="output" />
          </EditorSection>

          <EditorSection title={ko ? "고급 설정" : "Advanced"} description={ko ? "샘플링과 시드, VAE, 프롬프트 가중치, ControlNet을 세부 조정합니다." : "Fine-tune sampling, seed, VAE, prompt weighting, and ControlNet."}>
            <GenerationParams section="advanced" />
          </EditorSection>

          <EditorSection
            title={ko ? "업스케일러" : "Upscaler"}
            description={ko ? "고해상도 보정과 업스케일 방식을 설정합니다." : "Configure high-resolution refinement and upscaling."}
            toggle={{
              checked: params.hires_upscale > 1,
              label: ko ? "업스케일러 사용" : "Enable Upscaler",
              onCheckedChange: (checked) => setParams({
                hires_upscale: checked ? (params.hires_upscale > 1 ? params.hires_upscale : 2) : 1,
              }),
            }}
          >
            <GenerationParams section="upscaler" />
          </EditorSection>

          <EditorSection
            title={ko ? "ADetailer 얼굴 보정" : "ADetailer"}
            description={ko ? "얼굴을 감지하고 별도의 디테일 패스로 보정합니다." : "Detect and refine faces with a dedicated detail pass."}
            toggle={{
              checked: params.adetailer_enabled,
              label: ko ? "ADetailer 사용" : "Enable ADetailer",
              onCheckedChange: (checked) => setParams({
                adetailer_enabled: checked,
                ...(checked
                  ? {
                      adetailer_model:
                        params.backend === "comfyui"
                          ? "bbox/face_yolov8n_v2.pt"
                          : "face_yolov8n.pt",
                    }
                  : {}),
              }),
            }}
          >
            <GenerationParams section="adetailer" />
          </EditorSection>
        </div>

        {/* Generate Button */}
        <div className="p-4 border-t border-border">
          {status.state === "error" && (
            <p className="text-xs text-destructive mb-2">{status.message}</p>
          )}
          {status.state === "completed" && (
            <p className="text-xs text-green-500 mb-2">{status.message}</p>
          )}
          {status.state === "canceled" && (
            <p className="text-xs text-muted-foreground mb-2">{status.message}</p>
          )}
          {(isGenerating || queuedJobCount > 0) && (
            <p className="mb-2 text-xs text-muted-foreground">
              실행 중 {isGenerating ? 1 : 0}개 · 대기 {queuedJobCount}개
            </p>
          )}
          <div
            className={
              isGenerating ? "grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2" : ""
            }
          >
            <Button
              className="relative w-full overflow-hidden"
              size="lg"
              onClick={generate}
              disabled={
                !params.prompt.trim() ||
                Boolean(generationModeError) ||
                runpodTargetMissing
              }
            >
              <span className="relative z-10 drop-shadow-sm">
                {isGenerating || queuedJobCount > 0 ? "Add to Queue" : "Generate"}
              </span>
            </Button>

            {isGenerating && (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => cancelGeneration()}
                className="gap-1.5"
              >
                <X className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
        </aside>
      )}

      {editorOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize editor and gallery"
          onPointerDown={startEditorResize}
          className="group relative z-20 w-2 shrink-0 cursor-col-resize border-x border-border bg-muted/40 hover:bg-primary/20"
        >
          <GripVertical className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-muted-foreground group-hover:text-primary" />
        </div>
      )}

      {/* Main Content - Gallery */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => setEditorOpen((open) => !open)}
              aria-label={editorOpen ? "Hide editor" : "Show editor"}
              title={editorOpen ? "Hide editor" : "Show editor"}
            >
              {editorOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <h2 className="text-sm font-medium">{ko ? "갤러리" : "Gallery"}</h2>
            <Button
              type="button"
              size="sm"
              variant={gallerySelectionMode ? "default" : "outline"}
              onClick={toggleGallerySelectionMode}
              className="h-8"
            >
              {gallerySelectionMode
                ? ko ? "선택 종료" : "Done"
                : ko ? "다중선택" : "Multi-select"}
            </Button>
            {gallerySelectionMode && (
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                  {ko
                    ? `${selectedGalleryCount}개 선택`
                    : `${selectedGalleryCount} selected`}
                </span>
                <select
                  value={selectedBatchWorkspaceId}
                  onChange={(event) => setBatchWorkspaceId(event.target.value)}
                  className="h-8 max-w-44 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  disabled={workspaces.length === 0 || batchActionBusy}
                  aria-label={ko ? "일괄 작업 워크스페이스" : "Batch workspace"}
                >
                  {workspaces.length === 0 ? (
                    <option value="">
                      {ko ? "워크스페이스 없음" : "No workspace"}
                    </option>
                  ) : (
                    workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))
                  )}
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void updateSelectedGalleryWorkspace(true)}
                  disabled={
                    batchActionBusy ||
                    !selectedBatchWorkspaceId ||
                    selectedPersistedGalleryCount === 0
                  }
                  title={
                    selectedPersistedGalleryCount === 0
                      ? ko
                        ? "저장된 이미지만 워크스페이스에 추가할 수 있습니다"
                        : "Only saved images can be assigned to workspaces"
                      : undefined
                  }
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                  {ko ? "추가" : "Add"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void updateSelectedGalleryWorkspace(false)}
                  disabled={
                    batchActionBusy ||
                    !selectedBatchWorkspaceId ||
                    selectedPersistedGalleryCount === 0
                  }
                >
                  <FolderMinus className="h-3.5 w-3.5" />
                  {ko ? "제거" : "Remove"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void clearSelectedGalleryWorkspaces()}
                  disabled={batchActionBusy || selectedPersistedGalleryCount === 0}
                  title={
                    ko
                      ? "선택한 이미지를 모든 워크스페이스에서 제외합니다"
                      : "Remove selected images from every workspace"
                  }
                >
                  <FolderX className="h-3.5 w-3.5" />
                  {ko ? "워크스페이스 비우기" : "Clear workspaces"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5"
                  onClick={() => void downloadSelectedGalleryImages()}
                  disabled={
                    batchActionBusy ||
                    batchDownloadBusy ||
                    selectedPersistedGalleryCount === 0
                  }
                  title={
                    selectedPersistedGalleryCount === 0
                      ? ko
                        ? "저장된 이미지만 다운로드할 수 있습니다"
                        : "Only saved images can be downloaded"
                      : selectedPersistedGalleryCount > 1
                        ? ko
                          ? "선택한 이미지를 zip으로 묶어 다운로드합니다"
                          : "Bundles the selected images into a zip download"
                        : undefined
                  }
                >
                  {batchDownloadBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {ko ? "다운로드" : "Download"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 gap-1.5"
                  onClick={() => void deleteSelectedGalleryImages()}
                  disabled={batchActionBusy || selectedGalleryCount === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {ko ? "삭제" : "Delete"}
                </Button>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs text-muted-foreground">{ko ? "썸네일 너비" : "Thumbnail width"}</span>
              <Slider
                value={[thumbnailWidth]}
                onValueChange={(v) => {
                  const val = Array.isArray(v) ? v[0] : v;
                  setThumbnailWidth(val);
                }}
                min={THUMBNAIL_MIN_WIDTH}
                max={THUMBNAIL_MAX_WIDTH}
                step={10}
                style={{ width: "110px" }}
              />
              <span className="w-6 text-center text-xs font-mono tabular-nums text-foreground">
                {thumbnailWidth}
              </span>
            </div>
          </div>
          <span className="text-xs text-muted-foreground">
            {images.length} images
          </span>
        </div>
        <WorkspaceBar />
        <Gallery
          onCancelGeneration={(image) => cancelGeneration(image.id)}
          onSendToPaimon={toggleImageInPaimon}
          paimonImageIds={paimonImageIds}
          thumbnailWidth={thumbnailWidth}
          selectionMode={gallerySelectionMode}
          selectedImageIds={selectedGalleryImageIds}
          onToggleImageSelection={toggleGalleryImageSelection}
        />
      </main>

      <PaimonChat
        params={params}
        onApplyParams={setParams}
        attachments={paimonAttachments}
        onAttachmentsChange={setPaimonAttachments}
      />

      {/* Image Viewer Dialog */}
      <ImageViewer />

      <Dialog
        open={sourceImagePreviewOpen && Boolean(params.source_image)}
        onOpenChange={setSourceImagePreviewOpen}
      >
        <DialogContent className="max-h-[92vh] overflow-hidden border border-border bg-card p-0 shadow-xl sm:max-w-5xl">
          <DialogHeader className="border-b border-border bg-secondary/50 px-5 py-4">
            <DialogTitle>Source Image</DialogTitle>
            <DialogDescription className="truncate">
              {params.source_image}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[calc(92vh-5rem)] items-center justify-center bg-background p-3">
            {params.source_image && (
              <img
                src={params.source_image}
                alt="Source Image"
                className="max-h-[calc(92vh-7rem)] max-w-full object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
