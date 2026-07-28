"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ImagePlus,
  Loader2,
  MessageCircle,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { GeneratedImage, GenerationParams } from "@/lib/types";

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
  metadata?: Partial<GeneratedImage>;
}

interface PaimonChatProps {
  params: GenerationParams;
  onApplyParams: (patch: Partial<GenerationParams>) => void;
  attachments: PaimonAttachment[];
  onAttachmentsChange: (attachments: PaimonAttachment[]) => void;
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
    "파이몬이에요. 현재 입력값을 읽고 프롬프트, 모델 설정, LoRA, 업스케일, 참조 이미지를 바로 고쳐드릴게요.",
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

export function PaimonChat({
  params,
  onApplyParams,
  attachments,
  onAttachmentsChange,
}: PaimonChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const previousAttachmentIds = useRef(
    new Set(attachments.map((attachment) => attachment.id))
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hasNewAttachment = attachments.some(
      (attachment) => !previousAttachmentIds.current.has(attachment.id)
    );
    if (hasNewAttachment) setOpen(true);
    previousAttachmentIds.current = new Set(attachments.map(({ id }) => id));

  }, [attachments]);
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

  const sendMessage = useCallback(
    async (content: string) => {
      const trimmed = content.trim();
      if (!trimmed || loading) return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
      };

      setMessages((current) => [...current, userMessage]);
      setInput("");
      setLoading(true);
      setError("");

      try {
        const modelContext = await loadModelContext(params);
        const res = await fetch("/api/paimon/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentParams: params,
            modelContext,
            attachments: attachments.map((attachment, index) => ({
              ...attachment,
              referenceId: `참조${index + 1}`,
            })),
            messages: [...compactMessages, userMessage].map(
              ({ role, content }) => ({ role, content })
            ),
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          paramsPatch?: unknown;
          attachmentNotice?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(data.error || "파이몬 호출에 실패했습니다.");
        }

        const patch = sanitizePatch(data.paramsPatch);
        if (Object.keys(patch).length > 0) {
          onApplyParams(patch);
        }

        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              data.reply ||
              data.attachmentNotice ||
              "요청을 반영해서 현재 생성 정보를 수정했어요.",
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "파이몬 오류");
      } finally {
        setLoading(false);
      }
    },
    [attachments, compactMessages, loading, onApplyParams, params]
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
        const url = await uploadImageFile(file);
        const attachment: PaimonAttachment = {
          id: crypto.randomUUID(),
          kind: "clipboard_image",
          label: "클립보드 이미지",
          url,
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

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {open && (
        <section className="flex h-[min(76vh,620px)] w-[min(calc(100vw-2rem),420px)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
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
                onClick={() => setOpen(false)}
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
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[11px]"
                  title={attachment.url || attachment.metadata?.filename || ""}
                >
                  <ImagePlus className="size-3" />
                  <span className="font-medium">참조{index + 1}</span>
                  <span className="max-w-32 truncate text-muted-foreground">
                    {attachment.metadata?.filename || attachment.label}
                  </span>
                  <button
                    type="button"
                    className="ml-0.5 rounded-sm p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
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
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-5 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground"
                  }`}
                >
                  {message.content}
                </p>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                파이몬이 수정안을 만드는 중
              </div>
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <form
            className="border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(input);
            }}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
                placeholder="엘프 여자를 만들어줘"
                className="max-h-28 min-h-10 resize-none text-sm"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
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
        className="size-12 rounded-full shadow-xl"
        onClick={() => setOpen((current) => !current)}
        aria-label="Open Paimon"
        title="Paimon 파이몬"
      >
        <MessageCircle className="size-5" />
      </Button>
    </div>
  );
}
