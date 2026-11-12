"use client";

import { useRef, useState } from "react";
import {
  Copy,
  FolderOpen,
  GalleryHorizontalEnd,
  ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  X,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { GeneratedImage, GenerationParams } from "@/lib/types";
import { ImageLibraryPicker } from "@/components/image-library-picker";
import {
  ANALYSIS_VERSION,
  buildVariationShots,
  VARIATION_COUNTS,
  VARIATION_NEGATIVE_PROMPT,
  type VariationPlan,
  type VariationView,
} from "@/lib/reference-variations";
import { directionalFamily, directionalParams } from "@/lib/directional-reference";
import { useDirectionalReferenceStore } from "@/lib/directional-reference-store";
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

// The copy uses the on-screen reference strength (default 0.7). Identity Edit
// copies outfit and pose more closely toward 0.9; below 0.6 the face drifts.
// Dynamic Poses pushes the pose away from the reference, which a copy must not do.
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

const VIEW_LABEL: Record<VariationView, { ko: string; en: string }> = {
  front: { ko: "정면", en: "front" },
  side: { ko: "옆", en: "side" },
  side_face: { ko: "옆+얼굴", en: "side+face" },
  back: { ko: "뒤", en: "back" },
  back_face: { ko: "뒤+얼굴", en: "back+face" },
};

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
  const analysisCache = useRef<{ key: string; analysis: VariationPlan } | null>(null);
  const [status, setStatus] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  // A local file (dropped, pasted or picked with 내 파일) is uploaded first; its
  // address then goes through the same URL flow as a pasted link.
  const uploadFile = async (file: File) => {
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
  };

  const pickFromGallery = (image: GeneratedImage) => {
    setPickerOpen(false);
    let absolute = image.url;
    try {
      absolute = new URL(image.url, window.location.href).href;
    } catch {
      // Keep the raw value.
    }
    setUrl(absolute);
    setStatus(
      ko
        ? "갤러리 이미지를 골랐습니다. [레퍼런스로] 또는 [똑같이 뽑기]를 누르세요."
        : "Gallery image picked. Press Use as reference or Copy image."
    );
  };

  const takeImage = async (transfer: DataTransfer) => {
    const file = [...transfer.files].find((item) => item.type.startsWith("image/"));
    if (file) {
      await uploadFile(file);
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

  // The on-screen prompt as written, with only its pose, expression, background and
  // camera swapped per image, generated with the model and settings on screen.
  const generateVariations = async (count: number) => {
    const { character_image: imageUrl, prompt: screenPrompt } = useStore.getState().params;
    if (!imageUrl || busy) return;
    const sourcePrompt = (screenPrompt ?? "").trim();
    const cacheKey = [ANALYSIS_VERSION, imageUrl, sourcePrompt].join("\n");
    setBusy("batch");
    try {
      let analysis =
        analysisCache.current?.key === cacheKey ? analysisCache.current.analysis : null;
      if (!analysis) {
        setStatus(
          ko
            ? "프롬프트에서 포즈 · 표정 · 배경 · 카메라 부분을 찾아 변형을 만드는 중... (10~40초)"
            : "Finding the pose, expression, background and camera parts of the prompt and varying them... (10-40s)"
        );
        const res = await fetch("/api/reference-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl, prompt: sourcePrompt }),
        });
        const data = (await res.json().catch(() => ({}))) as VariationPlan & { error?: string };
        if (!res.ok || !data.base) {
          throw new Error(data.error || (ko ? "프롬프트 분석에 실패했습니다." : "Prompt analysis failed."));
        }
        analysis = data;
        analysisCache.current = { key: cacheKey, analysis };
      }

      // Everything but the prompt comes from the screen as it is when the button is
      // pressed: the model the user picked, its LoRAs, sampler, steps, reference
      // strength and face fix. Only the mode is pinned to text-to-image, since a
      // source image would hold every variation to its pose and background.
      const shots = buildVariationShots(analysis, count);
      const screen = useStore.getState().params;
      const settings: Partial<GenerationParams> = {
        character_image: imageUrl,
        character_face_image: null,
        character_reference_view: null,
        identity_reference_image: null,
        negative_prompt: screen.negative_prompt?.trim() || VARIATION_NEGATIVE_PROMPT,
        generation_mode: "text_to_image",
        source_image: null,
        seed: null,
      };
      const base = { ...screen, ...settings };
      // 방향별 참조 (the sheet linked under the character reference): each shot
      // gets the sheet view its direction needs. The on-screen reference stays
      // Krea's front view; SDXL takes the view through IP-Adapter.
      const { linked, enabled } = useDirectionalReferenceStore.getState();
      const family = directionalFamily(screen.model_name ?? "");
      const useDirectional = Boolean(linked && enabled) && family !== "none";
      const used: Partial<Record<VariationView, number>> = {};
      for (let index = 0; index < shots.length; index += 1) {
        setStatus(
          ko
            ? `대기열에 넣는 중... ${index + 1}/${count}`
            : `Queueing... ${index + 1}/${count}`
        );
        const shot = shots[index];
        const refs =
          useDirectional && linked
            ? directionalParams(shot.view, linked, family, imageUrl)
            : null;
        if (refs && shot.view !== "front") used[shot.view] = (used[shot.view] ?? 0) + 1;
        await onGenerate({ ...base, ...(refs ?? {}), prompt: shot.prompt });
      }
      const usedText = Object.entries(used)
        .map(([view, n]) => `${VIEW_LABEL[view as VariationView][ko ? "ko" : "en"]} ${n}`)
        .join(" · ");
      const directionalNote = linked && enabled
        ? useDirectional
          ? ko
            ? usedText
              ? ` 시트 방향별 참조: ${usedText}장.`
              : " 시트 방향별 참조: 이번 묶음엔 정면만 나왔습니다."
            : usedText
              ? ` Sheet views used: ${usedText}.`
              : " Sheet views: only front views this time."
          : ko
            ? " 지금 모델은 참조 이미지를 쓰지 않아 방향별 참조를 적용하지 않았습니다."
            : " The current model takes no reference images, so directional references were not used."
        : "";
      setStatus(
        (ko
          ? `${count}장을 대기열에 넣었습니다 (화면 모델 · 설정 · 프롬프트 그대로). 장마다 포즈 · 표정 · 카메라 · 배경만 다릅니다${analysis.setting ? ` (배경: ${analysis.setting})` : ""}.`
          : `Queued ${count} images (on-screen model, settings and prompt). Only the pose, expression, camera and background change per image.`) +
          directionalNote
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
      const description = data.prompt || data.sourcePrompt || "";
      // The model, LoRAs, sampler, reference strength and face fix stay as the user picked them on
      // screen; only the reference, its aspect ratio and the prompt change.
      const next: Partial<GenerationParams> = {
        ...copySize(data.width, data.height),
        character_image: data.url,
        prompt: COPY_PROMPT_HEAD + description,
        generation_mode: "text_to_image",
        source_image: null,
        seed: null,
      };

      setParams(next);
      setStatus(
        ko
          ? "화면에서 고른 모델 · 참조 강도 · 같은 비율로 생성을 시작했습니다. 프롬프트는 수정해서 다시 뽑을 수 있습니다."
          : "Started a copy with the selected model and reference strength (same aspect ratio). Edit the prompt and generate again to adjust."
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
                  ? "이미지 주소(또는 이미지가 있는 페이지 주소)를 넣으면 이미지를 받아 캐릭터 참조로 넣습니다. '똑같이 뽑기'는 비전 모델이 그림을 영어 프롬프트로 설명하고, 화면에서 고른 모델과 참조 강도(기본 0.7)로, 같은 비율로 바로 한 장 생성합니다. tensor.art처럼 페이지가 자동 접근을 막는 사이트는 이미지 위 우클릭 → '이미지 주소 복사'로 넣으세요."
                  : "Paste an image address (or a page that shows one) to download it as the character reference. 'Copy' has the vision model describe the picture in English and generates one image right away with the selected model and reference strength (default 0.7, same aspect ratio). For sites that block automated access such as tensor.art, right-click the image and copy the image address."
              }
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {ko
                ? "이미지 주소를 넣거나, [내 파일] · [갤러리]에서 고르거나, 이미지를 이 칸에 끌어다 놓거나, '이미지 복사' 후 Ctrl+V 하세요. (tensor.art 페이지 주소는 막혀 있어 이 방법으로)"
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadFile(file);
            }}
          />
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
              className="h-8 flex-1 text-xs"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              {ko ? "내 파일" : "My files"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPickerOpen(true)}
              disabled={busy !== null}
              className="h-8 flex-1 text-xs"
            >
              <GalleryHorizontalEnd className="h-3.5 w-3.5" />
              {ko ? "갤러리" : "Gallery"}
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
              ? "지금 프롬프트와 캐릭터 참조 이미지로 누른 장수만큼 대기열에 넣습니다. 프롬프트는 그대로 쓰고, 그 안의 포즈 · 표정 · 배경 · 카메라 구도만 빼서 장마다 변형으로 바꿉니다(포즈 · 표정은 원래 것을 변형, 배경은 프롬프트 장소 안의 여러 곳, 예: 영국 성 → 정원 · 거실 · 침실 · 테라스). 모델 · 로라 · 참조 강도 · 얼굴 보정 등 나머지 설정은 화면에서 고른 그대로 씁니다."
              : "Queues the chosen number of images from the current prompt and character reference. The prompt is kept as written; only its pose, expression, background and camera parts are swapped per image for variations (backgrounds are spots inside the place the prompt names). The model, LoRAs, reference strength, face fix and the rest come from the screen."
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
      {pickerOpen && (
        <ImageLibraryPicker
          title={ko ? "가져올 이미지" : "Image to import"}
          onClose={() => setPickerOpen(false)}
          onPick={pickFromGallery}
        />
      )}
    </section>
  );
}
