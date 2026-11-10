"use client";

import { useRef, useState } from "react";
import { Copy, ImageIcon, ImagePlus, Layers, Loader2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import type { GenerationParams } from "@/lib/types";
import { MODEL_PRESETS, presetToParams } from "@/lib/model-presets";
import {
  buildVariationPrompts,
  VARIATION_COUNTS,
  VARIATION_NEGATIVE_PROMPT,
  VARIATION_REFERENCE_STRENGTH,
  type ReferenceAnalysis,
} from "@/lib/reference-variations";
import { FieldHelp } from "@/components/field-help";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ReferenceFromUrlResponse {
  url: string;
  sourceImageUrl: string;
  width: number;
  height: number;
  sourcePrompt: string | null;
  prompt: string | null;
  error?: string;
}

const COPY_PRESET_ID = "krea2-identity-adult";
// The copy keeps the reference's outfit and pose: Identity Edit copies those from
// about 0.9 up (below 0.6 the face drifts).
const COPY_REFERENCE_STRENGTH = 0.9;
// Dynamic Poses pushes the pose away from the reference, which a copy must not do.
const COPY_DROPPED_LORA = /More_Dynamic_Poses/i;
// About the area of 832x1248: big enough for detail, fast on Krea2 Turbo.
const COPY_TARGET_AREA = 832 * 1248;

const COPY_PROMPT_HEAD =
  "The same character from the reference image, drawn in exactly the same art style, with the same face, hair, outfit, pose, camera framing and background as the reference. ";

// Matches the source aspect ratio at a fixed pixel budget, in multiples of 16.
function copySize(width: number, height: number) {
  const ratio = width / height;
  const round16 = (value: number) => Math.max(512, Math.min(1536, Math.round(value / 16) * 16));
  return {
    width: round16(Math.sqrt(COPY_TARGET_AREA * ratio)),
    height: round16(Math.sqrt(COPY_TARGET_AREA / ratio)),
  };
}

export function UrlReferenceImport({
  onGenerate,
}: {
  onGenerate: (params: GenerationParams) => void | Promise<void>;
}) {
  const { params, setParams, language } = useStore();
  const ko = language === "ko";
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<"reference" | "copy" | "batch" | null>(null);
  // One vision pass per reference image; repeated batch presses reuse it.
  const analysisCache = useRef<{ imageUrl: string; analysis: ReferenceAnalysis } | null>(null);
  const [status, setStatus] = useState("");

  const fetchReference = async (describe: boolean) => {
    const res = await fetch("/api/reference-from-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url.trim(), describe }),
    });
    const data = (await res.json().catch(() => ({}))) as ReferenceFromUrlResponse;
    if (!res.ok || !data.url) {
      throw new Error(data.error || (ko ? "이미지를 가져오지 못했습니다." : "Could not fetch the image."));
    }
    return data;
  };

  // Sites like tensor.art block server fetches of their pages, but the browser
  // can hand over the picture itself: a dragged image carries its CDN address,
  // and "Copy image" + Ctrl+V carries the file.
  const takeImage = async (transfer: DataTransfer) => {
    const file = [...transfer.files].find((item) => item.type.startsWith("image/"));
    if (file) {
      setBusy("reference");
      setStatus(ko ? "이미지를 올리는 중..." : "Uploading image...");
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
        if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
        setUrl(data.url);
        setStatus(
          ko
            ? "이미지를 받았습니다. [레퍼런스로] 또는 [똑같이 뽑기]를 누르세요."
            : "Image received. Press Use as reference or Copy image."
        );
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(null);
      }
      return true;
    }

    const html = transfer.getData("text/html");
    const src = html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&");
    const uri = transfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((line) => line && !line.startsWith("#"));
    const dropped = src || uri;
    if (dropped && /^https?:\/\//i.test(dropped)) {
      setUrl(dropped);
      setStatus(
        ko
          ? "이미지 주소를 넣었습니다. [레퍼런스로] 또는 [똑같이 뽑기]를 누르세요."
          : "Image address set. Press Use as reference or Copy image."
      );
      return true;
    }
    return false;
  };

  const useAsReference = async () => {
    if (!url.trim() || busy) return;
    setBusy("reference");
    setStatus(ko ? "이미지를 받는 중..." : "Fetching image...");
    try {
      const data = await fetchReference(false);
      setParams({ character_image: data.url });
      setStatus(
        ko
          ? `캐릭터 참조로 넣었습니다 (${data.width}×${data.height}).`
          : `Set as the character reference (${data.width}×${data.height}).`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  // Setting B: the on-screen reference at 0.7 on Krea 2 with no extra LoRAs, and a
  // prompt that spells out the reference's style, face, hair and background
  // rendering; each image gets its own pose, expression, camera and background.
  const generateVariations = async (count: number) => {
    const imageUrl = useStore.getState().params.character_image;
    if (!imageUrl || busy) return;
    setBusy("batch");
    try {
      let analysis =
        analysisCache.current?.imageUrl === imageUrl ? analysisCache.current.analysis : null;
      if (!analysis) {
        setStatus(
          ko
            ? "비전 모델이 레퍼런스의 화풍 · 얼굴 · 머리 · 배경을 분석하는 중... (5~20초)"
            : "Analyzing the reference style, face, hair and backgrounds... (5-20s)"
        );
        const res = await fetch("/api/reference-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl }),
        });
        const data = (await res.json().catch(() => ({}))) as ReferenceAnalysis & { error?: string };
        if (!res.ok || !data.style) {
          throw new Error(data.error || (ko ? "레퍼런스 분석에 실패했습니다." : "Reference analysis failed."));
        }
        analysis = data;
        analysisCache.current = { imageUrl, analysis };
      }

      const preset = MODEL_PRESETS.find((item) => item.id === COPY_PRESET_ID);
      if (!preset) throw new Error("Krea2 preset is missing.");
      const modelsData = await fetch("/api/models", { cache: "no-store" })
        .then((res) => res.json())
        .catch(() => ({}));
      const available = ((modelsData.checkpointAssets ?? []) as { path: string }[]).map(
        (asset) => asset.path
      );
      const presetParams = presetToParams(preset, available);
      const prompts = buildVariationPrompts(analysis, count);
      const settings: Partial<GenerationParams> = {
        ...presetParams,
        loras: [],
        character_image: imageUrl,
        character_reference_strength: VARIATION_REFERENCE_STRENGTH,
        negative_prompt: VARIATION_NEGATIVE_PROMPT,
        generation_mode: "text_to_image",
        source_image: null,
        seed: null,
      };

      // The form shows the settings the batch runs with (first prompt as a sample),
      // so the screen and the queued jobs never disagree.
      setParams({ ...settings, prompt: prompts[0] });
      const base = { ...useStore.getState().params, ...settings };
      for (let index = 0; index < prompts.length; index += 1) {
        setStatus(
          ko
            ? `대기열에 넣는 중... ${index + 1}/${count}`
            : `Queueing... ${index + 1}/${count}`
        );
        await onGenerate({ ...base, prompt: prompts[index] });
      }
      setStatus(
        ko
          ? `${count}장을 대기열에 넣었습니다 (Krea2 · 참조 0.7 · 추가 로라 없음 · 화풍 자세히). 장마다 포즈 · 표정 · 카메라 · 배경이 다릅니다.`
          : `Queued ${count} images (Krea2, reference 0.7, no extra LoRAs, detailed style). Each has its own pose, expression, camera and background.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const copyImage = async () => {
    if (!url.trim() || busy) return;
    setBusy("copy");
    setStatus(
      ko
        ? "이미지를 받고 비전 모델로 그림을 설명하는 중... (10~30초)"
        : "Fetching the image and describing it with the vision model... (10-30s)"
    );
    try {
      const data = await fetchReference(true);
      const preset = MODEL_PRESETS.find((item) => item.id === COPY_PRESET_ID);
      if (!preset) throw new Error("Krea2 preset is missing.");

      const modelsData = await fetch("/api/models", { cache: "no-store" })
        .then((res) => res.json())
        .catch(() => ({}));
      const available = ((modelsData.checkpointAssets ?? []) as { path: string }[]).map(
        (asset) => asset.path
      );
      const presetParams = presetToParams(preset, available);
      const description = data.prompt || data.sourcePrompt || "";
      const next: Partial<GenerationParams> = {
        ...presetParams,
        loras: (presetParams.loras ?? []).filter((lora) => !COPY_DROPPED_LORA.test(lora.path)),
        ...copySize(data.width, data.height),
        character_image: data.url,
        character_reference_strength: COPY_REFERENCE_STRENGTH,
        prompt: COPY_PROMPT_HEAD + description,
        negative_prompt: "",
        generation_mode: "text_to_image",
        source_image: null,
        seed: null,
      };

      setParams(next);
      setStatus(
        ko
          ? "Krea2 프리셋 · 참조 0.9 · 같은 비율로 생성을 시작했습니다. 프롬프트는 수정해서 다시 뽑을 수 있습니다."
          : "Started a Krea2 copy (reference 0.9, same aspect ratio). Edit the prompt and generate again to adjust."
      );
      await onGenerate({ ...useStore.getState().params, ...next });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      className="space-y-3 border-b border-border/70 pb-4"
      onDragOver={(event) => {
        if (busy) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        if (busy) return;
        event.preventDefault();
        void takeImage(event.dataTransfer);
      }}
    >
      <div className="flex gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2">
            <FieldHelp
              label={ko ? "이미지 URL로 레퍼런스" : "Reference from image URL"}
              help={
                ko
                  ? "이미지 주소(또는 이미지가 있는 페이지 주소)를 넣으면 이미지를 받아 캐릭터 참조로 넣습니다. '똑같이 뽑기'는 비전 모델이 그림을 영어 프롬프트로 설명하고, Krea2 프리셋(참조 강도 0.9, 같은 비율)으로 바로 한 장 생성합니다. tensor.art처럼 페이지가 자동 접근을 막는 사이트는 이미지 위 우클릭 → '이미지 주소 복사'로 넣으세요."
                  : "Paste an image address (or a page that shows one) to download it as the character reference. 'Copy' has the vision model describe the picture in English and generates one image right away with the Krea2 preset (reference 0.9, same aspect ratio). For sites that block automated access such as tensor.art, right-click the image and copy the image address."
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {ko
                ? "이미지 주소를 넣거나, 이미지를 이 칸에 끌어다 놓거나, '이미지 복사' 후 Ctrl+V 하세요. (tensor.art 페이지 주소는 막혀 있어 이 방법으로)"
                : "Paste an image address, drag an image here, or copy the image and press Ctrl+V. (tensor.art page links are blocked; use these instead.)"}
            </p>
          </div>

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onPaste={(event) => {
                // Only take over for a pasted image file; plain text pastes normally.
                if ([...event.clipboardData.files].some((item) => item.type.startsWith("image/"))) {
                  event.preventDefault();
                  void takeImage(event.clipboardData);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void useAsReference();
                }
              }}
              placeholder="https://.../image.jpg"
              aria-label={ko ? "이미지 URL" : "Image URL"}
              className="h-9 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={useAsReference}
              disabled={!url.trim() || busy !== null}
              className="h-9"
            >
              {busy === "reference" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {ko ? "레퍼런스로" : "Use as reference"}
            </Button>
            <Button
              type="button"
              onClick={copyImage}
              disabled={!url.trim() || busy !== null}
              className="h-9"
            >
              {busy === "copy" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {ko ? "똑같이 뽑기" : "Copy image"}
            </Button>
          </div>
        </div>

        <div className="w-20 shrink-0 self-end">
          {params.character_image ? (
            <div className="group/ref relative aspect-square overflow-hidden rounded-md border border-border">
              <img
                src={params.character_image}
                alt={ko ? "캐릭터 참조 이미지" : "Character reference"}
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => setParams({ character_image: null })}
                className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover/ref:opacity-100"
                aria-label={ko ? "캐릭터 참조 제거" : "Remove character reference"}
                title={ko ? "캐릭터 참조 제거" : "Remove character reference"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border text-muted-foreground/50">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <FieldHelp
          label={ko ? "레퍼런스로 다양하게 뽑기" : "Varied batch from the reference"}
          help={
            ko
              ? "지금 캐릭터 참조 이미지로 누른 장수만큼 대기열에 넣습니다. 비전 모델이 레퍼런스의 화풍 · 얼굴 · 머리 · 의상과 어울리는 배경을 분석하고, 장마다 포즈 · 표정 · 카메라 구도 · 배경을 다르게 조합합니다. Krea2 · 참조 강도 0.7 · 추가 로라 없음(포즈 · 각도 로라는 화풍을 바꿔서 뺌)."
              : "Queues the chosen number of images from the current character reference. A vision model reads the reference style, face, hair, outfit and fitting backgrounds; each image combines a different pose, expression, camera and background. Krea2, reference 0.7, no extra LoRAs (pose / angle LoRAs change the style)."
          }
        />
        <div className="grid grid-cols-4 gap-2" role="group" aria-label={ko ? "다양하게 뽑기 장수" : "Batch size"}>
          {VARIATION_COUNTS.map((count) => (
            <Button
              key={count}
              type="button"
              variant="outline"
              onClick={() => void generateVariations(count)}
              disabled={!params.character_image || busy !== null}
              className="h-9"
            >
              {busy === "batch" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Layers className="h-3.5 w-3.5" />
              )}
              {ko ? `${count}장` : `${count}`}
            </Button>
          ))}
        </div>
        {!params.character_image && (
          <p className="text-xs text-muted-foreground">
            {ko ? "먼저 캐릭터 참조 이미지를 넣으세요." : "Set a character reference first."}
          </p>
        )}
      </div>

      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </section>
  );
}
