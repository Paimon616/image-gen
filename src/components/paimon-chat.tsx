"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ImagePlus, Loader2, MessageCircle, Send, X } from "lucide-react";
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
  queuedAttachment: PaimonAttachment | null;
}

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

export function PaimonChat({
  params,
  onApplyParams,
  queuedAttachment,
}: PaimonChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "intro",
      role: "assistant",
      content:
        "파이몬이에요. 현재 입력값을 읽고 프롬프트, 모델 설정, LoRA, 업스케일, 참조 이미지를 바로 고쳐드릴게요.",
    },
  ]);
  const [attachments, setAttachments] = useState<PaimonAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const seenAttachmentIds = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!queuedAttachment || seenAttachmentIds.current.has(queuedAttachment.id)) {
      return;
    }

    seenAttachmentIds.current.add(queuedAttachment.id);
    setOpen(true);
    setAttachments((current) => [queuedAttachment, ...current].slice(0, 6));
  }, [queuedAttachment]);

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
        const res = await fetch("/api/paimon/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentParams: params,
            attachments,
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

        setAttachments((current) => [attachment, ...current].slice(0, 6));
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
    []
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
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              aria-label="Close Paimon"
            >
              <X />
            </Button>
          </header>

          {attachments.length > 0 && (
            <div className="flex gap-2 overflow-x-auto border-b border-border px-3 py-2">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-1 text-[11px]"
                  title={attachment.url || attachment.metadata?.filename || ""}
                >
                  <ImagePlus className="size-3" />
                  {attachment.label}
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
