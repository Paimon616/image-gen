"use client";

import { useMemo, useRef, useState } from "react";
import {
  Check,
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

type ModelType = "dit2" | "dit1" | "sdxl" | "other";
type TrainingState = "idle" | "ready" | "training" | "completed";

interface DatasetImage {
  id: string;
  name: string;
  url: string;
}

interface ThemeOption {
  id: string;
  label: string;
  image: string;
}

const MIN_IMAGES = 10;
const MAX_IMAGES = 100;

const THEME_OPTIONS: ThemeOption[] = [
  { id: "illustrious-v1", label: "Illustrious-v1.0", image: "/image_1.png" },
  { id: "noobai-xl", label: "NoobAI XL", image: "/image_2.png" },
  { id: "hinata-v2", label: "Hinata v2", image: "/screenshot.png" },
  { id: "illustrious-v01", label: "Illustrious-v0.1", image: "/image_1.png" },
  { id: "haruka-v2", label: "Haruka-v2", image: "/image_2.png" },
  { id: "otome-v2", label: "Otome-v2", image: "/screenshot.png" },
];

const MODEL_TYPES: { id: ModelType; label: string; badge?: string }[] = [
  { id: "dit2", label: "DiT.2", badge: "NEW" },
  { id: "dit1", label: "DiT.1" },
  { id: "sdxl", label: "SDXL" },
  { id: "other", label: "Other..." },
];

function clampDataset(files: File[]) {
  return files.slice(0, MAX_IMAGES).map((file) => ({
    id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`,
    name: file.name,
    url: URL.createObjectURL(file),
  }));
}

export function LoraTraining() {
  const [dataset, setDataset] = useState<DatasetImage[]>([]);
  const [loraName, setLoraName] = useState("");
  const [triggerWords, setTriggerWords] = useState("");
  const [category, setCategory] = useState("");
  const [modelType, setModelType] = useState<ModelType>("sdxl");
  const [selectedTheme, setSelectedTheme] = useState("illustrious-v1");
  const [state, setState] = useState<TrainingState>("idle");
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const datasetPercent = Math.min((dataset.length / MAX_IMAGES) * 100, 100);
  const canStart =
    dataset.length >= MIN_IMAGES && loraName.trim().length > 0 && triggerWords.trim().length > 0;
  const creditCost = modelType === "sdxl" ? 25000 : modelType === "dit1" ? 42000 : 55000;
  const outputPath = useMemo(() => {
    const safeName = loraName.trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/gi, "-");
    return safeName ? `ComfyUI/models/loras/${safeName}.safetensors` : "ComfyUI/models/loras/my-lora.safetensors";
  }, [loraName]);

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
    setModelType("sdxl");
    setSelectedTheme("illustrious-v1");
    setCategory("");
    setTriggerWords("");
  }

  function startTraining() {
    if (!canStart || state === "training") return;
    setState("training");
    setProgress(8);

    const steps = [18, 31, 47, 64, 79, 92, 100];
    steps.forEach((step, index) => {
      window.setTimeout(() => {
        setProgress(step);
        if (step === 100) setState("completed");
      }, 500 + index * 450);
    });
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
            <Badge variant={state === "completed" ? "default" : "secondary"} className="h-7 rounded-md px-3">
              {state === "training" ? "훈련 중" : state === "completed" ? "파일 준비됨" : "설정 중"}
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
                {dataset.length < MIN_IMAGES ? `최소 ${MIN_IMAGES}장 필요` : "훈련 시작 가능"}
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
              <div>
                로컬 LoRA 훈련 runner를 연결하면 이 설정으로 `.safetensors` 파일을 생성하고
                `ComfyUI/models/loras`에 저장할 수 있습니다.
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

              <div className="space-y-3">
                <Label className="text-base font-bold">
                  모델 유형 <Info className="h-4 w-4" />
                </Label>
                <div className="flex flex-wrap gap-3">
                  {MODEL_TYPES.map((type) => (
                    <button
                      key={type.id}
                      type="button"
                      onClick={() => setModelType(type.id)}
                      className="flex h-9 items-center gap-2 rounded-md px-1 text-base font-bold"
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                        modelType === type.id ? "border-primary bg-primary text-primary-foreground" : "border-foreground"
                      }`}>
                        {modelType === type.id && <span className="h-2 w-2 rounded-full bg-current" />}
                      </span>
                      {type.label}
                      {type.badge && <Badge className="h-5 rounded-md bg-pink-500 px-1.5 text-[10px]">{type.badge}</Badge>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-base font-bold">모델 테마</Label>
                <div className="grid grid-cols-2 gap-3">
                  {THEME_OPTIONS.map((theme) => {
                    const selected = selectedTheme === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setSelectedTheme(theme.id)}
                        className={`overflow-hidden rounded-lg border bg-background text-left transition-all ${
                          selected ? "border-primary ring-3 ring-primary/25" : "border-border hover:border-primary/40"
                        }`}
                      >
                        <div className="relative aspect-[4/3] bg-muted">
                          <img src={theme.image} alt={theme.label} className="h-full w-full object-cover" />
                          {selected && (
                            <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                        <div className="truncate px-3 py-2 text-center text-sm font-bold">{theme.label}</div>
                      </button>
                    );
                  })}
                </div>
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
              {state === "training"
                ? `훈련 진행 중 ${progress}%`
                : state === "completed"
                  ? "LoRA 파일 생성 준비가 완료되었습니다"
                  : canStart
                    ? "훈련을 시작할 수 있습니다"
                    : `이미지 ${Math.max(MIN_IMAGES - dataset.length, 0)}장과 이름, trigger words가 필요합니다`}
            </div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">
              예상 비용 {creditCost.toLocaleString("ko-KR")} credits · Runner 연결 후 실제 훈련 job으로 전송됩니다.
            </div>
          </div>
          <Button size="lg" className="min-w-64 rounded-full text-base" disabled={!canStart || state === "training"} onClick={startTraining}>
            {state === "training" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
            {state === "training" ? "훈련 중" : state === "completed" ? "다시 훈련 시작" : "훈련 시작"}
            <span className="ml-3 font-bold">{creditCost.toLocaleString("ko-KR")}</span>
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
