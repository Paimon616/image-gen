"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock3,
  ImagePlus,
  Info,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type TrainingState = "idle" | "ready" | "training" | "completed";
type RunnerState = "checking" | "not_configured" | "ready";

interface DatasetImage {
  id: string;
  name: string;
  url: string;
  file: File;
}

interface LocalCheckpoint {
  path: string;
  name: string;
  base_model: string;
}

// A dataset saved under training/datasets/ (built by the bootstrap page or a
// previous RunPod run), as returned by GET /api/lora-training/dataset.
interface SavedDataset {
  name: string;
  count: number;
  updatedAt: number;
  baseModel: string | null;
  triggerWords: string | null;
  thumbnail: string | null;
}

interface RunnerStatus {
  ready: boolean;
  runnerDir: string;
  pythonPath: string;
  trainScript: string;
  outputDir: string;
  missing: string[];
}

interface TrainingResult {
  runId: string;
  imageCount: number;
  outputName: string;
  outputPath: string;
  logPath: string;
  status: "idle" | "queued" | "running" | "completed" | "failed" | "cancelled";
  lines: string[];
  error: string;
}

interface LoraJobStatus {
  runId: string;
  loraName: string;
  triggerWords: string;
  category: string;
  baseModel: string;
  baseModelLabel: string;
  imageCount: number;
  outputName: string;
  outputPath: string;
  logPath: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  error: string;
  runpodPodId?: string;
  logTail?: string;
}

interface LoraJobsResponse {
  activeJob: LoraJobStatus | null;
  jobs: LoraJobStatus[];
}

const MIN_IMAGES = 10;
const MAX_IMAGES = 100;
const ACTIVE_JOB_STORAGE_KEY = "image-gen-active-lora-job";

function clampDataset(files: File[]) {
  return files.slice(0, MAX_IMAGES).map((file) => ({
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    name: file.name,
    url: URL.createObjectURL(file),
    file,
  }));
}

function checkpointTrainingSupport(checkpoint: LocalCheckpoint | undefined) {
  if (!checkpoint) return { supported: false, label: "", reason: "Select a checkpoint." };

  const normalized = `${checkpoint.base_model} ${checkpoint.name} ${checkpoint.path}`.toLowerCase();
  if (/\banima\b/.test(normalized)) {
    return {
      supported: false,
      label: checkpoint.base_model || checkpoint.name,
      reason: "Anima checkpoints need a dedicated training path and are not supported here yet.",
    };
  }

  if (/\bflux\b|flux\.1/.test(normalized)) {
    return {
      supported: false,
      label: checkpoint.base_model || checkpoint.name,
      reason: "Flux checkpoints are not supported by this SD/SDXL LoRA runner.",
    };
  }

  const supported =
    /sd\s*1\.?5|sd1|stable diffusion 1|sd\s*v?1|sdxl|xl|illustrious|pony|noobai|animagine/.test(
      normalized
    );

  return {
    supported,
    label: checkpoint.base_model || checkpoint.name,
    reason: supported
      ? ""
      : "Set this checkpoint metadata to SD 1.5, SDXL, Illustrious, or Pony before training.",
  };
}

