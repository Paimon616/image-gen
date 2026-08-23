"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { imageMatchesWorkspace, useStore } from "@/lib/store";
import { isPulidInstallableError } from "@/lib/pulid-assets";
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
  GeneratedImage,
  GenerationParams as GenerationParamsType,
  ImportedCivitaiResource,
} from "@/lib/types";
import { getModelConfig } from "@/lib/types";
import {
  compareComfyVersions,
  formatComfyVersion,
  parseComfyVersion,
  requiredComfyVersionForCheckpoint,
} from "@/lib/comfy-version";
import { useRunpodDownloadStore } from "@/lib/runpod-download-store";
import {
  useGenerationQueueStore,
  type RunpodMissingFile,
} from "@/lib/generation-queue-store";
import {
  runpodDownloadEntryId,
  useDownloadManagerStore,
} from "@/lib/download-manager-store";
import {
  AlertTriangle,
  CheckCircle2,
  GripVertical,
  Download,
  DownloadCloud,
  FolderMinus,
  FolderX,
  FolderPlus,
  ImageIcon,
  ImageUp,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Power,
  RefreshCw,
  ScanLine,
  Server,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

interface RunpodPodOption {
  id: string;
  kind?: "image" | "video";
  label: string;
  podId: string;
  comfyUrl: string;
}

interface RunpodConnectionStatus {
  checked: boolean;
  comfyReachable: boolean;
  comfyInitializing: boolean;
  helperReachable: boolean;
  helperInitializing: boolean;
  // Helper is reachable but running an older build than this app ships; the user
  // is prompted to redeploy so newer features (e.g. the shared model catalog) work.
  helperOutdated: boolean;
  comfyError: string;
  helperError: string;
  // The ComfyUI version the pod reports (system.comfyui_version), "" if unknown.
  comfyVersion: string;
  podDesiredStatus: string;
}

const EDITOR_MIN_WIDTH = 320;
const GALLERY_MIN_WIDTH = 320;
const THUMBNAIL_MIN_WIDTH = 140;
const THUMBNAIL_MAX_WIDTH = 420;
const GENERATION_TARGET_STORAGE_KEY = "image-gen:generation-target";
const SELECTED_RUNPOD_POD_STORAGE_KEY = "image-gen:selected-runpod-pod-id";

function choosePoseControlNet(controlnets: string[]) {
  return (
    controlnets.find((model) => /open\s*pose|openpose|pose/i.test(model)) ??
    controlnets[0] ??
    ""
  );
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

function canDownloadRunpodMissingFile(item: RunpodMissingFile) {
  // Eligibility is decided server-side (see canDownloadRunpodResource in runpod.ts)
  // where the base-asset list and catalog are known; the client just reflects it.
  return item.downloadable === true;
}

export default function Home() {
  const {
    params,
    setParams,
    status,
    setStatus,
    images,
    pendingImages,
    language,
    workspaces,
    activeWorkspaceId,
    removeImage,
    setImageWorkspace,
    setImageWorkspaces,
    fetchImagePage,
    imagesNextCursor,
    imagesTotal,
    isLoadingMoreImages,
    setSelectedImage,
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
  // The queue, the running job and the job runner live in a module-level store
  // (see generation-queue-store.ts) so queued generations keep draining while
  // this page is unmounted — e.g. during a Paimon batch started here and
  // continued from another page.
  const generationQueue = useGenerationQueueStore((state) => state.queue);
  const activeGeneration = useGenerationQueueStore((state) => state.active);
  const enqueueGenerationJob = useGenerationQueueStore((state) => state.enqueue);
  const cancelGenerationJob = useGenerationQueueStore((state) => state.cancel);
  const setGenerationConfig = useGenerationQueueStore(
    (state) => state.setConfig
  );
  // True from the moment Generate is pressed until the pending gallery card is
  // registered. On the RunPod path an async file check sits in that gap, so the
  // button shows a "registering card" state instead of looking unresponsive.
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Always start with the deterministic default so the server-rendered HTML and
  // the client's first render match. The persisted value is read after mount
  // (see the useEffect below) to avoid a hydration mismatch.
  const [generationTarget, setGenerationTarget] = useState<"local" | "runpod">("local");
  // Local ComfyUI backend state. The launcher no longer starts ComfyUI; the app
  // offers to start it on demand via a banner when in local mode (see below).
  const [comfy, setComfy] = useState<{
    running: boolean;
    starting: boolean;
    local: boolean;
    installed: boolean;
  }>({ running: true, starting: false, local: true, installed: true });
  const [comfyStartError, setComfyStartError] = useState("");
  const [runpodPods, setRunpodPods] = useState<RunpodPodOption[]>([]);
  const [selectedRunpodPodId, setSelectedRunpodPodId] = useState("");
  const [runpodStatus, setRunpodStatus] = useState("");
  const [runpodBusy, setRunpodBusy] =
    useState<"" | "status" | "check" | "download" | "setup">("");
  const [runpodRunningIds, setRunpodRunningIds] = useState<Set<string>>(new Set());
  const [runpodMissingFiles, setRunpodMissingFiles] = useState<RunpodMissingFile[]>([]);
  // Custom-node packs the selected workflow needs but the pod lacks (e.g. RES4LYF
  // for the PornMaster RES4LYF recipe), with a top-banner Install action.
  const [runpodMissingNodePacks, setRunpodMissingNodePacks] = useState<
    { name: string; url: string }[]
  >([]);
  const [nodeInstallBusy, setNodeInstallBusy] = useState(false);
  const [nodeInstallStatus, setNodeInstallStatus] = useState("");
  // PuLID one-click install (surfaced when a generation fails with a missing-node
  // or missing-weight PuLID error). Streams script/helper progress into `message`.
  const [pulidInstall, setPulidInstall] = useState<{ running: boolean; message: string }>({
    running: false,
    message: "",
  });
  const [comfyUpgradeBusy, setComfyUpgradeBusy] = useState(false);
  const [comfyUpgradeStatus, setComfyUpgradeStatus] = useState("");
  // RunPod download progress/status live in a module-level store (not component
  // state) so an in-flight download survives navigating away from and back to
  // this page. Progress itself is shown on the Download Manager page.
  const runpodDownloading = useRunpodDownloadStore((state) =>
    selectedRunpodPodId
      ? state.downloadingByPod[selectedRunpodPodId] ?? false
      : false
  );
  const runpodDownloadMessage = useRunpodDownloadStore((state) =>
    selectedRunpodPodId ? state.messageByPod[selectedRunpodPodId] ?? "" : ""
  );
  // Per-file download status (from the Download Manager) so each missing-file
  // row can show whether that exact file is downloading / done right now.
  const downloadManagerEntries = useDownloadManagerStore(
    (state) => state.entries
  );
  const runpodPendingRecheck = useRunpodDownloadStore((state) =>
    selectedRunpodPodId
      ? state.pendingRecheckByPod[selectedRunpodPodId] ?? false
      : false
  );
  const startRunpodDownload = useRunpodDownloadStore(
    (state) => state.startDownload
  );
  const setRunpodDownloadMessage = useRunpodDownloadStore(
    (state) => state.setMessage
  );
  const clearRunpodPendingRecheck = useRunpodDownloadStore(
    (state) => state.clearPendingRecheck
  );
  const setRunpodConnectionCache = useRunpodDownloadStore(
    (state) => state.setConnection
  );
  const [runpodConnection, setRunpodConnection] = useState<RunpodConnectionStatus>({
    checked: false,
    comfyReachable: false,
    comfyInitializing: false,
    helperReachable: false,
    helperInitializing: false,
    helperOutdated: false,
    comfyError: "",
    helperError: "",
    comfyVersion: "",
    podDesiredStatus: "",
  });
  const runpodConnectionRef = useRef<RunpodConnectionStatus | null>(null);
  // True once the running-pod auto-select has run for the current stint in
  // RunPod mode, so it does not fight a manual pick from the dropdown.
  const autoPodSelectRef = useRef(false);
  const autoRunpodCheckKeyRef = useRef("");
  const autoRunpodFileSigRef = useRef("");
  const [runpodFilesChecked, setRunpodFilesChecked] = useState(false);
  const [paimonAttachments, setPaimonAttachments] =
    useState<PaimonAttachment[]>([]);

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

  // Read the persisted generation target after mount to avoid a hydration
  // mismatch (see the generationTarget useState above).
  useEffect(() => {
    try {
      const savedGenerationTarget = window.localStorage.getItem(
        GENERATION_TARGET_STORAGE_KEY
      );
      if (savedGenerationTarget === "runpod") {
        setGenerationTarget("runpod");
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        const pods = (
          Array.isArray(data.runpodPods)
            ? (data.runpodPods as RunpodPodOption[])
            : []
        ).filter((pod) => pod.kind !== "video");
        setRunpodPods(pods);
        setSelectedRunpodPodId((current) => {
          const savedPodId = (() => {
            try {
              return window.localStorage.getItem(SELECTED_RUNPOD_POD_STORAGE_KEY) ?? "";
            } catch {
              return "";
            }
          })();
          const podExists = (id: string) => pods.some((pod) => pod.id === id);
          const next =
            current && podExists(current)
              ? current
              : savedPodId && podExists(savedPodId)
                ? savedPodId
                : pods[0]?.id || "";

          try {
            if (next) {
              window.localStorage.setItem(SELECTED_RUNPOD_POD_STORAGE_KEY, next);
            } else {
              window.localStorage.removeItem(SELECTED_RUNPOD_POD_STORAGE_KEY);
            }
          } catch {}

          return next;
        });
      })
      .catch(() => {});
  }, []);

  const resetRunpodConnection = useCallback(() => {
    autoRunpodCheckKeyRef.current = "";
    autoRunpodFileSigRef.current = "";
    setRunpodStatus("");
    setRunpodFilesChecked(false);
    setRunpodMissingFiles([]);
    setRunpodConnection({
      checked: false,
      comfyReachable: false,
      comfyInitializing: false,
      helperReachable: false,
      helperInitializing: false,
      helperOutdated: false,
      comfyError: "",
      helperError: "",
      comfyVersion: "",
      podDesiredStatus: "",
    });
  }, []);

  const applyRunpodStatus = useCallback(
    (data: Record<string, unknown>) => {
      const comfyReachable = Boolean(data.comfyReachable);
      const helperReachable = Boolean(data.helperReachable);
      const status: RunpodConnectionStatus = {
        checked: true,
        comfyReachable,
        comfyInitializing: !comfyReachable && Boolean(data.comfyInitializing),
        helperReachable,
        helperInitializing: !helperReachable && Boolean(data.helperInitializing),
        helperOutdated: helperReachable && Boolean(data.helperOutdated),
        comfyError: String(data.comfyError || ""),
        helperError: String(data.helperError || ""),
        comfyVersion: String(data.comfyVersion || ""),
        podDesiredStatus: String(data.podDesiredStatus || ""),
      };
      setRunpodConnection(status);
      // Cache the last-known status so returning to this page shows it
      // immediately instead of flashing back to "unchecked".
      if (selectedRunpodPodId) {
        setRunpodConnectionCache(selectedRunpodPodId, status);
      }
    },
    [selectedRunpodPodId, setRunpodConnectionCache]
  );

  // Seed the connection status from the module-level cache when (re)mounting or
  // switching pods, so returning to the page shows the last-known state right
  // away rather than flashing to "unchecked" while the poller re-runs.
  useEffect(() => {
    if (!selectedRunpodPodId) return;
    const cached =
      useRunpodDownloadStore.getState().connectionByPod[selectedRunpodPodId];
    if (cached) {
      setRunpodConnection(cached);
    }
  }, [selectedRunpodPodId]);

  // Read-only status refresh (auto=1 => never starts the pod or sets up ports).
  const refreshRunpodStatus = useCallback(async () => {
    if (!selectedRunpodPodId) return;
    try {
      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/status?auto=1`,
        { cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok || data.error) return;
      applyRunpodStatus(data);
    } catch {
      // Keep the last known status; the next poll will retry.
    }
  }, [applyRunpodStatus, selectedRunpodPodId]);

  // Query every configured image pod's RunPod desiredStatus in one call to flag
  // running pods in the dropdown and auto-select one when RunPod mode is on.
  const refreshRunpodRunning = useCallback(async () => {
    try {
      const response = await fetch("/api/runpod/pods/running?kind=image", {
        cache: "no-store",
      });
      const data = await response.json();
      const pods = Array.isArray(data.pods)
        ? (data.pods as Array<{ id: string; running: boolean }>)
        : [];
      setRunpodRunningIds(
        new Set(pods.filter((pod) => pod.running).map((pod) => pod.id))
      );
      return pods;
    } catch {
      return [] as Array<{ id: string; running: boolean }>;
    }
  }, []);

  // On RunPod toggle, select the first RUNNING pod (topmost wins). If none are
  // running, keep the current selection and say so.
  const autoSelectRunningRunpodPod = useCallback(async () => {
    const pods = await refreshRunpodRunning();
    const runningIds = new Set(
      pods.filter((pod) => pod.running).map((pod) => pod.id)
    );
    const runningPods = runpodPods.filter((pod) => runningIds.has(pod.id));

    if (runningPods.length === 0) {
      setRunpodStatus(
        ko
          ? "실행 중인 pod가 없습니다. RunPod 콘솔에서 pod를 시작한 뒤 '상태 다시 확인'을 눌러주세요."
          : "No running pod found. Start one in the RunPod console, then press “Recheck status”."
      );
      return;
    }

    const [first] = runningPods;
    setSelectedRunpodPodId(first.id);
    try {
      window.localStorage.setItem(SELECTED_RUNPOD_POD_STORAGE_KEY, first.id);
    } catch {}
    setRunpodStatus(
      ko
        ? runningPods.length > 1
          ? `실행 중인 pod ${runningPods.length}개 중 첫 번째(${first.label || first.podId || first.id})를 선택했습니다.`
          : `실행 중인 pod(${first.label || first.podId || first.id})를 선택했습니다.`
        : runningPods.length > 1
          ? `Selected the first of ${runningPods.length} running pods (${first.label || first.podId || first.id}).`
          : `Selected the running pod (${first.label || first.podId || first.id}).`
    );
  }, [ko, refreshRunpodRunning, runpodPods]);

  const selectGenerationTarget = useCallback(
    (target: "local" | "runpod") => {
      setGenerationTarget(target);
      try {
        window.localStorage.setItem(GENERATION_TARGET_STORAGE_KEY, target);
      } catch {}
      if (target === "runpod") {
        resetRunpodConnection();
      } else {
        // Leaving RunPod mode arms the auto-select again for the next time it is
        // turned on (see the effect below).
        autoPodSelectRef.current = false;
      }
    },
    [resetRunpodConnection]
  );

  // Pick a running pod whenever RunPod mode is active — both when the user flips
  // the toggle and when the mode is restored from a previous visit — so the
  // selection is never left pointing at a stopped pod. Runs once per switch into
  // RunPod mode; a manual pick from the dropdown is not overridden.
  useEffect(() => {
    if (generationTarget !== "runpod" || runpodPods.length === 0) return;
    if (autoPodSelectRef.current) return;
    autoPodSelectRef.current = true;
    void autoSelectRunningRunpodPod();
  }, [autoSelectRunningRunpodPod, generationTarget, runpodPods]);

  const refreshComfyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/comfyui/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        running: boolean;
        starting: boolean;
        local: boolean;
        installed: boolean;
      };
      // Only update when something changed so the poll doesn't re-render the
      // whole page on every tick.
      setComfy((prev) =>
        prev.running === data.running &&
        prev.starting === data.starting &&
        prev.local === data.local &&
        prev.installed === data.installed
          ? prev
          : data
      );
    } catch {
      // Transient fetch error; leave the last known status in place.
    }
  }, []);

  const startComfy = useCallback(async () => {
    setComfyStartError("");
    setComfy((prev) => ({ ...prev, starting: true }));
    try {
      const res = await fetch("/api/comfyui/start", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setComfyStartError(
          (data as { error?: string })?.error || "Failed to start ComfyUI."
        );
        setComfy((prev) => ({ ...prev, starting: false }));
        return;
      }
      setComfy(data as typeof comfy);
    } catch {
      setComfyStartError("Failed to start ComfyUI.");
      setComfy((prev) => ({ ...prev, starting: false }));
    }
  }, []);

  // Poll the local ComfyUI status while in local mode. Poll quickly until it is
  // up (so the banner clears promptly once it boots), then back off.
  useEffect(() => {
    if (generationTarget !== "local") return;
    let active = true;
    const tick = () => {
      if (active) void refreshComfyStatus();
    };
    tick();
    const interval = setInterval(tick, comfy.running ? 15_000 : 3_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [generationTarget, refreshComfyStatus, comfy.running]);

  useEffect(() => {
    runpodConnectionRef.current = runpodConnection;
  }, [runpodConnection]);

  // First read after selecting a pod (once per target+pod combo).
  useEffect(() => {
    if (generationTarget !== "runpod" || !selectedRunpodPodId || activeGeneration) {
      return;
    }
    const key = `${generationTarget}:${selectedRunpodPodId}`;
    if (autoRunpodCheckKeyRef.current === key) return;
    autoRunpodCheckKeyRef.current = key;
    void refreshRunpodStatus();
    void refreshRunpodRunning();
  }, [
    activeGeneration,
    generationTarget,
    refreshRunpodRunning,
    refreshRunpodStatus,
    selectedRunpodPodId,
  ]);

  // Live read-only polling until both ComfyUI and the helper are reachable.
  useEffect(() => {
    if (generationTarget !== "runpod" || !selectedRunpodPodId || activeGeneration) {
      return;
    }
    const interval = setInterval(() => {
      if (runpodBusy) return;
      const current = runpodConnectionRef.current;
      if (current?.comfyReachable && current?.helperReachable) return;
      void refreshRunpodStatus();
    }, 5_000);
    return () => clearInterval(interval);
  }, [
    activeGeneration,
    generationTarget,
    refreshRunpodStatus,
    runpodBusy,
    selectedRunpodPodId,
  ]);

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

  // ComfyUI version gating: some checkpoints (e.g. int8-quantized Krea2) need a
  // newer ComfyUI build than the pod may be running. Compare the model's minimum
  // against the version the pod reports so the UI can warn + offer an upgrade.
  const requiredComfyVersion = useMemo(
    () => requiredComfyVersionForCheckpoint(params.model_name || ""),
    [params.model_name]
  );
  const currentComfyVersion = useMemo(
    () => parseComfyVersion(runpodConnection.comfyVersion),
    [runpodConnection.comfyVersion]
  );
  const comfyVersionOutdated = Boolean(
    requiredComfyVersion &&
      currentComfyVersion &&
      compareComfyVersions(currentComfyVersion, requiredComfyVersion) < 0
  );
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
  const allGallerySelected =
    galleryBatchImages.length > 0 &&
    selectedGalleryCount === galleryBatchImages.length;
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

  const replaceGallerySelection = useCallback((ids: Set<string>) => {
    setSelectedGalleryImageIds(ids);
  }, []);

  const selectAllGalleryImages = useCallback(() => {
    setSelectedGalleryImageIds(new Set(galleryBatchImages.map((image) => image.id)));
  }, [galleryBatchImages]);

  const clearGallerySelection = useCallback(() => {
    setSelectedGalleryImageIds(new Set());
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

  const checkRunpodFiles = useCallback(async () => {
    if (!selectedRunpodPodId) return null;

    const importedResources = useStore
      .getState()
      .civitaiImport.missingResources.map(
        (resource): ImportedCivitaiResource => ({
          type: resource.type,
          name: resource.name,
          versionName: resource.versionName,
          baseModel: resource.baseModel,
          weight: resource.weight,
          hash: resource.hash,
          modelId: resource.modelId,
          modelVersionId: resource.modelVersionId,
          url: resource.url,
        })
      );
    const response = await fetch(`/api/runpod/pods/${selectedRunpodPodId}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params, resources: importedResources }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "RunPod file check failed");
    const missing = Array.isArray(data.missing)
      ? (data.missing as RunpodMissingFile[])
      : [];
    setRunpodMissingFiles(missing);
    setRunpodFilesChecked(true);
    return missing;
  }, [params, selectedRunpodPodId]);

  // Ask the pod which custom-node packs the current Krea workflow still needs
  // (e.g. RES4LYF for the PornMaster recipe). Only meaningful for ComfyUI + a
  // workflow that has a node-pack requirement; otherwise clears the banner.
  const checkRunpodImageNodes = useCallback(async () => {
    if (
      generationTarget !== "runpod" ||
      !selectedRunpodPodId ||
      !runpodConnection.comfyReachable ||
      params.backend !== "comfyui" ||
      params.krea2_workflow !== "pornmaster"
    ) {
      setRunpodMissingNodePacks([]);
      return;
    }
    try {
      const res = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/image-nodes?workflow=${encodeURIComponent(
          params.krea2_workflow
        )}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as { packs?: { name: string; url: string }[] };
      setRunpodMissingNodePacks(res.ok && Array.isArray(data.packs) ? data.packs : []);
    } catch {
      setRunpodMissingNodePacks([]);
    }
  }, [
    generationTarget,
    params.backend,
    params.krea2_workflow,
    runpodConnection.comfyReachable,
    selectedRunpodPodId,
  ]);

  // Install the missing custom-node packs on the pod (git clone + pip + restart),
  // streaming progress into the banner status. Re-checks once ComfyUI is back.
  const installRunpodImageNodes = useCallback(async () => {
    if (!selectedRunpodPodId || runpodMissingNodePacks.length === 0 || nodeInstallBusy) return;
    setNodeInstallBusy(true);
    setNodeInstallStatus(
      ko
        ? `${runpodMissingNodePacks.length}개 노드 팩 설치 중... (pip 포함, 수 분 소요)`
        : `Installing ${runpodMissingNodePacks.length} node pack(s)... (incl. pip, may take minutes)`
    );
    try {
      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/install-nodes/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repos: runpodMissingNodePacks }),
        }
      );
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "Node install failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      const handle = (raw: string) => {
        if (!raw.startsWith("data:")) return;
        const event = JSON.parse(raw.slice(5).trim()) as {
          type?: string;
          name?: string;
          status?: string;
          message?: string;
          installed?: string[];
        };
        if (event.type === "error") streamError = event.message || "Node install failed.";
        if (event.type === "status" && event.message) {
          setNodeInstallStatus(event.message);
        }
        if (event.type === "repo" && event.name) {
          setNodeInstallStatus(`${event.name}: ${event.status ?? ""}`);
        }
        if (event.type === "complete") {
          const n = event.installed?.length ?? 0;
          setNodeInstallStatus(
            ko
              ? `설치 완료 (${n}개). ComfyUI 재시작 후 자동으로 다시 확인합니다.`
              : `Installed ${n} pack(s). Re-checking after ComfyUI restarts.`
          );
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine) handle(dataLine);
        }
      }
      if (buffer) {
        const dataLine = buffer.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) handle(dataLine);
      }
      if (streamError) throw new Error(streamError);
      // ComfyUI restarts after install; give it a moment, then re-verify.
      setTimeout(() => {
        void refreshRunpodStatus();
        void checkRunpodImageNodes();
      }, 8000);
    } catch (error) {
      setNodeInstallStatus(
        error instanceof Error ? error.message : "Failed to install custom nodes."
      );
    } finally {
      setNodeInstallBusy(false);
    }
  }, [
    checkRunpodImageNodes,
    ko,
    nodeInstallBusy,
    refreshRunpodStatus,
    runpodMissingNodePacks,
    selectedRunpodPodId,
  ]);

  // One-click PuLID install: streams the local setup script or the pod helper
  // install into the banner. `target` decides local vs RunPod endpoint.
  const installPulid = useCallback(
    async (target: "local" | "runpod") => {
      if (pulidInstall.running) return;
      if (target === "runpod" && !selectedRunpodPodId) {
        setPulidInstall({
          running: false,
          message: ko ? "RunPod 대상을 먼저 선택하세요." : "Select a RunPod target first.",
        });
        return;
      }
      const url =
        target === "runpod"
          ? `/api/runpod/pods/${selectedRunpodPodId}/pulid/install/stream`
          : "/api/comfyui/pulid/install/stream";
      setPulidInstall({
        running: true,
        message: ko ? "PuLID 설치 준비 중... (수 분 소요)" : "Preparing PuLID install... (may take minutes)",
      });
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok || !response.body) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || "PuLID install failed.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError = "";
        let doneMessage = "";
        const handle = (raw: string) => {
          if (!raw.startsWith("data:")) return;
          const event = JSON.parse(raw.slice(5).trim()) as { type?: string; message?: string };
          if (event.type === "error") streamError = event.message || "PuLID install failed.";
          else if (event.type === "complete") doneMessage = event.message || (ko ? "설치 완료." : "Installed.");
          else if (event.message) setPulidInstall({ running: true, message: event.message });
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
            if (dataLine) handle(dataLine);
          }
        }
        if (buffer) {
          const dataLine = buffer.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine) handle(dataLine);
        }
        if (streamError) throw new Error(streamError);
        setPulidInstall({
          running: false,
          message: doneMessage || (ko ? "설치 완료." : "Installed."),
        });
      } catch (error) {
        setPulidInstall({
          running: false,
          message: error instanceof Error ? error.message : "PuLID install failed.",
        });
      }
    },
    [ko, pulidInstall.running, selectedRunpodPodId]
  );

  // Update the pod's ComfyUI to the pinned version (git checkout + pip + restart),
  // streaming progress into the status line. Re-checks once ComfyUI is back so the
  // new version and the model's requirement re-reconcile automatically.
  const upgradeRunpodComfy = useCallback(async () => {
    if (!selectedRunpodPodId || comfyUpgradeBusy) return;
    setComfyUpgradeBusy(true);
    setComfyUpgradeStatus(
      ko
        ? "ComfyUI 업데이트 중... (git + pip, 수 분 소요, 완료 후 자동 재시작)"
        : "Upgrading ComfyUI... (git + pip, may take minutes, auto-restarts when done)"
    );
    try {
      const response = await fetch(
        `/api/runpod/pods/${selectedRunpodPodId}/comfyui/upgrade/stream`,
        { method: "POST", headers: { "Content-Type": "application/json" } }
      );
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || "ComfyUI upgrade failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamError = "";
      const handle = (raw: string) => {
        if (!raw.startsWith("data:")) return;
        const event = JSON.parse(raw.slice(5).trim()) as {
          type?: string;
          message?: string;
          version?: string;
        };
        if (event.type === "error") streamError = event.message || "ComfyUI upgrade failed.";
        if ((event.type === "status" || event.type === "log") && event.message) {
          setComfyUpgradeStatus(event.message);
        }
        if (event.type === "complete") {
          const v = event.version ? ` (v${event.version})` : "";
          setComfyUpgradeStatus(
            ko
              ? `업데이트 완료${v}. 상태를 다시 확인합니다.`
              : `Upgrade complete${v}. Re-checking status.`
          );
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
          if (dataLine) handle(dataLine);
        }
      }
      if (buffer) {
        const dataLine = buffer.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) handle(dataLine);
      }
      if (streamError) throw new Error(streamError);
      // ComfyUI restarts after the upgrade; give it time to rebind, then re-verify.
      setTimeout(() => {
        void refreshRunpodStatus();
      }, 12000);
    } catch (error) {
      setComfyUpgradeStatus(
        error instanceof Error ? error.message : "Failed to upgrade ComfyUI."
      );
    } finally {
      setComfyUpgradeBusy(false);
    }
  }, [comfyUpgradeBusy, ko, refreshRunpodStatus, selectedRunpodPodId]);

  // When a background RunPod download settles, re-verify which files are
  // present and report the result. `pendingRecheck` is a store flag, so this
  // fires even when the download finished while the page was unmounted: on
  // return the flag is still set and the check runs exactly once.
  useEffect(() => {
    if (!runpodPendingRecheck || !selectedRunpodPodId) return;
    const podId = selectedRunpodPodId;
    clearRunpodPendingRecheck(podId);
    void checkRunpodFiles()
      .then((missing) => {
        const list = missing ?? [];
        setRunpodDownloadMessage(
          podId,
          list.length === 0
            ? ko
              ? "RunPod에 다운로드했습니다. 생성 가능합니다."
              : "Downloaded to RunPod. Ready to generate."
            : ko
              ? `다운로드 후에도 누락 파일 ${list.length}개가 있습니다.`
              : `${list.length} file(s) are still missing after download.`
        );
      })
      .catch(() => {});
  }, [
    runpodPendingRecheck,
    selectedRunpodPodId,
    checkRunpodFiles,
    clearRunpodPendingRecheck,
    setRunpodDownloadMessage,
    ko,
  ]);

  // A signature of every model a generation would pull to RunPod. namesForParams
  // (server-side) derives the same set — keep the fields in sync.
  const runpodFileSignature = useMemo(
    () =>
      [
        params.model_name,
        params.krea2_workflow,
        params.vae_name,
        params.upscale_model_name,
        params.hires_upscale > 1 ? "hires" : "",
        params.adetailer_enabled ? params.adetailer_model : "",
        params.loras.map((lora) => lora.path).join(","),
        params.embeddings.map((embedding) => embedding.path).join(","),
      ].join("|"),
    [
      params.model_name,
      params.krea2_workflow,
      params.vae_name,
      params.upscale_model_name,
      params.hires_upscale,
      params.adetailer_enabled,
      params.adetailer_model,
      params.loras,
      params.embeddings,
    ]
  );

  // Proactively re-check RunPod files whenever that set changes while the pod is
  // reachable. Picking the PornMaster workflow, for instance, immediately lists
  // its extra files (heretic CLIP / Wan VAE / int8 checkpoint) with the Download
  // button below — no need to hit Generate first.
  useEffect(() => {
    if (
      generationTarget !== "runpod" ||
      !selectedRunpodPodId ||
      activeGeneration ||
      runpodBusy
    ) {
      return;
    }
    if (!runpodConnection.comfyReachable || !runpodConnection.helperReachable) {
      return;
    }
    const signature = `${selectedRunpodPodId}:${runpodFileSignature}`;
    if (autoRunpodFileSigRef.current === signature) return;
    autoRunpodFileSigRef.current = signature;
    void checkRunpodFiles().catch(() => {});
  }, [
    generationTarget,
    selectedRunpodPodId,
    activeGeneration,
    runpodBusy,
    runpodConnection.comfyReachable,
    runpodConnection.helperReachable,
    runpodFileSignature,
    checkRunpodFiles,
  ]);

  // Detect missing custom-node packs for the selected Krea workflow (e.g. RES4LYF
  // for PornMaster) as soon as the pod's ComfyUI is reachable, so the install
  // banner appears without needing a failed Generate.
  useEffect(() => {
    void checkRunpodImageNodes();
  }, [checkRunpodImageNodes]);

  // Publish the target/validation context the queue store needs so a background
  // enqueue (a Paimon batch that outlives this page) still generates against the
  // right backend and pre-checks RunPod files.
  useEffect(() => {
    setGenerationConfig({
      generationTarget,
      runpodPodId: selectedRunpodPodId,
      ko,
      modeError: generationModeError,
    });
  }, [
    generationModeError,
    generationTarget,
    ko,
    selectedRunpodPodId,
    setGenerationConfig,
  ]);

  const enqueueGeneration = useCallback(
    async (
      sourceParams: GenerationParamsType,
      meta?: { characterId?: string; situationId?: string }
    ) => {
      // Flag the "registering card" state up front; the finally below clears it
      // once the pending card exists (or an early return bails out).
      setIsSubmitting(true);
      try {
        await enqueueGenerationJob(sourceParams, meta, {
          onRunpodBusy: setRunpodBusy,
          onRunpodStatus: setRunpodStatus,
          onMissingFiles: (missing) => {
            setRunpodMissingFiles(missing);
            setRunpodFilesChecked(true);
          },
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [enqueueGenerationJob]
  );

  // Manual Generate press uses the current form params.
  const generate = useCallback(
    () => enqueueGeneration(params),
    [enqueueGeneration, params]
  );

  const selectedRunpodPod = useMemo(
    () => runpodPods.find((pod) => pod.id === selectedRunpodPodId),
    [runpodPods, selectedRunpodPodId]
  );

  const runRunpodAction = useCallback(
    async (action: "status" | "check" | "download" | "setup") => {
      // Note: a background download no longer blocks these actions. File checks
      // are read-only and safe mid-download, and the download queue appends new
      // files to the running batch, so status/check/download stay usable.
      if (!selectedRunpodPodId || runpodBusy) return;

      setRunpodBusy(action);
      setRunpodStatus("");
      // Drop any lingering download message so a non-download action's status
      // text is what shows in the UI.
      if (action !== "download") {
        setRunpodDownloadMessage(selectedRunpodPodId, "");
      }
      try {
        if (action === "status") {
          // Read-only: auto=1 never starts the pod or sets up ports. This app
          // never starts the pod — start it in the RunPod console.
          void refreshRunpodRunning();
          const response = await fetch(
            `/api/runpod/pods/${selectedRunpodPodId}/status?auto=1`,
            { cache: "no-store" }
          );
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "RunPod status failed");
          applyRunpodStatus(data);
          setRunpodStatus(
            [
              data.podDesiredStatus
                ? `RunPod ${String(data.podDesiredStatus).toLowerCase()}`
                : "",
              data.comfyReachable
                ? ko ? "ComfyUI 연결됨" : "ComfyUI reachable"
                : data.comfyInitializing
                  ? ko ? "ComfyUI 초기화 중" : "ComfyUI initializing"
                  : ko ? `ComfyUI 미연결: ${data.comfyError || ""}` : `ComfyUI unreachable: ${data.comfyError || ""}`,
              data.helperReachable
                ? data.helperOutdated
                  ? ko ? "Helper 업데이트 필요" : "Helper update needed"
                  : ko ? "Helper 연결됨" : "Helper reachable"
                : data.helperInitializing
                  ? ko ? "Helper 초기화 중" : "Helper initializing"
                  : ko ? `Helper 미연결: ${data.helperError || ""}` : `Helper unreachable: ${data.helperError || ""}`,
            ].filter(Boolean).join(" · ")
          );
        }

        if (action === "setup") {
          const response = await fetch(`/api/runpod/pods/${selectedRunpodPodId}/setup`, {
            method: "POST",
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "RunPod helper setup failed");
          setRunpodStatus(
            ko
              ? "Helper 시작 요청을 보냈습니다. 잠시 후 상태를 다시 확인합니다."
              : "Helper start requested. Rechecking status shortly."
          );
          window.setTimeout(() => {
            void refreshRunpodStatus();
          }, 1500);
        }

        if (action === "check") {
          const missing = (await checkRunpodFiles()) ?? [];
          setRunpodStatus(
            missing.length === 0
              ? ko ? "필요한 모델 파일이 모두 있습니다. 생성 가능합니다." : "All required files are present. Ready to generate."
              : ko ? `누락 파일 ${missing.length}개. 다운로드 버튼을 누르세요.` : `${missing.length} missing file(s). Click Download.`
          );
        }

        if (action === "download") {
          const downloadable = runpodMissingFiles.filter(
            (item) => canDownloadRunpodMissingFile(item)
          );
          if (downloadable.length === 0) {
            setRunpodStatus(
              ko
                ? "자동 다운로드 가능한 누락 파일이 없습니다."
                : "No missing files can be downloaded automatically."
            );
            return;
          }

          // Hand the batch to the module-level store. It keeps running (and its
          // progress keeps updating) even if this page unmounts, and the
          // pendingRecheck effect re-verifies files when it settles.
          await startRunpodDownload(
            selectedRunpodPodId,
            downloadable.map((item) => ({
              path: item.path,
              resource: item.resource,
            })),
            { ko }
          );
        }
      } catch (error) {
        setRunpodStatus(error instanceof Error ? error.message : "RunPod action failed");
      } finally {
        setRunpodBusy("");
      }
    },
    [
      applyRunpodStatus,
      checkRunpodFiles,
      ko,
      refreshRunpodRunning,
      refreshRunpodStatus,
      runpodBusy,
      runpodMissingFiles,
      selectedRunpodPodId,
      startRunpodDownload,
      setRunpodDownloadMessage,
    ]
  );

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


  const cancelGeneration = useCallback(
    (imageId?: string) => cancelGenerationJob(imageId),
    [cancelGenerationJob]
  );

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
  const runpodPodRunning =
    runpodConnection.comfyReachable ||
    runpodConnection.podDesiredStatus.toUpperCase() === "RUNNING";

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
                  onClick={() => selectGenerationTarget(item.value)}
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
                onChange={(event) => {
                  const nextPodId = event.target.value;
                  setSelectedRunpodPodId(nextPodId);
                  try {
                    if (nextPodId) {
                      window.localStorage.setItem(
                        SELECTED_RUNPOD_POD_STORAGE_KEY,
                        nextPodId
                      );
                    } else {
                      window.localStorage.removeItem(SELECTED_RUNPOD_POD_STORAGE_KEY);
                    }
                  } catch {}
                  resetRunpodConnection();
                }}
                className="h-9 max-w-40 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label="RunPod target"
              >
                {runpodPods.length === 0 ? (
                  <option value="">{ko ? "Pod 없음" : "No pod"}</option>
                ) : (
                  runpodPods.map((pod) => (
                    <option key={pod.id} value={pod.id}>
                      {(runpodRunningIds.has(pod.id) ? "🟢 " : "⚪ ") +
                        (pod.label || pod.podId || pod.id)}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {generationTarget === "local" && comfy.local && !comfy.running && (
            <div className="space-y-2 rounded-md border border-sky-500/40 bg-sky-500/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Server className="h-4 w-4 shrink-0 text-sky-600" />
                  <span className="text-sm font-semibold text-sky-700">
                    {ko ? "ComfyUI가 실행 중이 아닙니다" : "ComfyUI is not running"}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 gap-1 px-3 text-xs"
                  disabled={comfy.starting || !comfy.installed}
                  onClick={() => void startComfy()}
                >
                  {comfy.starting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Power className="h-3.5 w-3.5" />
                  )}
                  {comfy.starting
                    ? ko
                      ? "시작 중..."
                      : "Starting..."
                    : ko
                      ? "ComfyUI 켜기"
                      : "Start ComfyUI"}
                </Button>
              </div>
              <p className="text-xs text-sky-700/90">
                {!comfy.installed
                  ? ko
                    ? "ComfyUI가 설치되어 있지 않습니다. 터미널에서 npm run setup:comfyui 를 실행하세요."
                    : "ComfyUI is not installed. Run npm run setup:comfyui in a terminal."
                  : comfy.starting
                    ? ko
                      ? "ComfyUI를 시작하는 중입니다. 첫 실행은 시간이 걸릴 수 있습니다."
                      : "Starting ComfyUI. The first launch can take a little while."
                    : ko
                      ? "로컬 생성을 하려면 ComfyUI가 실행 중이어야 합니다."
                      : "Local generation needs ComfyUI running."}
              </p>
              {comfyStartError && (
                <p className="text-xs text-red-600">{comfyStartError}</p>
              )}
            </div>
          )}
          {generationTarget === "runpod" &&
            (runpodMissingNodePacks.length > 0 || nodeInstallStatus) && (
              <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span className="text-sm font-semibold text-amber-700">
                      {ko ? "커스텀 노드 설치 필요" : "Custom nodes required"}
                    </span>
                  </div>
                  {runpodMissingNodePacks.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1 px-3 text-xs"
                      disabled={nodeInstallBusy}
                      onClick={() => void installRunpodImageNodes()}
                    >
                      {nodeInstallBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <DownloadCloud className="h-3.5 w-3.5" />
                      )}
                      {ko ? "설치" : "Install"}
                    </Button>
                  )}
                </div>
                {runpodMissingNodePacks.length > 0 && (
                  <p className="text-xs text-amber-700/90">
                    {(ko
                      ? "이 워크플로우에 필요한 노드가 pod에 없습니다: "
                      : "This workflow needs nodes the pod is missing: ") +
                      runpodMissingNodePacks.map((pack) => pack.name).join(", ")}
                  </p>
                )}
                {nodeInstallStatus && (
                  <p className="text-xs text-muted-foreground">{nodeInstallStatus}</p>
                )}
              </div>
            )}
          {generationTarget === "runpod" && (
            <EditorSection
              title="RunPod"
              description={
                ko
                  ? "선택한 pod의 ComfyUI/Helper 연결 상태와 모델 파일만 조회합니다. 앱은 pod를 시작하지 않습니다."
                  : "Reads the selected pod's ComfyUI/Helper status and model files only. This app never starts the pod."
              }
            >
              <div className="space-y-3 rounded-md border border-border bg-card/80 p-3">
                <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                  <Server className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">
                    {selectedRunpodPod
                      ? `${selectedRunpodPod.label || selectedRunpodPod.podId || selectedRunpodPod.id} · ${selectedRunpodPod.comfyUrl || "ComfyUI URL 없음"}`
                      : ko ? "설정에서 RunPod pod를 추가하세요." : "Add a RunPod pod in Settings."}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      !runpodConnection.checked
                        ? "bg-muted text-muted-foreground"
                        : runpodConnection.comfyReachable
                          ? "bg-green-500/15 text-green-600"
                          : runpodConnection.comfyInitializing
                            ? "bg-yellow-500/15 text-yellow-600"
                            : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {!runpodConnection.checked ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : runpodConnection.comfyReachable ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : runpodConnection.comfyInitializing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {!runpodConnection.checked
                      ? ko ? "ComfyUI 미확인" : "ComfyUI unchecked"
                      : runpodConnection.comfyReachable
                        ? runpodConnection.comfyVersion
                          ? `ComfyUI v${runpodConnection.comfyVersion}`
                          : "ComfyUI OK"
                        : runpodConnection.comfyInitializing
                          ? ko ? "ComfyUI 초기화 중" : "ComfyUI initializing"
                          : "ComfyUI ?"}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      !runpodConnection.checked
                        ? "bg-muted text-muted-foreground"
                        : runpodConnection.helperReachable && runpodConnection.helperOutdated
                          ? "bg-yellow-500/15 text-yellow-600"
                          : runpodConnection.helperReachable
                            ? "bg-green-500/15 text-green-600"
                            : runpodConnection.helperInitializing
                              ? "bg-yellow-500/15 text-yellow-600"
                              : "bg-destructive/15 text-destructive"
                    }`}
                  >
                    {!runpodConnection.checked ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : runpodConnection.helperReachable && runpodConnection.helperOutdated ? (
                      <AlertTriangle className="h-3 w-3" />
                    ) : runpodConnection.helperReachable ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : runpodConnection.helperInitializing ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {!runpodConnection.checked
                      ? ko ? "Helper 미확인" : "Helper unchecked"
                      : runpodConnection.helperReachable && runpodConnection.helperOutdated
                        ? ko ? "Helper 업데이트 필요" : "Helper update needed"
                        : runpodConnection.helperReachable
                          ? "Helper OK"
                          : runpodConnection.helperInitializing
                            ? ko ? "Helper 초기화 중" : "Helper initializing"
                            : "Helper ?"}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                      runpodFilesChecked && runpodMissingFiles.length === 0
                        ? "bg-green-500/15 text-green-600"
                        : runpodMissingFiles.length > 0
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {runpodFilesChecked && runpodMissingFiles.length === 0
                      ? ko ? "파일 준비됨" : "Files ready"
                      : runpodMissingFiles.length > 0
                        ? ko ? `누락 ${runpodMissingFiles.length}` : `${runpodMissingFiles.length} missing`
                        : ko ? "파일 미확인" : "Files unchecked"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
                  {runpodConnection.checked &&
                    (!runpodConnection.helperReachable ||
                      runpodConnection.helperOutdated) &&
                    runpodPodRunning && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={
                          !selectedRunpodPodId ||
                          Boolean(runpodBusy)
                        }
                        onClick={() => void runRunpodAction("setup")}
                      >
                        {runpodBusy === "setup" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Wrench className="h-3.5 w-3.5" />
                        )}
                        {runpodConnection.helperReachable
                          ? ko ? "Helper 업데이트" : "Update helper"
                          : ko ? "Helper 초기화" : "Init helper"}
                      </Button>
                    )}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={
                      !selectedRunpodPodId ||
                      Boolean(runpodBusy)
                    }
                    onClick={() => void runRunpodAction("status")}
                  >
                    {runpodBusy === "status" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {ko ? "상태 다시 확인" : "Recheck status"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={
                      !selectedRunpodPodId ||
                      Boolean(runpodBusy)
                    }
                    onClick={() => void runRunpodAction("check")}
                  >
                    {runpodBusy === "check" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    {ko ? "파일 체크" : "Files"}
                  </Button>
                </div>
                {requiredComfyVersion && runpodConnection.checked && (
                  <div
                    className={`space-y-2 rounded-md border p-2 ${
                      comfyVersionOutdated || !currentComfyVersion
                        ? "border-yellow-500/30 bg-yellow-500/10"
                        : "border-green-500/30 bg-green-500/10"
                    }`}
                  >
                    <div className="flex items-start gap-1.5 text-xs">
                      {comfyVersionOutdated || !currentComfyVersion ? (
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-600" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                      )}
                      <span className="font-semibold">
                        {ko
                          ? `이 모델은 ComfyUI v${formatComfyVersion(requiredComfyVersion)} 이상이 필요합니다`
                          : `This model needs ComfyUI v${formatComfyVersion(requiredComfyVersion)}+`}
                        {" · "}
                        {ko ? "현재 " : "now "}
                        {currentComfyVersion
                          ? `v${runpodConnection.comfyVersion}`
                          : ko ? "확인 불가" : "unknown"}
                      </span>
                    </div>
                    {comfyVersionOutdated && (
                      <p className="text-xs text-muted-foreground">
                        {ko
                          ? "int8 체크포인트는 상위 버전 ComfyUI에서만 로드됩니다. 아래 버튼으로 업데이트하면 pod의 ComfyUI를 최신 고정 버전으로 올리고 자동 재시작합니다."
                          : "int8 checkpoints only load on a newer ComfyUI. The button upgrades the pod's ComfyUI to the pinned version and restarts it automatically."}
                      </p>
                    )}
                    {(comfyVersionOutdated || !currentComfyVersion) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        disabled={
                          !selectedRunpodPodId ||
                          comfyUpgradeBusy ||
                          !runpodConnection.helperReachable ||
                          !runpodPodRunning
                        }
                        onClick={() => void upgradeRunpodComfy()}
                      >
                        {comfyUpgradeBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <DownloadCloud className="h-3.5 w-3.5" />
                        )}
                        {ko ? "ComfyUI 버전업 & 재시작" : "Upgrade ComfyUI & restart"}
                      </Button>
                    )}
                    {comfyUpgradeStatus && (
                      <p className="text-xs text-muted-foreground break-words">
                        {comfyUpgradeStatus}
                      </p>
                    )}
                  </div>
                )}
                {runpodConnection.checked && !runpodPodRunning && (
                  <p className="flex items-start gap-1.5 rounded-md bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-700 dark:text-yellow-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {ko
                      ? "Pod가 실행 중이 아닙니다. RunPod 콘솔에서 직접 pod를 시작한 뒤 '상태 다시 확인'을 눌러주세요. (앱은 pod를 시작하지 않습니다.)"
                      : "Pod is not running. Start it yourself in the RunPod console, then press “Recheck status”. (This app never starts the pod.)"}
                  </p>
                )}
                {runpodMissingFiles.length > 0 && (
                  <div className="space-y-2 rounded-md border border-dashed border-destructive/30 bg-destructive/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-destructive">
                        {ko ? "RunPod 누락 파일" : "Missing on RunPod"}
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-[11px]"
                        disabled={
                          Boolean(runpodBusy) ||
                          !runpodMissingFiles.some(
                            (item) => canDownloadRunpodMissingFile(item)
                          )
                        }
                        onClick={() => void runRunpodAction("download")}
                      >
                        {runpodBusy === "download" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <DownloadCloud className="h-3.5 w-3.5" />
                        )}
                        {ko ? "다운로드" : "Download"}
                      </Button>
                    </div>
                    <div className="space-y-1">
                      {runpodMissingFiles.map((item) => {
                        const dl = selectedRunpodPodId
                          ? downloadManagerEntries[
                              runpodDownloadEntryId(selectedRunpodPodId, item.path)
                            ]
                          : undefined;
                        return (
                          <div
                            key={item.path}
                            className="rounded bg-background/80 px-2 py-1 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate font-medium">
                                {item.path}
                              </span>
                              {dl?.status === "downloading" && (
                                <span className="flex shrink-0 items-center gap-1 text-primary">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  {dl.percent !== null
                                    ? `${Math.round(dl.percent)}%`
                                    : ko
                                      ? "받는 중"
                                      : "downloading"}
                                </span>
                              )}
                              {dl?.status === "complete" && (
                                <span className="flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-500">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {ko ? "완료" : "done"}
                                </span>
                              )}
                              {dl?.status === "error" && (
                                <span className="shrink-0 font-medium text-destructive">
                                  {ko ? "실패" : "failed"}
                                </span>
                              )}
                            </div>
                            {!canDownloadRunpodMissingFile(item) && (
                              <div className="text-[11px] text-muted-foreground">
                                {ko
                                  ? "다운로드 출처가 없어 자동 다운로드할 수 없습니다."
                                  : "No download source is available."}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {runpodDownloading ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {ko
                      ? "다운로드가 백그라운드에서 진행 중입니다. "
                      : "Downloading in the background. "}
                    <Link
                      href="/downloads"
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {ko ? "다운로드 매니저에서 확인" : "Open Download Manager"}
                    </Link>
                  </p>
                ) : (
                  (runpodDownloadMessage || runpodStatus) && (
                    <p className="text-xs text-muted-foreground">
                      {runpodDownloadMessage || runpodStatus}
                    </p>
                  )
                )}
              </div>
            </EditorSection>
          )}

          <EditorSection title={ko ? "가져오기" : "Import"} description={ko ? "Civitai URL이나 이미지 메타데이터에서 프롬프트와 설정을 가져옵니다." : "Import prompts and settings from Civitai or image metadata."}>
          <CivitaiImport generationTarget={generationTarget} />
          <MetadataImport generationTarget={generationTarget} />
          </EditorSection>

          <EditorSection title={ko ? "모델" : "Models"} description={ko ? "기본 모델과 LoRA, 임베딩을 선택합니다." : "Choose the base model, LoRA, and embeddings."}>
            <ModelSelector
              generationTarget={generationTarget}
              runpodPodId={generationTarget === "runpod" ? selectedRunpodPodId : ""}
            />
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
                      description={ko ? "업로드 · 붙여넣기(⌘/Ctrl+V) · 갤러리에서 선택" : "Upload, paste (⌘/Ctrl+V), or pick from gallery"}
                      value={params.character_image}
                      onChange={(url) => setParams({ character_image: url })}
                    />
                    {params.character_image && (
                      <div className="mt-2">
                        <div className="mb-2 flex items-center justify-between">
                          <FieldHelp
                            label={ko ? "아이덴티티 강도" : "Identity Strength"}
                            help={ko ? "참조 인물의 얼굴을 얼마나 강하게 유지할지 조절합니다(PuLID). 높을수록 얼굴이 더 정확히 재현되지만 프롬프트·포즈 반영이 줄 수 있습니다. 권장 0.7–1.0. SDXL/Illustrious 계열에서만 적용됩니다." : "How strongly to preserve the reference face (PuLID). Higher reproduces the face more faithfully but follows the prompt/pose less. Sweet spot 0.7–1.0. SDXL/Illustrious checkpoints only."}
                          />
                          <span className="text-xs font-mono">
                            {params.character_reference_strength.toFixed(2)}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.05}
                          value={params.character_reference_strength}
                          onChange={(e) =>
                            setParams({
                              character_reference_strength: parseFloat(e.target.value),
                            })
                          }
                          className="w-full accent-primary"
                        />
                      </div>
                    )}
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
            <div className="mb-2 space-y-2">
              <pre className="max-h-48 select-text overflow-auto whitespace-pre-wrap break-words rounded border border-destructive/30 bg-destructive/5 p-2 text-[11px] leading-relaxed text-destructive">
                {status.message}
              </pre>
              {isPulidInstallableError(status.message) && (
                <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5">
                  <p className="mb-2 text-xs text-foreground">
                    {ko
                      ? "PuLID를 설치하면 캐릭터 참조(얼굴 일관성) 생성을 사용할 수 있습니다."
                      : "Install PuLID to enable Character Reference (identity) generation."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pulidInstall.running}
                      onClick={() => void installPulid("local")}
                    >
                      {ko ? "로컬에 설치" : "Install locally"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pulidInstall.running || !selectedRunpodPodId}
                      title={
                        !selectedRunpodPodId
                          ? ko
                            ? "RunPod 대상을 먼저 선택하세요"
                            : "Select a RunPod target first"
                          : undefined
                      }
                      onClick={() => void installPulid("runpod")}
                    >
                      {ko ? "RunPod에 설치" : "Install on RunPod"}
                    </Button>
                  </div>
                  {pulidInstall.message && (
                    <p className="mt-2 break-words text-xs text-muted-foreground">
                      {pulidInstall.running ? "⏳ " : ""}
                      {pulidInstall.message}
                    </p>
                  )}
                </div>
              )}
            </div>
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
              className="relative w-full cursor-pointer overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/40 hover:brightness-110"
              size="lg"
              onClick={generate}
              disabled={
                isSubmitting ||
                !params.prompt.trim() ||
                Boolean(generationModeError) ||
                runpodTargetMissing
              }
            >
              <span className="relative z-10 flex items-center justify-center gap-2 drop-shadow-sm">
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {ko ? "카드 등록 중..." : "Registering card..."}
                  </>
                ) : isGenerating || queuedJobCount > 0 ? (
                  "Add to Queue"
                ) : (
                  "Generate"
                )}
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={
                    allGallerySelected
                      ? clearGallerySelection
                      : selectAllGalleryImages
                  }
                  disabled={galleryBatchImages.length === 0}
                >
                  {allGallerySelected
                    ? ko ? "전체 해제" : "Deselect all"
                    : ko ? "전체 선택" : "Select all"}
                </Button>
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
          onReplaceSelection={replaceGallerySelection}
        />
      </main>

      <PaimonChat
        attachments={paimonAttachments}
        onAttachmentsChange={setPaimonAttachments}
        onOpenImage={setSelectedImage}
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
