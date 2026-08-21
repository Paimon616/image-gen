"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ImageUpload } from "@/components/image-upload";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface LocalCheckpoint {
  path: string;
  name: string;
  base_model?: string;
}

interface RunpodPod {
  podId: string;
  label?: string;
  comfyUrl?: string;
}

interface DatasetImage {
  file: string;
  url: string;
}

type Phase = "idle" | "running" | "done" | "error";

export function CharacterDatasetBootstrap() {
  const {
    images,
    language,
    fetchImagePage,
    imagesNextCursor,
    imagesTotal,
    isLoadingMoreImages,
  } = useStore();
  const ko = language === "ko";

  const [checkpoints, setCheckpoints] = useState<LocalCheckpoint[]>([]);
  const [pods, setPods] = useState<RunpodPod[]>([]);
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [baseModel, setBaseModel] = useState("");
  const [target, setTarget] = useState("local"); // "local" | podId
  const [datasetName, setDatasetName] = useState("");
  const [triggerWords, setTriggerWords] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    "low quality, blurry, worst quality, bad anatomy"
  );
  const [count, setCount] = useState(20);
  const [denoise, setDenoise] = useState(0.5);

  const [phase, setPhase] = useState<Phase>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [done, setDone] = useState(0);
  const [datasetImages, setDatasetImages] = useState<DatasetImage[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Load the first gallery page so the source picker's "Gallery" modal has images
  // even when the user lands here directly (the main gallery isn't mounted here).
  useEffect(() => {
    if (images.length === 0) void fetchImagePage(0).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((data) => {
        const assets = Array.isArray(data.checkpointAssets)
          ? (data.checkpointAssets as LocalCheckpoint[])
          : [];
        setCheckpoints(assets);
        // Default to a Krea 2 checkpoint if present (this feature's main use case).
        const krea = assets.find((a) => /krea[-_ ]?2/i.test(`${a.name} ${a.path}`));
        setBaseModel(krea?.path ?? assets[0]?.path ?? "");
      })
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const list = Array.isArray(data.runpodPods) ? (data.runpodPods as RunpodPod[]) : [];
        setPods(list.filter((p) => p.comfyUrl));
      })
      .catch(() => {});
  }, []);

  const refreshDataset = useCallback(async (name: string) => {
    if (!name.trim()) {
      setDatasetImages([]);
      return;
    }
    const res = await fetch(`/api/lora-training/dataset?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    setDatasetImages(Array.isArray(data.images) ? data.images : []);
  }, []);

  // Restore the last dataset name when returning to this page (state is otherwise
  // lost on unmount — the images themselves live on disk).
  useEffect(() => {
    const saved = localStorage.getItem("bootstrap:datasetName");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setDatasetName(saved);
  }, []);

  // Persist the name and reload that dataset's existing images from disk whenever
  // the name changes (debounced), so leaving/returning — or re-typing a name —
  // repopulates the grid instead of showing nothing.
  useEffect(() => {
    const name = datasetName.trim();
    localStorage.setItem("bootstrap:datasetName", name);
    if (phase === "running") return;
    const t = setTimeout(() => void refreshDataset(name), 350);
    return () => clearTimeout(t);
  }, [datasetName, phase, refreshDataset]);

  const canRun = useMemo(
    () => Boolean(sourceImage && baseModel && datasetName.trim()) && phase !== "running",
    [sourceImage, baseModel, datasetName, phase]
  );

  const run = useCallback(async () => {
    if (!canRun) return;
    setPhase("running");
    setDone(0);
    setStatusMessage(ko ? "생성 준비 중..." : "Preparing...");
    const body = {
      sourceImage,
      baseModel,
      datasetName: datasetName.trim(),
      triggerWords: triggerWords.trim(),
      count,
      denoise,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim(),
      generationTarget: target === "local" ? "local" : "runpod",
      runpodPodId: target === "local" ? undefined : target,
    };
    try {
      const res = await fetch("/api/lora-training/bootstrap/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Bootstrap failed.");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (raw: string) => {
        if (!raw.startsWith("data:")) return;
        const ev = JSON.parse(raw.slice(5).trim()) as {
          type?: string;
          message?: string;
          index?: number;
          saved?: number;
        };
        if (ev.type === "status" && ev.message) setStatusMessage(ev.message);
        else if (ev.type === "image") {
          setDone(ev.saved ?? 0);
          setStatusMessage(
            ko ? `생성 중... ${ev.index}/${count}` : `Generating... ${ev.index}/${count}`
          );
          void refreshDataset(datasetName.trim());
        } else if (ev.type === "warn") setStatusMessage(ev.message ?? "");
        else if (ev.type === "error") throw new Error(ev.message || "error");
        else if (ev.type === "complete") setStatusMessage(ev.message ?? "");
      };
      for (;;) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data:"));
          if (line) handle(line);
        }
      }
      await refreshDataset(datasetName.trim());
      setPhase("done");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Bootstrap failed.");
      setPhase("error");
      void refreshDataset(datasetName.trim());
    }
  }, [
    canRun,
    ko,
    sourceImage,
    baseModel,
    datasetName,
    triggerWords,
    count,
    denoise,
    prompt,
    negativePrompt,
    target,
    refreshDataset,
  ]);

  const deleteImage = useCallback(
    async (file: string) => {
      await fetch(
        `/api/lora-training/dataset?name=${encodeURIComponent(datasetName.trim())}&file=${encodeURIComponent(file)}`,
        { method: "DELETE" }
      );
      setDatasetImages((prev) => prev.filter((img) => img.file !== file));
    },
    [datasetName]
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">
            {ko ? "캐릭터 데이터셋 부트스트랩" : "Character Dataset Bootstrap"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {ko
              ? "인물 이미지 1장을 img2img 변형으로 늘려 LoRA 학습용 데이터셋을 만듭니다. 결과는 training/datasets/<이름>/ 에 캡션과 함께 저장됩니다."
              : "Turn one character image into a LoRA-ready dataset via img2img variations, saved with captions to training/datasets/<name>/."}
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-medium">
              {ko ? "소스 이미지 (인물)" : "Source image (character)"}
            </label>
            <ImageUpload
              label={ko ? "소스 이미지" : "Source image"}
              description={ko ? "업로드 · 붙여넣기 · 갤러리에서 선택" : "Upload, paste, or pick from gallery"}
              value={sourceImage}
              onChange={setSourceImage}
              onPreview={sourceImage ? () => setLightboxUrl(sourceImage) : undefined}
              galleryImages={images}
              galleryHasMore={imagesNextCursor !== null}
              galleryLoadingMore={isLoadingMoreImages}
              galleryTotal={imagesTotal}
              onLoadMoreGallery={() => {
                if (imagesNextCursor !== null) void fetchImagePage(imagesNextCursor);
              }}
            />
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">{ko ? "기반 모델" : "Base checkpoint"}</label>
              <select
                value={baseModel}
                onChange={(e) => setBaseModel(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {checkpoints.map((c) => (
                  <option key={c.path} value={c.path}>
                    {c.name || c.path}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">{ko ? "생성 대상" : "Run on"}</label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="local">{ko ? "로컬 ComfyUI" : "Local ComfyUI"}</option>
                {pods.map((p) => (
                  <option key={p.podId} value={p.podId}>
                    RunPod · {p.label || p.podId}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">{ko ? "데이터셋 이름" : "Dataset name"}</label>
                <input
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="my_character"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium">{ko ? "트리거 단어" : "Trigger words"}</label>
                <input
                  value={triggerWords}
                  onChange={(e) => setTriggerWords(e.target.value)}
                  placeholder="mychar"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium">{ko ? "프롬프트 (선택)" : "Prompt (optional)"}</label>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="1girl, nurse"
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium">{ko ? "네거티브" : "Negative"}</label>
            <input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">{ko ? "생성 매수" : "Count"}</label>
              <span className="text-xs font-mono">{count}</span>
            </div>
            <input
              type="range"
              min={4}
              max={40}
              step={1}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value, 10))}
              className="w-full accent-primary"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">{ko ? "변형 강도 (denoise)" : "Variation (denoise)"}</label>
              <span className="text-xs font-mono">{denoise.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.2}
              max={0.75}
              step={0.05}
              value={denoise}
              onChange={(e) => setDenoise(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={run} disabled={!canRun} size="lg">
            {phase === "running"
              ? ko
                ? "생성 중..."
                : "Generating..."
              : ko
                ? "데이터셋 생성"
                : "Build dataset"}
          </Button>
          {statusMessage && (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {phase === "running" ? "⏳ " : ""}
              {statusMessage}
            </span>
          )}
        </div>

        {datasetImages.length > 0 && (
          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              {ko ? "데이터셋" : "Dataset"}: {datasetImages.length}
              {ko ? "장 (나쁜 컷은 삭제)" : " images (delete bad ones)"}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {datasetImages.map((img) => (
                <div key={img.file} className="group relative overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(img.url)}
                    className="block w-full cursor-zoom-in focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="aspect-square w-full object-contain bg-muted/40" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteImage(img.file)}
                    className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={!!lightboxUrl} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent className="max-h-[92vh] w-[92vw] max-w-3xl overflow-hidden border border-border bg-card p-2 sm:max-w-3xl">
          <DialogTitle className="sr-only">{ko ? "이미지 미리보기" : "Image preview"}</DialogTitle>
          {lightboxUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightboxUrl}
              alt=""
              className="mx-auto max-h-[86vh] w-auto max-w-full rounded object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