export function LoraTraining() {
  const [dataset, setDataset] = useState<DatasetImage[]>([]);
  const [loraName, setLoraName] = useState("");
  const [triggerWords, setTriggerWords] = useState("");
  const [category, setCategory] = useState("");
  const [checkpoints, setCheckpoints] = useState<LocalCheckpoint[]>([]);
  const [baseModel, setBaseModel] = useState("");
  // Training target: "local" (sd-scripts on this machine) or a RunPod pod id.
  const [target, setTarget] = useState("local");
  const [pods, setPods] = useState<{ podId: string; label?: string; comfyUrl?: string }[]>([]);
  const [state, setState] = useState<TrainingState>("idle");
  const [runnerState, setRunnerState] = useState<RunnerState>("checking");
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [outputFile, setOutputFile] = useState("");
  const [trainingResult, setTrainingResult] = useState<TrainingResult>({
    runId: "",
    imageCount: 0,
    outputName: "",
    outputPath: "",
    logPath: "",
    status: "idle",
    lines: [],
    error: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // "이전 데이터셋에서 가져오기" picker: saved datasets on disk + import progress.
  const [datasetPickerOpen, setDatasetPickerOpen] = useState(false);
  const [savedDatasets, setSavedDatasets] = useState<SavedDataset[]>([]);
  const [savedDatasetsLoading, setSavedDatasetsLoading] = useState(false);
  const [importingDataset, setImportingDataset] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  // Checkpoint the imported dataset was generated with (from its _meta.json),
  // when it maps to an installed, trainable checkpoint — drives the ★ highlight
  // on the base-model select.
  const [datasetModel, setDatasetModel] = useState<string | null>(null);

  const datasetPercent = Math.min((dataset.length / MAX_IMAGES) * 100, 100);
  const selectedCheckpoint = checkpoints.find((checkpoint) => checkpoint.path === baseModel);
  const trainingSupport = checkpointTrainingSupport(selectedCheckpoint);
  const canPrepare =
    dataset.length >= MIN_IMAGES &&
    loraName.trim().length > 0 &&
    triggerWords.trim().length > 0 &&
    baseModel.trim().length > 0 &&
    trainingSupport.supported;
  const canStart = canPrepare && runnerState === "ready";
  const outputPath = useMemo(() => {
    const safeName = loraName.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/gi, "-");
    return safeName ? `ComfyUI/models/loras/${safeName}.safetensors` : "ComfyUI/models/loras/my-lora.safetensors";
  }, [loraName]);
  const missingRequirements = [
    dataset.length < MIN_IMAGES ? `이미지 ${MIN_IMAGES - dataset.length}장` : "",
    loraName.trim().length === 0 ? "LoRA 이름" : "",
    triggerWords.trim().length === 0 ? "trigger words" : "",
    baseModel.trim().length === 0 ? "기반 모델" : "",
  ].filter(Boolean);
  const footerMessage =
    runnerState === "checking"
      ? "LoRA runner 상태를 확인하는 중입니다."
      : runnerState !== "ready"
      ? "LoRA 파일 생성을 실행하려면 local training runner 연결이 필요합니다."
      : state === "training"
      ? statusMessage || `LoRA 파일 생성 중 ${progress}%`
      : state === "completed"
        ? `LoRA 파일 생성이 완료되었습니다. 출력 위치: ${outputFile || outputPath}`
        : baseModel.trim().length > 0 && !trainingSupport.supported
          ? trainingSupport.reason
        : canPrepare
          ? "LoRA 파일 생성 준비가 완료되었습니다"
          : `${missingRequirements.join(", ")}이 필요합니다`;
  const actionLabel =
    runnerState === "checking"
      ? "Runner 확인 중"
      : runnerState !== "ready"
      ? "Runner 연결 필요"
      : state === "training"
      ? "생성 중"
      : state === "completed"
        ? "다시 파일 생성"
        : "LoRA 파일 생성 시작";

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data) => {
        const checkpointAssets = Array.isArray(data.checkpointAssets)
          ? (data.checkpointAssets as LocalCheckpoint[])
          : [];
        setCheckpoints(checkpointAssets);
        setBaseModel(
          (current) =>
            current ||
            checkpointAssets.find((checkpoint) => checkpointTrainingSupport(checkpoint).supported)
              ?.path ||
            checkpointAssets[0]?.path ||
            ""
        );
      })
      .catch(() => {});
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const list = Array.isArray(data.runpodPods) ? data.runpodPods : [];
        setPods(list.filter((p: { comfyUrl?: string }) => p.comfyUrl));
      })
      .catch(() => {});
  }, []);

  function refreshRunnerStatus() {
    setRunnerState("checking");
    fetch("/api/lora-training/status")
      .then((res) => res.json())
      .then((data: RunnerStatus) => {
        setRunnerStatus(data);
        setRunnerState(data.ready ? "ready" : "not_configured");
      })
      .catch(() => {
        setRunnerStatus(null);
        setRunnerState("not_configured");
      });
  }

  useEffect(() => {
    fetch("/api/lora-training/status")
      .then((res) => res.json())
      .then((data: RunnerStatus) => {
        setRunnerStatus(data);
        setRunnerState(data.ready ? "ready" : "not_configured");
      })
      .catch(() => {
        setRunnerStatus(null);
        setRunnerState("not_configured");
      });
  }, []);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setDataset((current) => {
      const remaining = Math.max(MAX_IMAGES - current.length, 0);
      return [...current, ...clampDataset(imageFiles.slice(0, remaining))];
    });
    setState("ready");
  }

  function openDatasetPicker() {
    setImportError("");
    setDatasetPickerOpen(true);
    setSavedDatasetsLoading(true);
    fetch("/api/lora-training/dataset", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        setSavedDatasets(Array.isArray(data.datasets) ? data.datasets : []);
      })
      .catch(() => setSavedDatasets([]))
      .finally(() => setSavedDatasetsLoading(false));
  }

  async function importSavedDataset(name: string) {
    if (importingDataset) return;
    setImportingDataset(name);
    setImportError("");
    try {
      const res = await fetch(`/api/lora-training/dataset?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      const entries: { file: string; url: string }[] = Array.isArray(data.images)
        ? data.images
        : [];
      if (entries.length === 0) throw new Error("이 데이터셋에는 이미지가 없습니다.");

      // The dataset remembers which checkpoint generated it — pre-select it as
      // the training base model when it is installed and trainable here.
      const metaBaseModel = typeof data.baseModel === "string" ? data.baseModel : "";
      const metaCheckpoint = checkpoints.find((c) => c.path === metaBaseModel);
      if (metaCheckpoint && checkpointTrainingSupport(metaCheckpoint).supported) {
        setBaseModel(metaCheckpoint.path);
        setDatasetModel(metaCheckpoint.path);
      } else {
        setDatasetModel(null);
      }

      // Pull the on-disk images back as File objects so the existing upload flow
      // (local job POST / RunPod dataset save) works unchanged.
      const files = await Promise.all(
        entries.map(async (entry) => {
          const blob = await fetch(entry.url).then((r) => {
            if (!r.ok) throw new Error(`${entry.file} 불러오기 실패`);
            return r.blob();
          });
          return new File([blob], entry.file, { type: blob.type || "image/png" });
        })
      );

      setDataset((current) => {
        const remaining = Math.max(MAX_IMAGES - current.length, 0);
        return [...current, ...clampDataset(files.slice(0, remaining))];
      });
      setState("ready");
      setLoraName((current) => current || name);

      // Prefill trigger words when empty: prefer the dataset metadata, fall back
      // to the first caption file (NNN.txt next to each image).
      const metaTriggerWords = typeof data.triggerWords === "string" ? data.triggerWords.trim() : "";
      if (!triggerWords.trim() && metaTriggerWords) {
        setTriggerWords(metaTriggerWords);
      } else if (!triggerWords.trim()) {
        const firstCaption = entries[0]?.file.replace(/\.[^.]+$/, ".txt");
        if (firstCaption) {
          try {
            const capRes = await fetch(
              `/api/lora-training/dataset?name=${encodeURIComponent(name)}&file=${encodeURIComponent(firstCaption)}`
            );
            if (capRes.ok) {
              const text = (await capRes.text()).trim();
              if (text) setTriggerWords(text);
            }
          } catch {
            // Captions are optional — ignore.
          }
        }
      }

      setDatasetPickerOpen(false);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "데이터셋 가져오기에 실패했습니다.");
    } finally {
      setImportingDataset(null);
    }
  }

  function removeImage(id: string) {
    setDataset((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return current.filter((image) => image.id !== id);
    });
  }

  function resetParameters() {
    setCategory("");
    setTriggerWords("");
  }

  function appendResultLine(message: string) {
    const trimmed = message.trim();
    if (!trimmed) return;
    setTrainingResult((current) => ({
      ...current,
      lines: [...current.lines, trimmed].slice(-80),
    }));
  }

  const applyJobStatus = useCallback((job: LoraJobStatus) => {
    const lines = job.logTail ? job.logTail.split(/\r?\n/).filter(Boolean).slice(-80) : [];
    if (job.loraName) setLoraName(job.loraName);
    if (job.triggerWords) setTriggerWords(job.triggerWords);
    setCategory(job.category ?? "");
    if (job.baseModel) setBaseModel(job.baseModel);
    if (job.runpodPodId) setTarget(job.runpodPodId);
    setProgress(job.progress);
    setStatusMessage(job.message);
    setOutputFile(job.outputPath);
    setTrainingResult({
      runId: job.runId,
      imageCount: job.imageCount,
      outputName: job.outputName,
      outputPath: job.outputPath,
      logPath: job.logPath,
      status: job.state,
      lines,
      error: job.error,
    });

    if (job.state === "queued" || job.state === "running") {
      setState("training");
      localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, job.runId);
      return;
    }

    if (job.state === "completed") {
      setState("completed");
      localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
      return;
    }

    setState("ready");
    localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  }, []);

  const fetchJobStatus = useCallback(async (runId: string) => {
    const res = await fetch(`/api/lora-training/jobs/${runId}`, { cache: "no-store" });
    if (!res.ok) {
      if (res.status === 404) localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
      throw new Error("LoRA training job status could not be loaded.");
    }
    const data = (await res.json()) as LoraJobStatus;
    applyJobStatus(data);
    return data;
  }, [applyJobStatus]);

  useEffect(() => {
    const activeRunId = localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    const timeoutId = window.setTimeout(() => {
      if (activeRunId) {
        void fetchJobStatus(activeRunId).catch(() => {});
        return;
      }

      void fetch("/api/lora-training/jobs", { cache: "no-store" })
        .then((res) => res.json())
        .then((data: LoraJobsResponse) => {
          if (data.activeJob?.state === "queued" || data.activeJob?.state === "running") {
            applyJobStatus(data.activeJob);
          }
        })
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [applyJobStatus, fetchJobStatus]);

  useEffect(() => {
    const runId = trainingResult.runId;
    if (!runId || (trainingResult.status !== "queued" && trainingResult.status !== "running")) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void fetchJobStatus(runId).catch((error) => {
        setStatusMessage(error instanceof Error ? error.message : "Job status check failed.");
      });
    }, 2000);

    return () => window.clearInterval(intervalId);
  }, [fetchJobStatus, trainingResult.runId, trainingResult.status]);

  async function startRunpodTraining() {
    setState("training");
    setProgress(1);
    setOutputFile("");
    const datasetName = loraName.trim().replace(/[^A-Za-z0-9._가-힣-]+/g, "_") || "character";
    setStatusMessage("RunPod: 데이터셋 업로드 준비 중...");
    setTrainingResult({
      runId: "",
      imageCount: dataset.length,
      outputName: datasetName,
      outputPath: "",
      logPath: "",
      status: "running",
      lines: ["Uploading dataset to the pod..."],
      error: "",
    });

    try {
      // 1) persist the uploaded images to a named dataset the pod trainer reads
      const form = new FormData();
      form.append("name", datasetName);
      form.append("triggerWords", triggerWords);
      form.append("baseModel", baseModel);
      dataset.forEach((image) => form.append("images", image.file, image.name));
      const saveRes = await fetch("/api/lora-training/dataset/save", { method: "POST", body: form });
      if (!saveRes.ok) throw new Error((await saveRes.json()).error || "Dataset save failed.");

      // 2) queue the RunPod run as a server-side background job — the existing
      // job polling keeps tracking it even after navigating away and back.
      const res = await fetch("/api/lora-training/runpod/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runpodPodId: target,
          datasetName,
          baseModel,
          loraName: loraName.trim() || datasetName,
          triggerWords,
          category,
          outputName: datasetName,
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).error || "RunPod training failed.");
      }

      const data = (await res.json()) as LoraJobStatus;
      applyJobStatus(data);
      appendResultLine(`RunPod run queued: ${data.runId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "RunPod training failed.";
      setState("ready");
      setProgress(0);
      setStatusMessage(message);
      setTrainingResult((c) => ({ ...c, status: "failed", error: message }));
    }
  }

  async function startTraining() {
    if (!canStart || state === "training") return;
    if (target !== "local") {
      await startRunpodTraining();
      return;
    }
    setState("training");
    setProgress(1);
    setStatusMessage("Dataset을 전송하는 중...");
    setOutputFile("");
    setTrainingResult({
      runId: "",
      imageCount: dataset.length,
      outputName: "",
      outputPath: "",
      logPath: "",
      status: "running",
      lines: ["Preparing dataset upload..."],
      error: "",
    });

    const formData = new FormData();
    formData.append("loraName", loraName);
    formData.append("triggerWords", triggerWords);
    formData.append("category", category);
    formData.append("baseModel", baseModel);
    dataset.forEach((image) => {
      formData.append("images", image.file, image.name);
    });

    try {
      const res = await fetch("/api/lora-training/jobs", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        const missing = Array.isArray(data.missing) ? `\n${data.missing.join("\n")}` : "";
        throw new Error(`${data.error || "LoRA training failed"}${missing}`);
      }

      const data = (await res.json()) as LoraJobStatus;
      applyJobStatus(data);
      appendResultLine(`Run queued: ${data.runId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "LoRA training failed.";
      setState("ready");
      setProgress(0);
      setStatusMessage(message);
      setTrainingResult((current) => ({
        ...current,
        status: current.status === "failed" ? "failed" : "failed",
        error: current.error || message,
      }));
    }
  }

  async function cancelTraining() {
    const runId = trainingResult.runId;
    if (!runId || (trainingResult.status !== "queued" && trainingResult.status !== "running")) return;

    setStatusMessage("LoRA 학습을 취소하는 중...");
    try {
      const res = await fetch(`/api/lora-training/jobs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "LoRA training cancel failed.");
      }
      const data = (await res.json()) as LoraJobStatus;
      applyJobStatus(data);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "LoRA training cancel failed.");
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-normal text-foreground">LoRA 훈련</h1>
              <p className="mt-1 text-sm font-medium text-muted-foreground">
                이미지 dataset과 trigger words로 ComfyUI용 LoRA 파일을 준비합니다.
              </p>
            </div>
            <Badge
              variant={runnerState === "ready" && state === "completed" ? "default" : "secondary"}
              className="h-7 rounded-md px-3"
            >
              {runnerState === "checking"
                ? "Runner 확인 중"
                : runnerState !== "ready"
                ? "Runner 미연결"
                : state === "training"
                  ? "생성 중"
                  : state === "completed"
                    ? "파일 생성됨"
                    : "설정 중"}
            </Badge>
          </div>

          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="flex items-baseline gap-1.5">
                <h2 className="text-xl font-bold">이미지 데이터셋</h2>
                <span className={dataset.length < MIN_IMAGES ? "text-xl font-bold text-destructive" : "text-xl font-bold text-primary"}>
                  {dataset.length}/{MAX_IMAGES}
                </span>
              </div>
              <p className={dataset.length < MIN_IMAGES ? "mt-1 text-sm font-semibold text-destructive" : "mt-1 text-sm font-semibold text-primary"}>
                {dataset.length < MIN_IMAGES ? `최소 ${MIN_IMAGES}장 필요` : "데이터셋 준비됨"}
              </p>
            </div>
            <div className="text-sm font-semibold text-muted-foreground">최대 {MAX_IMAGES}</div>
          </div>

          <div className="mb-4 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${datasetPercent}%` }} />
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              addFiles(event.dataTransfer.files);
            }}
            className="flex min-h-[34rem] flex-col rounded-lg border-2 border-dashed border-border bg-card/50 p-4"
          >
            {dataset.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Clock3 className="h-8 w-8" />
                </div>
                {state === "training" && trainingResult.runId ? (
                  <>
                    <h3 className="text-lg font-bold text-foreground">Background job 진행 중</h3>
                    <p className="mt-2 max-w-md text-sm font-medium text-muted-foreground">
                      Dataset 이미지는 서버에 저장되었습니다.
                      {trainingResult.imageCount > 0 ? ` 업로드된 이미지: ${trainingResult.imageCount}장.` : ""}
                      {trainingResult.outputName ? ` 출력 이름: ${trainingResult.outputName}` : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <h3 className="text-lg font-bold text-foreground">생성 기록에서 선택</h3>
                    <p className="mt-2 max-w-md text-sm font-medium text-muted-foreground">
                      최근 작품에서 이미지를 추가하거나, 아래 버튼으로 직접 업로드할 수 있습니다.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {dataset.map((image, index) => (
                  <div key={image.id} className="group relative aspect-[3/4] overflow-hidden rounded-md border border-border bg-muted">
                    <img src={image.url} alt={image.name} className="h-full w-full object-cover" />
                    <div className="absolute bottom-2 left-2 rounded-md bg-foreground/75 px-2 py-1 text-xs font-bold text-background">
                      {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      className="absolute right-2 top-2 hidden h-7 w-7 items-center justify-center rounded-md bg-background/90 text-foreground shadow-sm ring-1 ring-border group-hover:flex"
                      aria-label="이미지 제거"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-auto pt-5">
              <div className="mb-4 flex items-center gap-4 text-sm font-semibold text-muted-foreground">
                <Separator className="flex-1" />
                또는 여기에 이미지를 드롭
                <Separator className="flex-1" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Button variant="outline" size="lg" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                  이미지 업로드
                </Button>
                <Button variant="outline" size="lg" onClick={openDatasetPicker}>
                  <ImagePlus className="h-4 w-4" />
                  이전 데이터셋에서 가져오기
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => addFiles(event.currentTarget.files)}
              />
            </div>
          </div>
        </section>

        <aside className="flex w-[28rem] shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-background px-5 py-5">
          <div className="rounded-lg bg-primary/10 p-4 text-sm font-semibold leading-6 text-primary">
            <div className="flex gap-3">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                {runnerState === "ready" ? (
                  <>
                    LoRA runner가 연결되었습니다. 생성 결과는 `ComfyUI/models/loras`에 저장됩니다.
                  </>
                ) : (
                  <>
                    `.safetensors` 파일을 만들려면 먼저 `npm run setup:lora-runner`를 실행한 뒤
                    dev server를 재시작하세요.
                  </>
                )}
                {runnerStatus?.missing && runnerStatus.missing.length > 0 && (
                  <div className="mt-2 space-y-1 text-xs text-primary/80">
                    {runnerStatus.missing.slice(0, 3).map((item) => (
                      <div key={item} className="truncate">{item}</div>
                    ))}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 bg-background/80"
                  onClick={refreshRunnerStatus}
                >
                  <RotateCcw className="h-4 w-4" />
                  Runner 다시 확인
                </Button>
              </div>
            </div>
          </div>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">매개변수 설정</h2>
              <Button variant="outline" size="sm" onClick={resetParameters}>
                <RotateCcw className="h-4 w-4" />
                재설정
              </Button>
            </div>

            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="lora-name" className="text-base font-bold">LoRA의 이름</Label>
                <Input
                  id="lora-name"
                  value={loraName}
                  onChange={(event) => setLoraName(event.currentTarget.value)}
                  placeholder="예: 내 LoRA"
                  className="h-11 text-base"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="trigger-words" className="text-base font-bold">
                  트리거 단어 <Info className="h-4 w-4" />
                </Label>
                <Textarea
                  id="trigger-words"
                  value={triggerWords}
                  onChange={(event) => setTriggerWords(event.currentTarget.value)}
                  placeholder="예: hatsune miku, aqua hair, twin tail"
                  className="min-h-24 resize-none text-base"
                />
                <p className="text-xs font-medium text-muted-foreground">
                  캐릭터의 핵심 특징 일부를 trigger로 삼고 256단어 이하로 조절하세요.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category" className="text-base font-bold">카테고리</Label>
                <div className="relative">
                  <select
                    id="category"
                    value={category}
                    onChange={(event) => setCategory(event.currentTarget.value)}
                    className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-base font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                  >
                    <option value="">카테고리를 선택하세요</option>
                    <option value="character">Character</option>
                    <option value="style">Style</option>
                    <option value="concept">Concept</option>
                    <option value="clothing">Clothing</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="train-target" className="text-base font-bold">생성 대상</Label>
                <div className="relative">
                  <select
                    id="train-target"
                    value={target}
                    onChange={(event) => setTarget(event.currentTarget.value)}
                    className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-base font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                  >
                    <option value="local">로컬 (이 컴퓨터)</option>
                    {pods.map((pod) => (
                      <option key={pod.podId} value={pod.podId}>
                        RunPod · {pod.label || pod.podId}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  {target === "local"
                    ? "로컬 sd-scripts로 학습합니다 (GPU 필요)."
                    : "RunPod 팟에서 학습합니다. 데이터셋과 결과는 자동으로 전송·회수됩니다."}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="base-model" className="text-base font-bold">
                  기반 모델 <Info className="h-4 w-4" />
                </Label>
                <div className="relative">
                  <select
                    id="base-model"
                    value={baseModel}
                    onChange={(event) => setBaseModel(event.currentTarget.value)}
                    className={`h-11 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-base font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 ${
                      datasetModel && baseModel === datasetModel
                        ? "border-primary ring-1 ring-primary/40"
                        : "border-input"
                    }`}
                  >
                    <option value="">기반 checkpoint를 선택하세요</option>
                    {checkpoints.map((checkpoint) => {
                      const support = checkpointTrainingSupport(checkpoint);
                      const isDatasetModel = checkpoint.path === datasetModel;
                      return (
                      <option
                        key={checkpoint.path}
                        value={checkpoint.path}
                        disabled={!support.supported}
                        className={isDatasetModel ? "font-semibold text-primary" : undefined}
                      >
                        {isDatasetModel ? "★ " : ""}
                        {checkpoint.name || checkpoint.path}
                        {isDatasetModel ? " — 데이터셋 생성 모델" : ""}
                        {!support.supported ? " (unsupported)" : ""}
                      </option>
                      );
                    })}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  LoRA는 독립 모델이 아니라 선택한 checkpoint 위에 얹히는 가중치입니다.
                </p>
                {datasetModel && (
                  <p className="text-xs font-medium text-muted-foreground">
                    {baseModel === datasetModel
                      ? "★ 데이터셋을 생성한 모델이 자동 선택되었습니다."
                      : "데이터셋 생성 모델(★)과 다른 모델이 선택되어 있습니다."}
                  </p>
                )}
                {selectedCheckpoint && (
                  <div className="rounded-md border border-border bg-muted/35 p-3 text-sm">
                    <div className="font-bold text-foreground">{selectedCheckpoint.name}</div>
                    <div className="mt-1 break-all text-xs font-medium text-muted-foreground">
                      {selectedCheckpoint.path}
                      {selectedCheckpoint.base_model ? ` · ${selectedCheckpoint.base_model}` : ""}
                    </div>
                  </div>
                )}
                {baseModel.trim().length > 0 && !trainingSupport.supported && (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
                    {trainingSupport.reason}
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="text-xs font-bold uppercase text-muted-foreground">출력 파일</div>
                <div className="mt-1 break-all text-sm font-semibold text-foreground">{outputPath}</div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Training Result</h2>
              <Badge
                variant={
                  trainingResult.status === "completed"
                    ? "default"
                    : trainingResult.status === "failed"
                      ? "destructive"
                      : "secondary"
                }
                className="rounded-md"
              >
                {trainingResult.status === "idle"
                  ? "Idle"
                  : trainingResult.status === "queued"
                    ? "Queued"
                  : trainingResult.status === "running"
                    ? "Running"
                    : trainingResult.status === "completed"
                      ? "Completed"
                      : trainingResult.status === "cancelled"
                        ? "Cancelled"
                        : "Failed"}
              </Badge>
            </div>

            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="text-xs font-bold uppercase text-muted-foreground">Output</div>
                <div className="mt-1 break-all font-semibold text-foreground">
                  {trainingResult.outputPath || outputFile || outputPath}
                </div>
              </div>

              {trainingResult.runId && (
                <div className="grid grid-cols-[5rem_1fr] gap-2 text-xs font-medium">
                  <div className="text-muted-foreground">Run ID</div>
                  <div className="break-all text-foreground">{trainingResult.runId}</div>
                </div>
              )}

              {trainingResult.logPath && (
                <div className="grid grid-cols-[5rem_1fr] gap-2 text-xs font-medium">
                  <div className="text-muted-foreground">Log</div>
                  <div className="break-all text-foreground">{trainingResult.logPath}</div>
                </div>
              )}

              {trainingResult.error && (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
                  {trainingResult.error}
                </div>
              )}

              <div className="rounded-md border border-border bg-muted/35">
                <div className="border-b border-border px-3 py-2 text-xs font-bold uppercase text-muted-foreground">
                  Recent Output
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 text-foreground">
                  {trainingResult.lines.length > 0
                    ? trainingResult.lines.join("\n")
                    : "No training output yet."}
                </pre>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <div className="border-t border-border bg-background px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-foreground">
              {footerMessage}
            </div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">
              {runnerState === "ready"
                ? "학습은 background job으로 실행됩니다. 다른 페이지로 이동해도 계속 진행됩니다."
                : "출력 대상은 `ComfyUI/models/loras`입니다. Runner 연결 전에는 파일이 생성되지 않습니다."}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {state === "training" && (
              <Button size="lg" variant="outline" className="rounded-full text-base" onClick={cancelTraining}>
                <X className="h-5 w-5" />
                취소
              </Button>
            )}
            <Button size="lg" className="min-w-64 rounded-full text-base" disabled={!canStart || state === "training"} onClick={startTraining}>
              {state === "training" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              {actionLabel}
            </Button>
          </div>
        </div>
        {state === "training" && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <Dialog open={datasetPickerOpen} onOpenChange={setDatasetPickerOpen}>
        <DialogContent className="max-h-[80vh] w-[92vw] max-w-2xl overflow-hidden border border-border bg-card p-0 sm:max-w-2xl">
          <DialogTitle className="border-b border-border px-5 py-3 text-sm font-semibold">
            저장된 데이터셋에서 가져오기
          </DialogTitle>
          <div className="max-h-[calc(80vh-3.25rem)] overflow-y-auto p-4">
            {importError && (
              <div className="mb-3 rounded-md border border-destructive/35 bg-destructive/10 p-3 text-sm font-semibold text-destructive">
                {importError}
              </div>
            )}
            {savedDatasetsLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                데이터셋 목록을 불러오는 중...
              </div>
            ) : savedDatasets.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                저장된 데이터셋이 없습니다. 데이터셋 부트스트랩 화면에서 먼저 만들어 주세요.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {savedDatasets.map((entry) => (
                  <button
                    key={entry.name}
                    type="button"
                    onClick={() => void importSavedDataset(entry.name)}
                    disabled={importingDataset !== null}
                    className="flex items-center gap-3 rounded-md border border-border p-2.5 text-left transition-colors hover:border-primary hover:bg-muted/60 disabled:opacity-60 focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    {entry.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.thumbnail}
                        alt=""
                        className="size-14 shrink-0 rounded object-cover bg-muted/40"
                      />
                    ) : (
                      <div className="size-14 shrink-0 rounded bg-muted/40" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{entry.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.count}장 · {new Date(entry.updatedAt).toLocaleDateString("ko-KR")}
                      </p>
                      {entry.baseModel && (
                        <p className="truncate text-xs text-muted-foreground">
                          모델:{" "}
                          {checkpoints.find((c) => c.path === entry.baseModel)?.name ||
                            entry.baseModel}
                        </p>
                      )}
                    </div>
                    {importingDataset === entry.name && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
