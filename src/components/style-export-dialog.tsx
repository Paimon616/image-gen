"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { useGenerationQueueStore } from "@/lib/generation-queue-store";
import type { GeneratedImage } from "@/lib/types";
import { PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isValidStyleId, USER_PROMPT_TOKEN, type StyleSpec } from "@/lib/style-spec";

// Exports a generated image's settings as a portable style spec (JSON) that a
// product can run on its own ComfyUI (RunPod) without image-gen. The image itself
// becomes the style's thumbnail.
export function StyleExportButton({ image }: { image: GeneratedImage }) {
  const { language } = useStore();
  const generationTarget = useGenerationQueueStore((state) => state.config.generationTarget);
  const runpodPodId = useGenerationQueueStore((state) => state.config.runpodPodId);
  const params = image.params;
  const ko = language === "ko";
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [nameKo, setNameKo] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [version, setVersion] = useState(1);
  const [description, setDescription] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<StyleSpec | null>(null);

  const hasReferences = Boolean(
    params &&
      (params.character_image ||
        params.style_image ||
        params.source_image ||
        params.pose_reference_image ||
        params.scene_reference_image ||
        params.character_sheet_image ||
        params.controlnets?.some((controlnet) => controlnet.image))
  );

  const openDialog = () => {
    setPromptTemplate(params?.prompt ?? "");
    setError("");
    setResult(null);
    setOpen(true);
  };

  const idValid = isValidStyleId(id);
  const canExport = idValid && nameKo.trim() && version >= 1 && !busy;

  const exportStyle = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/styles/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageFilename: image.filename,
          meta: {
            id,
            version,
            name: { ko: nameKo.trim(), en: nameEn.trim() || nameKo.trim() },
            description,
          },
          promptTemplate,
          generationTarget,
          runpodPodId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const spec = data as StyleSpec;
      setResult(spec);
      const blob = new Blob([JSON.stringify(spec, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${spec.id}.v${spec.version}.style.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={openDialog}
        disabled={!params || params.backend !== "comfyui"}
        title={
          ko
            ? "이 이미지를 만든 설정을 다른 서비스가 쓸 수 있는 스타일 JSON으로 내보냅니다"
            : "Export the settings behind this image as a style JSON other services can run"
        }
      >
        <PackageOpen className="h-4 w-4" />
        {ko ? "스타일로 내보내기" : "Export as style"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{ko ? "스타일로 내보내기" : "Export as style"}</DialogTitle>
            <DialogDescription>
              {ko
                ? "이 이미지를 만든 모델 · LoRA · 샘플링 설정으로 ComfyUI 워크플로를 만들어 JSON으로 내보냅니다. 다른 서비스는 이 파일만으로 같은 스타일을 생성할 수 있고, 이 이미지는 스타일 썸네일로 들어갑니다."
                : "Builds the ComfyUI workflow from the model · LoRA · sampling setup behind this image and exports it as JSON. Another service can generate this style from the file alone; this image becomes the style thumbnail."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.filename ? `/api/images/thumb/${image.filename}` : image.url}
                alt=""
                className="h-20 w-20 shrink-0 rounded-md border border-border object-cover"
              />
              <div className="min-w-0 text-xs leading-5 text-muted-foreground">
                <div className="truncate font-medium text-foreground">{params?.model_name}</div>
                <div>
                  {params?.width}×{params?.height} · {params?.num_inference_steps}
                  {ko ? "스텝" : " steps"} · CFG {params?.guidance_scale}
                </div>
                {hasReferences && (
                  <div className="text-amber-600 dark:text-amber-400">
                    {ko
                      ? "이 이미지는 참조 이미지를 썼습니다. 스타일에는 참조가 빠지므로 결과가 달라질 수 있습니다."
                      : "This image used reference images. They are left out of the style, so results may differ."}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-[1fr_5rem] gap-2">
              <div className="grid gap-1">
                <Label htmlFor="style-id">ID</Label>
                <Input
                  id="style-id"
                  value={id}
                  placeholder="soft-anime"
                  onChange={(event) => setId(event.target.value.toLowerCase())}
                  aria-invalid={Boolean(id) && !idValid}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="style-version">{ko ? "버전" : "Version"}</Label>
                <Input
                  id="style-version"
                  type="number"
                  min={1}
                  value={version}
                  onChange={(event) => setVersion(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                />
              </div>
            </div>
            {id && !idValid && (
              <p className="text-xs text-destructive">
                {ko ? "영문 소문자 · 숫자 · 대시만 쓸 수 있습니다." : "Use lowercase letters, digits and dashes."}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="style-name-ko">{ko ? "이름 (한국어)" : "Name (Korean)"}</Label>
                <Input id="style-name-ko" value={nameKo} onChange={(event) => setNameKo(event.target.value)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="style-name-en">{ko ? "이름 (영어)" : "Name (English)"}</Label>
                <Input id="style-name-en" value={nameEn} onChange={(event) => setNameEn(event.target.value)} />
              </div>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="style-prompt">{ko ? "스타일 프롬프트" : "Style prompt"}</Label>
              <Textarea
                id="style-prompt"
                rows={4}
                value={promptTemplate}
                onChange={(event) => setPromptTemplate(event.target.value)}
              />
              <p className="text-[11px] leading-4 text-muted-foreground">
                {ko
                  ? `사용자 입력이 들어갈 자리에 ${USER_PROMPT_TOKEN}를 쓰세요. 없으면 맨 뒤에 붙습니다. 네거티브 프롬프트는 현재 값이 그대로 고정됩니다.`
                  : `Write ${USER_PROMPT_TOKEN} where the user's text goes; without it the text is appended. The current negative prompt is kept as is.`}
              </p>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="style-description">{ko ? "설명 (선택)" : "Description (optional)"}</Label>
              <Input id="style-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            {result && (
              <div className="rounded-md border border-border bg-secondary/40 p-2 text-xs leading-5">
                <div className="font-medium">
                  {ko ? "저장했습니다" : "Saved"}: {result.id}.v{result.version}.style.json
                </div>
                <div>
                  {ko ? "입력 연결" : "Bound inputs"}: prompt {result.inputs.prompt.length} · seed{" "}
                  {result.inputs.seed.length} · {ko ? "크기" : "size"}{" "}
                  {result.sizeAdjustable ? (ko ? "변경 가능" : "adjustable") : ko ? "고정" : "fixed"}
                </div>
                <div className="break-all text-muted-foreground">
                  {ko ? "필요한 모델 파일" : "Required files"}: {result.requiredFiles.join(", ")}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" onClick={exportStyle} disabled={!canExport}>
              {busy ? (ko ? "만드는 중…" : "Building…") : ko ? "JSON 내보내기" : "Export JSON"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
