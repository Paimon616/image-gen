"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  ImagePlus,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  UsersRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat-markdown";
import type { Character, GeneratedImage, GenerationParams } from "@/lib/types";
import { readImageDataUrlForVision } from "@/lib/image-resize";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface PaimonAttachment {
  id: string;
  kind: "clipboard_image" | "gallery_image";
  label: string;
  url?: string;
  dataUrl?: string;
  metadata?: Partial<GeneratedImage>;
}

interface PaimonChatProps {
  params: GenerationParams;
  onApplyParams: (patch: Partial<GenerationParams>) => void;
  attachments: PaimonAttachment[];
  onAttachmentsChange: (attachments: PaimonAttachment[]) => void;
  // Enqueue a generation with fully-composed params, linked to the character/
  // situation it came from. Used by the picker's auto-generate and batch modes.
  onEnqueueGeneration?: (
    params: GenerationParams,
    meta: { characterId?: string; situationId?: string }
  ) => void;
  // Records the character/situation a composed prompt came from so a later manual
  // Generate press on the same prompt still links the image.
  onCharacterContext?: (context: {
    characterId?: string;
    situationId?: string;
    prompt: string;
  }) => void;
  // Opens an image in the shared detail viewer (used by situation thumbnails).
  onOpenImage?: (image: GeneratedImage) => void;
}

interface PaimonModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  tags?: string[];
}

interface PaimonModelContext {
  currentCheckpoint?: PaimonModelAsset;
  compatibleLoras: PaimonModelAsset[];
  checkpoints: PaimonModelAsset[];
}

const INTRO_MESSAGE: ChatMessage = {
  id: "intro",
  role: "assistant",
  content:
    "파이몬이에요. 현재 입력값과 참조 이미지를 읽고 이미지·영상 프롬프트, 모델 설정, LoRA, 업스케일을 바로 고쳐드릴게요.",
};

const EDITABLE_PARAM_KEYS = new Set<keyof GenerationParams>([
  "backend",
  "model",
  "model_name",
  "prompt",
  "negative_prompt",
  "num_inference_steps",
  "guidance_scale",
  "width",
  "height",
  "num_images",
  "output_format",
  "generation_mode",
  "seed",
  "sampler_name",
  "scheduler",
  "clip_skip",
  "vae_name",
  "upscale_model_name",
  "hires_upscale",
  "hires_steps",
  "hires_denoise",
  "img2img_resize",
  "adetailer_enabled",
  "adetailer_model",
  "adetailer_checkpoint",
  "adetailer_prompt",
  "adetailer_negative_prompt",
  "adetailer_use_steps",
  "adetailer_steps",
  "adetailer_confidence",
  "adetailer_mask_blur",
  "adetailer_noise_multiplier",
  "adetailer_inpaint_only_masked",
  "adetailer_loras",
  "adetailer_denoise",
  "loras",
  "embeddings",
  "controlnets",
  "prompt_weighting",
  "style_image",
  "character_image",
  "source_image",
  "denoise_strength",
  "pose_reference_image",
  "pose_reference_model",
  "pose_reference_strength",
  "enable_safety_checker",
]);

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

function sanitizePatch(value: unknown): Partial<GenerationParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const patch: Partial<GenerationParams> = {};

  Object.entries(value).forEach(([key, nextValue]) => {
    if (EDITABLE_PARAM_KEYS.has(key as keyof GenerationParams)) {
      (patch as Record<string, unknown>)[key] = nextValue;
    }
  });

  return patch;
}

