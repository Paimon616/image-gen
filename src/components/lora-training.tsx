"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

interface RunnerStatus {
  ready: boolean;
  runnerDir: string;
  pythonPath: string;
  trainScript: string;
  outputDir: string;
  missing: string[];
}

const MIN_IMAGES = 10;
const MAX_IMAGES = 100;

function clampDataset(files: File[]) {
  return files.slice(0, MAX_IMAGES).map((file) => ({
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    name: file.name,
    url: URL.createObjectURL(file),
    file,
  }));
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

export function LoraTraining() {
  const [dataset, setDataset] = useState<DatasetImage[]>([]);
  const [loraName, setLoraName] = useState("");
  const [triggerWords, setTriggerWords] = useState("");
  const [category, setCategory] = useState("");
  const [checkpoints, setCheckpoints] = useState<LocalCheckpoint[]>([]);
  const [baseModel, setBaseModel] = useState("");
  const [state, setState] = useState<TrainingState>("idle");
  const [runnerState, setRunnerState] = useState<RunnerState>("checking");
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [outputFile, setOutputFile] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const datasetPercent = Math.min((dataset.length / MAX_IMAGES) * 100, 100);
  const canPrepare =
    dataset.length >= MIN_IMAGES &&
    loraName.trim().length > 0 &&
    triggerWords.trim().length > 0 &&
    baseModel.trim().length > 0;
  const canStart = canPrepare && runnerState === "ready";
  const outputPath = useMemo(() => {
    const safeName = loraName.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/gi, "-");
    return safeName ? `ComfyUI/models/loras/${safeName}.safetensors` : "ComfyUI/models/loras/my-lora.safetensors";
  }, [loraName]);
  const selectedCheckpoint = checkpoints.find((checkpoint) => checkpoint.path === baseModel);
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
        setBaseModel((current) => current || checkpointAssets[0]?.path || "");
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

  async function startTraining() {
    if (!canStart || state === "training") return;
    setState("training");
    setProgress(1);
    setStatusMessage("Dataset을 전송하는 중...");
    setOutputFile("");

    const formData = new FormData();
    formData.append("loraName", loraName);
    formData.append("triggerWords", triggerWords);
    formData.append("category", category);
    formData.append("baseModel", baseModel);
    dataset.forEach((image) => {
      formData.append("images", image.file, image.name);
    });

    try {
      const res = await fetch("/api/lora-training/generate/stream", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        const missing = Array.isArray(data.missing) ? `\n${data.missing.join("\n")}` : "";
        throw new Error(`${data.error || "LoRA training failed"}${missing}`);
      }

      if (!res.body) {
        throw new Error("LoRA training stream did not start.");
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

          if (event === "progress") {
            setProgress(Number(data?.progress ?? 1));
            setStatusMessage(String(data?.message ?? "LoRA 파일 생성 중..."));
          }

          if (event === "log" && data?.message) {
            setStatusMessage(String(data.message));
          }

          if (event === "complete") {
            setProgress(100);
            setOutputFile(String(data?.outputPath ?? ""));
            setStatusMessage("LoRA 파일 생성 완료");
            setState("completed");
            completed = true;
          }

          if (event === "error") {
            throw new Error(data?.error || "LoRA training failed.");
          }
        }
      }
    } catch (error) {
      setState("ready");
      setProgress(0);
      setStatusMessage(error instanceof Error ? error.message : "LoRA training failed.");
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
                <h3 className="text-lg font-bold text-foreground">생성 기록에서 선택</h3>
                <p className="mt-2 max-w-md text-sm font-medium text-muted-foreground">
                  최근 작품에서 이미지를 추가하거나, 아래 버튼으로 직접 업로드할 수 있습니다.
                </p>
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
                <Button variant="outline" size="lg" disabled>
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
                <Label htmlFor="base-model" className="text-base font-bold">
                  기반 모델 <Info className="h-4 w-4" />
                </Label>
                <div className="relative">
                  <select
                    id="base-model"
                    value={baseModel}
                    onChange={(event) => setBaseModel(event.currentTarget.value)}
                    className="h-11 w-full appearance-none rounded-md border border-input bg-background px-3 pr-9 text-base font-medium outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                  >
                    <option value="">기반 checkpoint를 선택하세요</option>
                    {checkpoints.map((checkpoint) => (
                      <option key={checkpoint.path} value={checkpoint.path}>
                        {checkpoint.name || checkpoint.path}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">
                  LoRA는 독립 모델이 아니라 선택한 checkpoint 위에 얹히는 가중치입니다.
                </p>
                {selectedCheckpoint && (
                  <div className="rounded-md border border-border bg-muted/35 p-3 text-sm">
                    <div className="font-bold text-foreground">{selectedCheckpoint.name}</div>
                    <div className="mt-1 break-all text-xs font-medium text-muted-foreground">
                      {selectedCheckpoint.path}
                      {selectedCheckpoint.base_model ? ` · ${selectedCheckpoint.base_model}` : ""}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-muted/35 p-3">
                <div className="text-xs font-bold uppercase text-muted-foreground">출력 파일</div>
                <div className="mt-1 break-all text-sm font-semibold text-foreground">{outputPath}</div>
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
                ? "실행 중 브라우저를 닫으면 현재 training process가 중단됩니다."
                : "출력 대상은 `ComfyUI/models/loras`입니다. Runner 연결 전에는 파일이 생성되지 않습니다."}
            </div>
          </div>
          <Button size="lg" className="min-w-64 rounded-full text-base" disabled={!canStart || state === "training"} onClick={startTraining}>
            {state === "training" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {actionLabel}
          </Button>
        </div>
        {state === "training" && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </main>
  );
}