function compactAsset(asset: unknown): PaimonModelAsset | null {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    return null;
  }

  const record = asset as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.name !== "string") {
    return null;
  }

  return {
    path: record.path,
    name: record.name,
    version: typeof record.version === "string" ? record.version : "",
    base_model:
      typeof record.base_model === "string" ? record.base_model : "",
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function isPaimonModelAsset(
  asset: PaimonModelAsset | null
): asset is PaimonModelAsset {
  return Boolean(asset);
}

function normalizeFamily(value: string | undefined) {
  const lower = (value ?? "").toLowerCase();

  if (/pony|pdxl/.test(lower)) return "pony";
  if (/illustrious|ilxl/.test(lower)) return "illustrious";
  if (/noob/.test(lower)) return "noobai";
  if (/anima/.test(lower)) return "anima";
  if (/flux/.test(lower)) return "flux";
  if (/krea/.test(lower)) return "krea";
  if (/sdxl|xl/.test(lower)) return "sdxl";
  if (/sd\s*1\.?5|sd15|1\.5/.test(lower)) return "sd15";

  return lower.trim();
}

function sameFamily(left: string | undefined, right: string | undefined) {
  const leftFamily = normalizeFamily(left);
  const rightFamily = normalizeFamily(right);

  if (!leftFamily || !rightFamily) return false;
  if (leftFamily === rightFamily) return true;

  return (
    (leftFamily === "illustrious" && rightFamily === "noobai") ||
    (leftFamily === "noobai" && rightFamily === "illustrious")
  );
}

async function loadModelContext(
  params: GenerationParams
): Promise<PaimonModelContext> {
  try {
    const res = await fetch("/api/models", { cache: "no-store" });
    const data = await res.json();
    const checkpointAssets: unknown[] = Array.isArray(data.checkpointAssets)
      ? data.checkpointAssets
      : [];
    const loraAssets: unknown[] = Array.isArray(data.loraAssets)
      ? data.loraAssets
      : [];
    const checkpoints = checkpointAssets
      .map(compactAsset)
      .filter(isPaimonModelAsset);
    const loras = loraAssets
      .map(compactAsset)
      .filter(isPaimonModelAsset);
    const currentCheckpoint = checkpoints.find(
      (asset) => asset.path === params.model_name
    );
    const currentFamily =
      currentCheckpoint?.base_model ||
      currentCheckpoint?.path ||
      params.model_name;
    const compatibleLoras = loras
      .filter((asset) => sameFamily(currentFamily, asset.base_model || asset.path))
      .slice(0, 40);

    return {
      currentCheckpoint,
      compatibleLoras,
      checkpoints: checkpoints.slice(0, 80),
    };
  } catch {
    return {
      compatibleLoras: [],
      checkpoints: [],
    };
  }
}

interface PaimonCharacter {
  id: string;
  name: string;
  summary: string;
  appearancePrompt: string;
  outfits: { name: string; prompt: string }[];
  backgrounds: { name: string; prompt: string }[];
  situations: {
    id: string;
    name: string;
    prompt: string;
    outfitName?: string;
    backgroundName?: string;
  }[];
}

// Loads the user's saved characters as a compact library so Paimon can compose a
// character's identity + outfit + background + situation into the prompt. Only
// prompt-bearing fields are sent; failures degrade to an empty library.
async function loadCharacterLibrary(): Promise<PaimonCharacter[]> {
  try {
    const res = await fetch("/api/characters", { cache: "no-store" });
    const data = (await res.json()) as { characters?: Character[] };
    return (data.characters ?? [])
      .filter(
        (character) =>
          character.appearancePrompt.trim() ||
          character.backgrounds.some((background) => background.prompt.trim()) ||
          character.outfits.some((outfit) => outfit.prompt.trim()) ||
          character.situations.some((situation) => situation.prompt.trim())
      )
      .slice(0, 30)
      .map((character) => {
        // Resolve each situation's outfit/background id to a name so Paimon can
        // pair them without knowing the internal ids.
        const outfitNameById = new Map(
          character.outfits.map((outfit) => [outfit.id, outfit.name])
        );
        const backgroundNameById = new Map(
          character.backgrounds.map((background) => [
            background.id,
            background.name,
          ])
        );
        return {
          id: character.id,
          name: character.name,
          summary: character.summary,
          appearancePrompt: character.appearancePrompt,
          outfits: character.outfits
            .filter((outfit) => outfit.prompt.trim())
            .map((outfit) => ({ name: outfit.name, prompt: outfit.prompt })),
          backgrounds: character.backgrounds
            .filter((background) => background.prompt.trim())
            .map((background) => ({
              name: background.name,
              prompt: background.prompt,
            })),
          situations: character.situations
            .filter((situation) => situation.prompt.trim())
            .map((situation) => ({
              id: situation.id,
              name: situation.name,
              prompt: situation.prompt,
              outfitName: situation.outfitId
                ? outfitNameById.get(situation.outfitId)
                : undefined,
              backgroundName: situation.backgroundId
                ? backgroundNameById.get(situation.backgroundId)
                : undefined,
            })),
        };
      });
  } catch {
    return [];
  }
}

export function PaimonChat({
  params,
  onApplyParams,
  attachments,
  onAttachmentsChange,
  onEnqueueGeneration,
  onCharacterContext,
  onOpenImage,
}: PaimonChatProps) {
  const [open, setOpen] = useState(false);
  const [renderPanel, setRenderPanel] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // Character/situation picker (person-icon menu) state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerChars, setPickerChars] = useState<PaimonCharacter[] | null>(null);
  const [pickerActiveName, setPickerActiveName] = useState<string | null>(null);
  // Picker options: auto-generate queues each picked situation; multi-select lets
  // the user check several situations and run them one after another.
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedSituationIds, setSelectedSituationIds] = useState<Set<string>>(
    new Set()
  );
  // Sequential batch run state (situation prompts composed + queued in order).
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
    current: string;
  } | null>(null);
  const batchCancelRef = useRef(false);
  // Thumbnails of already-generated images, grouped by situation id, for the
  // active character in the picker.
  const [situationImages, setSituationImages] = useState<
    Record<string, GeneratedImage[]>
  >({});
  const previousAttachmentIds = useRef(
    new Set(attachments.map((attachment) => attachment.id))
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  const openPanel = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setRenderPanel(true);
    setOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    setPickerOpen(false);
    setPickerActiveName(null);
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      setRenderPanel(false);
      closeTimeoutRef.current = null;
    }, 180);
  }, []);

  const togglePanel = useCallback(() => {
    if (open) {
      closePanel();
      return;
    }
    openPanel();
  }, [closePanel, open, openPanel]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasNewAttachment = attachments.some(
      (attachment) => !previousAttachmentIds.current.has(attachment.id)
    );
    if (hasNewAttachment) openPanel();
    previousAttachmentIds.current = new Set(attachments.map(({ id }) => id));

  }, [attachments, openPanel]);
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  const compactMessages = useMemo(
    () =>
      messages
        .filter((message) => message.id !== "intro")
        .slice(-10)
        .map(({ role, content }) => ({ role, content })),
    [messages]
  );

  // Runs one Paimon turn: appends the user/assistant messages, streams the reply,
  // applies any params patch, and RETURNS the sanitized patch (or null on
  // failure) so callers can compose+generate. The public sendMessage wraps this
  // with the "don't start while busy" guard.
  const runTurn = useCallback(
    async (content: string): Promise<Partial<GenerationParams> | null> => {
      const trimmed = content.trim();
      if (!trimmed) return null;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };

      setMessages((current) => [...current, userMessage]);
      setInput("");
      setLoading(true);
      setStatus("");
      setError("");

      const assistantId = crypto.randomUUID();
      let placeholderAdded = false;
      const ensurePlaceholder = () => {
        if (placeholderAdded) return;
        placeholderAdded = true;
        setMessages((current) => [
          ...current,
          { id: assistantId, role: "assistant", content: "" },
        ]);
      };
      const appendToAssistant = (text: string) => {
        ensurePlaceholder();
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? { ...message, content: message.content + text }
              : message
          )
        );
      };
      const setAssistantContent = (text: string) => {
        ensurePlaceholder();
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, content: text } : message
          )
        );
      };

      try {
        const [modelContext, characterLibrary] = await Promise.all([
          loadModelContext(params),
          loadCharacterLibrary(),
        ]);
        const res = await fetch("/api/paimon/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentParams: params,
            modelContext,
            characterLibrary,
            attachments: attachments.map((attachment, index) => ({
              ...attachment,
              referenceId: `참조${index + 1}`,
            })),
            messages: [...compactMessages, userMessage].map(
              ({ role, content }) => ({ role, content })
            ),
          }),
        });

        const contentType = res.headers.get("Content-Type") ?? "";

        // Non-streaming error responses (missing key, upstream failure) come
        // back as JSON.
        if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "파이몬 호출에 실패했습니다.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedText = "";
        let done: {
          reply?: string;
          paramsPatch?: unknown;
          attachmentNotice?: string;
        } | null = null;
        let streamError = "";

        while (true) {
          const { value, done: readerDone } = await reader.read();
          if (readerDone) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const rawEvent of events) {
            if (!rawEvent.trim()) continue;

            const eventLine = rawEvent
              .split("\n")
              .find((line) => line.startsWith("event:"));
            const dataLine = rawEvent
              .split("\n")
              .find((line) => line.startsWith("data:"));
            const event = eventLine?.slice("event:".length).trim() ?? "message";
            const payload = dataLine
              ? JSON.parse(dataLine.slice("data:".length).trim())
              : null;

            if (event === "status" && typeof payload?.message === "string") {
              setStatus(payload.message);
            } else if (event === "delta" && typeof payload?.text === "string") {
              streamedText += payload.text;
              appendToAssistant(payload.text);
            } else if (event === "done") {
              done = payload;
            } else if (event === "error") {
              streamError = payload?.error || "파이몬 오류";
            }
          }
        }

        if (streamError) throw new Error(streamError);

        const patch = sanitizePatch(done?.paramsPatch);
        const applied = Object.keys(patch).length > 0;
        if (applied) {
          onApplyParams(patch);
        }

        const finalContent =
          done?.reply ||
          streamedText ||
          done?.attachmentNotice ||
          (applied
            ? "요청을 반영해서 현재 생성 정보를 수정했어요."
            : "이번에는 반영할 내용을 만들지 못했어요. 조금 더 구체적으로 다시 요청해 주세요.");
        setAssistantContent(finalContent);
        return patch;
      } catch (err) {
        // Drop an empty placeholder so a failed turn doesn't leave a blank bubble.
        if (placeholderAdded) {
          setMessages((current) =>
            current.filter(
              (message) =>
                !(message.id === assistantId && message.content === "")
            )
          );
        }
        setError(err instanceof Error ? err.message : "파이몬 오류");
        return null;
      } finally {
        setLoading(false);
        setStatus("");
      }
    },
    [attachments, compactMessages, onApplyParams, params]
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (loading) return;
      void runTurn(content);
    },
    [loading, runTurn]
  );

  // Refs so the async batch loop always reads the freshest turn runner and params
  // without capturing stale closures between iterations.
  const runTurnRef = useRef(runTurn);
  useEffect(() => {
    runTurnRef.current = runTurn;
  }, [runTurn]);
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const togglePicker = useCallback(async () => {
    if (pickerOpen) {
      setPickerOpen(false);
      setPickerActiveName(null);
      return;
    }
    setPickerOpen(true);
    setPickerActiveName(null);
    setMultiSelect(false);
    setSelectedSituationIds(new Set());
    setPickerLoading(true);
    try {
      setPickerChars(await loadCharacterLibrary());
    } catch {
      setPickerChars([]);
    } finally {
      setPickerLoading(false);
    }
  }, [pickerOpen]);

  // Load already-generated thumbnails for the active character, grouped by
  // situation id, so each situation row can show what's been made for it.
  const loadSituationImages = useCallback(async (characterId: string) => {
    try {
      const res = await fetch(`/api/characters/${characterId}/images`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        images?: {
          id: string;
          filename: string;
          url: string;
          thumbnailUrl: string;
          situationId: string | null;
          timestamp: number;
          params: GenerationParams | null;
        }[];
      };
      const grouped: Record<string, GeneratedImage[]> = {};
      for (const image of data.images ?? []) {
        const key = image.situationId ?? "__base__";
        (grouped[key] ??= []).push({
          id: image.id,
          url: image.url,
          thumbnailUrl: image.thumbnailUrl,
          filename: image.filename,
          params: image.params,
          timestamp: image.timestamp,
          characterId,
          situationId: image.situationId ?? undefined,
        });
      }
      setSituationImages(grouped);
    } catch {
      setSituationImages({});
    }
  }, []);

  // Opens a character's situation list and loads its existing thumbnails.
  const openCharacterSituations = useCallback(
    (character: PaimonCharacter) => {
      setPickerActiveName(character.name);
      setSelectedSituationIds(new Set());
      setSituationImages({});
      void loadSituationImages(character.id);
    },
    [loadSituationImages]
  );

  const buildInstruction = (characterName: string, situationName?: string) =>
    situationName
      ? `저장된 캐릭터 '${characterName}'를 '${situationName}' 상황으로 만들어줘. 지금 설정된 모델·네거티브·이미지 크기는 그대로 두고, 그 상황의 의상·배경·상황 프롬프트를 캐릭터 정체성과 합쳐서 현재 모델에 맞게 프롬프트에 적용해줘.`
      : `저장된 캐릭터 '${characterName}'로 만들어줘. 지금 설정된 모델·네거티브·이미지 크기는 그대로 두고, 현재 모델에 맞게 프롬프트를 구성해줘.`;

  // Composes one character/situation into the prompt (via a Paimon turn) and,
  // when `generate` is set, enqueues it linked to that situation. Returns true on
  // a successful compose. Reads the latest turn runner/params through refs so it
  // is safe to call repeatedly inside the batch loop.
  const composeSituation = useCallback(
    async (
      character: PaimonCharacter,
      situation: PaimonCharacter["situations"][number] | null,
      generate: boolean
    ): Promise<boolean> => {
      const patch = await runTurnRef.current(
        buildInstruction(character.name, situation?.name)
      );
      if (!patch) return false;
      const merged = { ...paramsRef.current, ...patch } as GenerationParams;
      onCharacterContext?.({
        characterId: character.id,
        situationId: situation?.id,
        prompt: merged.prompt,
      });
      if (generate && merged.prompt.trim()) {
        onEnqueueGeneration?.(merged, {
          characterId: character.id,
          situationId: situation?.id,
        });
      }
      return true;
    },
    [onCharacterContext, onEnqueueGeneration]
  );

  // Single pick (multi-select off): compose the situation, generate if the
  // auto-generate box is checked. Closes the picker.
  const applyCharacterSituation = useCallback(
    (character: PaimonCharacter, situationId?: string) => {
      setPickerOpen(false);
      setPickerActiveName(null);
      const situation =
        character.situations.find((item) => item.id === situationId) ?? null;
      void composeSituation(character, situation, autoGenerate);
    },
    [autoGenerate, composeSituation]
  );

  // Multi-select: compose + queue each checked situation in order. Each situation
  // is prompted, queued, then the next — until all are queued or the user cancels.
  const runBatch = useCallback(
    async (character: PaimonCharacter) => {
      const chosen = character.situations.filter((situation) =>
        selectedSituationIds.has(situation.id)
      );
      if (chosen.length === 0) return;

      batchCancelRef.current = false;
      setPickerOpen(false);
      setPickerActiveName(null);

      for (let i = 0; i < chosen.length; i += 1) {
        if (batchCancelRef.current) break;
        setBatchProgress({
          done: i,
          total: chosen.length,
          current: chosen[i].name || "이름 없음",
        });
        // Intentional serial await: compose+queue one situation before the next.
        await composeSituation(character, chosen[i], true);
      }

      setBatchProgress(null);
      setSelectedSituationIds(new Set());
    },
    [composeSituation, selectedSituationIds]
  );

  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  const toggleSituationSelected = useCallback((situationId: string) => {
    setSelectedSituationIds((current) => {
      const next = new Set(current);
      if (next.has(situationId)) next.delete(situationId);
      else next.add(situationId);
      return next;
    });
  }, []);

  const openSituationImage = useCallback(
    (image: GeneratedImage) => {
      setPickerOpen(false);
      onOpenImage?.(image);
    },
    [onOpenImage]
  );

  const removeAttachment = useCallback((attachmentId: string) => {
    onAttachmentsChange(
      attachments.filter((attachment) => attachment.id !== attachmentId)
    );
  }, [attachments, onAttachmentsChange]);

  const resetChat = useCallback(() => {
    setMessages([INTRO_MESSAGE]);
    onAttachmentsChange([]);
    setInput("");
    setError("");
  }, [onAttachmentsChange]);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageItem = Array.from(event.clipboardData.items).find((item) =>
        item.type.startsWith("image/")
      );
      const file = imageItem?.getAsFile();

      if (!file) return;

      event.preventDefault();
      setLoading(true);
      setError("");
      try {
        const [url, dataUrl] = await Promise.all([
          uploadImageFile(file),
          readImageDataUrlForVision(file),
        ]);
        const attachment: PaimonAttachment = {
          id: crypto.randomUUID(),
          kind: "clipboard_image",
          label: "클립보드 이미지",
          url,
          dataUrl,
        };

        onAttachmentsChange([...attachments, attachment].slice(-6));
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "클립보드 이미지가 채팅에 첨부됐어요.",
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "이미지 업로드 실패");
      } finally {
        setLoading(false);
      }
    },
    [attachments, onAttachmentsChange]
  );

  const lastMessage = messages[messages.length - 1];
  const isAssistantStreaming =
    loading &&
    lastMessage?.role === "assistant" &&
    lastMessage.content.length > 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {renderPanel && (
        <section
          className={`flex h-[min(76vh,620px)] w-[min(calc(100vw-2rem),420px)] origin-bottom-right flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl transition-[opacity,transform,filter] duration-[180ms] ease-out ${
            open
              ? "translate-y-0 scale-100 opacity-100 blur-0"
              : "pointer-events-none translate-y-3 scale-95 opacity-0 blur-[1px]"
          } motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:blur-0 motion-reduce:transition-none`}
        >
          <header className="flex h-12 items-center justify-between border-b border-border px-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Bot className="size-4" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">Paimon 파이몬</h3>
                <p className="truncate text-[11px] text-muted-foreground">
                  현재 화면을 읽고 생성 정보를 수정합니다
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={resetChat}
                disabled={loading}
                aria-label="Reset Paimon chat"
                title="채팅 초기화"
              >
                <RotateCcw />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={closePanel}
                aria-label="Close Paimon"
              >
                <X />
              </Button>
            </div>
          </header>

          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2">
              <span className="shrink-0 self-center text-[10px] text-muted-foreground">
                대화에서 참조1, 참조2로 지칭
              </span>
              {attachments.map((attachment, index) => (
                <div
                  key={attachment.id}
                  className="relative flex w-24 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-secondary text-[11px]"
                  title={attachment.url || attachment.metadata?.filename || ""}
                >
                  <div className="relative h-16 w-full bg-muted">
                    {attachment.url || attachment.metadata?.thumbnailUrl ? (
                      <img
                        src={attachment.metadata?.thumbnailUrl || (attachment.kind === "gallery_image" && attachment.metadata?.filename ? `/api/images/thumb/${attachment.metadata.filename}` : attachment.url)}
                        alt={`${attachment.label} 미리보기`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted-foreground"><ImagePlus className="size-5" /></span>
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 py-0.5 font-semibold shadow-sm backdrop-blur-sm">참조{index + 1}</span>
                  </div>
                  <span className="truncate px-1.5 py-1 text-muted-foreground">{attachment.metadata?.filename || attachment.label}</span>
                  <button
                    type="button"
                    className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-background hover:text-foreground"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`${attachment.label} 제거`}
                    title="첨부 제거"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.map((message, index) => {
              const isStreaming =
                loading &&
                message.role === "assistant" &&
                index === messages.length - 1 &&
                message.content.length > 0;

              return (
                <div
                  key={message.id}
                  className={`flex ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {message.role === "user" ? (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm leading-5 text-primary-foreground">
                      {message.content}
                    </p>
                  ) : (
                    <div className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 text-sm leading-5 text-secondary-foreground">
                      <ChatMarkdown content={message.content} />
                      {isStreaming && (
                        <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse rounded-sm bg-current align-middle" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {loading && !isAssistantStreaming && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {status || "파이몬이 생각하는 중"}
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {batchProgress && (
            <div className="flex items-center gap-2 border-t border-border bg-secondary/40 px-3 py-2 text-xs">
              <Loader2 className="size-3 shrink-0 animate-spin" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                상황 순차 생성 {batchProgress.done + 1}/{batchProgress.total} ·{" "}
                {batchProgress.current}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[11px]"
                onClick={cancelBatch}
              >
                취소
              </Button>
            </div>
          )}

          <form
            className="border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(input);
            }}
          >
            <div className="relative mb-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => void togglePicker()}
                disabled={loading}
                aria-expanded={pickerOpen}
                title="저장된 캐릭터·상황 불러오기"
              >
                <UsersRound className="size-3.5" />
                캐릭터
              </Button>

              {pickerOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-10 cursor-default"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => {
                      setPickerOpen(false);
                      setPickerActiveName(null);
                    }}
                  />
                  <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-[min(20rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
                    {pickerLoading ? (
                      <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        불러오는 중
                      </div>
                    ) : !pickerChars || pickerChars.length === 0 ? (
                      <p className="px-2 py-3 text-xs text-muted-foreground">
                        저장된 캐릭터가 없어요. 먼저 캐릭터 생성에서 만들어
                        주세요.
                      </p>
                    ) : pickerActiveName === null ? (
                      <ul className="space-y-0.5">
                        {pickerChars.map((character) => (
                          <li key={character.id}>
                            <button
                              type="button"
                              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                              onClick={() => {
                                if (character.situations.length === 0) {
                                  applyCharacterSituation(character);
                                } else {
                                  openCharacterSituations(character);
                                }
                              }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-medium">
                                  {character.name || "이름 없음"}
                                </span>
                                {character.summary && (
                                  <span className="block truncate text-[11px] text-muted-foreground">
                                    {character.summary}
                                  </span>
                                )}
                              </span>
                              <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                                {character.situations.length > 0
                                  ? `상황 ${character.situations.length}`
                                  : "기본"}
                                <ChevronRight className="size-3.5" />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      (() => {
                        const active = pickerChars.find(
                          (character) => character.name === pickerActiveName
                        );
                        if (!active) return null;
                        const selectedCount = active.situations.filter(
                          (situation) => selectedSituationIds.has(situation.id)
                        ).length;
                        return (
                          <div>
                            <div className="flex items-center gap-1 border-b border-border px-1 pb-1">
                              <button
                                type="button"
                                className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                                onClick={() => setPickerActiveName(null)}
                                aria-label="캐릭터 목록으로"
                              >
                                <ArrowLeft className="size-3.5" />
                              </button>
                              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                                {active.name} · 상황 선택
                              </span>
                            </div>

                            {/* Auto-generate + multi-select toggles */}
                            <div className="flex items-center justify-end gap-3 px-1 py-1.5">
                              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  className="size-3.5 accent-primary"
                                  checked={autoGenerate}
                                  onChange={(event) =>
                                    setAutoGenerate(event.target.checked)
                                  }
                                />
                                자동 생성
                              </label>
                              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                                <input
                                  type="checkbox"
                                  className="size-3.5 accent-primary"
                                  checked={multiSelect}
                                  onChange={(event) => {
                                    setMultiSelect(event.target.checked);
                                    setSelectedSituationIds(new Set());
                                  }}
                                />
                                여러 장
                              </label>
                            </div>

                            <ul className="mt-0.5 space-y-0.5">
                              {!multiSelect && (
                                <li>
                                  <button
                                    type="button"
                                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                                    onClick={() =>
                                      applyCharacterSituation(active)
                                    }
                                  >
                                    상황 없이 (기본 모습)
                                  </button>
                                </li>
                              )}
                              {active.situations.map((situation) => {
                                const meta = [
                                  situation.outfitName,
                                  situation.backgroundName,
                                ]
                                  .filter(Boolean)
                                  .join(" · ");
                                const thumbs =
                                  situationImages[situation.id] ?? [];
                                const checked = selectedSituationIds.has(
                                  situation.id
                                );
                                return (
                                  <li
                                    key={situation.id}
                                    className="rounded-md px-1 py-1 hover:bg-accent/50"
                                  >
                                    <div className="flex items-center gap-2">
                                      {multiSelect && (
                                        <input
                                          type="checkbox"
                                          className="size-3.5 shrink-0 accent-primary"
                                          checked={checked}
                                          onChange={() =>
                                            toggleSituationSelected(situation.id)
                                          }
                                          aria-label={`${situation.name} 선택`}
                                        />
                                      )}
                                      <button
                                        type="button"
                                        className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left text-sm hover:text-accent-foreground"
                                        onClick={() => {
                                          if (multiSelect) {
                                            toggleSituationSelected(
                                              situation.id
                                            );
                                          } else {
                                            applyCharacterSituation(
                                              active,
                                              situation.id
                                            );
                                          }
                                        }}
                                      >
                                        <span className="block truncate">
                                          {situation.name || "이름 없음"}
                                        </span>
                                        {meta && (
                                          <span className="block truncate text-[11px] text-muted-foreground">
                                            {meta}
                                          </span>
                                        )}
                                      </button>
                                    </div>
                                    {thumbs.length > 0 && (
                                      <div className="mt-1 flex gap-1 overflow-x-auto pl-1">
                                        {thumbs.map((image) => (
                                          <button
                                            key={image.id}
                                            type="button"
                                            className="size-12 shrink-0 overflow-hidden rounded border border-border bg-muted"
                                            onClick={() =>
                                              openSituationImage(image)
                                            }
                                            title="이미지 상세 보기"
                                          >
                                            <img
                                              src={
                                                image.thumbnailUrl || image.url
                                              }
                                              alt={`${situation.name} 결과`}
                                              className="h-full w-full object-cover"
                                            />
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>

                            {multiSelect && (
                              <div className="mt-1 border-t border-border px-1 pt-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 w-full text-xs"
                                  disabled={
                                    selectedCount === 0 || batchProgress !== null
                                  }
                                  onClick={() => void runBatch(active)}
                                >
                                  선택 {selectedCount}개 순차 생성
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
                placeholder="엘프 여자를 만들어줘"
                className="max-h-28 min-h-10 resize-none text-sm"
                onKeyDown={(event) => {
                  // A Korean/Japanese/Chinese IME fires a confirming Enter
                  // (isComposing / keyCode 229) to commit the last syllable
                  // before the real submit Enter. Sending on that keystroke
                  // clears the input mid-composition, so the just-committed
                  // character reappears in the empty field. Ignore it.
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !(event.nativeEvent.isComposing || event.keyCode === 229)
                  ) {
                    event.preventDefault();
                    void sendMessage(input);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon-lg"
                disabled={!input.trim() || loading}
                aria-label="Send to Paimon"
              >
                {loading ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </form>
        </section>
      )}

      <Button
        type="button"
        size="icon-lg"
        className={`size-12 rounded-full shadow-xl transition-[transform,background-color,box-shadow] duration-200 ease-out hover:scale-105 ${
          open
            ? "rotate-3 shadow-2xl ring-2 ring-primary/25"
            : "rotate-0"
        } motion-reduce:transform-none motion-reduce:transition-none`}
        onClick={togglePanel}
        aria-label="Open Paimon"
        title="Paimon 파이몬"
      >
        <MessageCircle
          className={`size-5 transition-transform duration-200 ${
            open ? "scale-90" : "scale-100"
          } motion-reduce:transform-none`}
        />
      </Button>
    </div>
  );
}
