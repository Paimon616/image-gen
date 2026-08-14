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
import { ChatMarkdown } from "@/components/chat-markdown";
import type {
  Character,
  CharacterOutfit,
  CharacterSituation,
} from "@/lib/types";
import { readImageDataUrlForVision } from "@/lib/image-resize";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface CharacterPaimonAttachment {
  id: string;
  kind: "clipboard_image" | "gallery_image";
  label: string;
  url?: string;
  dataUrl?: string;
}

interface CharacterPaimonChatProps {
  character: Character;
  onApplyPatch: (patch: Partial<Character>) => void;
}

const INTRO_MESSAGE: ChatMessage = {
  id: "intro",
  role: "assistant",
  content:
    "파이몬이에요. 어떤 캐릭터를 만들지 이야기해 주세요. 외형·의상·배경·상황을 알맞은 칸에 자동으로 채워드릴게요. 성인/NSFW 묘사도 가능해요.",
};

async function uploadImageFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
  return data.url;
}

function normalizeOutfits(value: unknown): CharacterOutfit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      prompt: typeof item.prompt === "string" ? item.prompt : "",
    }));
}

function normalizeSituations(value: unknown): CharacterSituation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      prompt: typeof item.prompt === "string" ? item.prompt : "",
    }));
}

const STRING_KEYS: (keyof Character)[] = [
  "name",
  "summary",
  "appearanceDescription",
  "appearancePrompt",
  "backgroundDescription",
  "backgroundPrompt",
];

// Keep only known character fields, coercing arrays through the normalizers so
// Paimon-authored outfits/situations always carry a client id.
function sanitizePatch(value: unknown): Partial<Character> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const patch: Partial<Character> = {};

  for (const key of STRING_KEYS) {
    if (typeof record[key] === "string") {
      (patch as Record<string, unknown>)[key] = record[key];
    }
  }
  if ("outfits" in record) patch.outfits = normalizeOutfits(record.outfits);
  if ("situations" in record)
    patch.situations = normalizeSituations(record.situations);

  return patch;
}

export function CharacterPaimonChat({
  character,
  onApplyPatch,
}: CharacterPaimonChatProps) {
  const [open, setOpen] = useState(false);
  const [renderPanel, setRenderPanel] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE]);
  const [attachments, setAttachments] = useState<CharacterPaimonAttachment[]>(
    []
  );
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  // Always send Paimon the freshest character without re-creating sendMessage.
  const characterRef = useRef(character);
  useEffect(() => {
    characterRef.current = character;
  }, [character]);

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
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = window.setTimeout(() => {
      setRenderPanel(false);
      closeTimeoutRef.current = null;
    }, 180);
  }, []);

  const togglePanel = useCallback(() => {
    if (open) closePanel();
    else openPanel();
  }, [closePanel, open, openPanel]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

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

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
  }, []);

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
        const res = await fetch("/api/paimon/character", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            character: characterRef.current,
            attachments: attachments.map((attachment, index) => ({
              kind: attachment.kind,
              url: attachment.url,
              dataUrl: attachment.dataUrl,
              referenceId: `참조${index + 1}`,
            })),
            messages: [...compactMessages, userMessage].map(
              ({ role, content }) => ({ role, content })
            ),
          }),
        });

        const contentType = res.headers.get("Content-Type") ?? "";
        if (
          !res.ok ||
          !res.body ||
          !contentType.includes("text/event-stream")
        ) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error || "파이몬 호출에 실패했습니다.");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedText = "";
        let done: {
          reply?: string;
          characterPatch?: unknown;
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
            const lines = rawEvent.split("\n");
            const event =
              lines
                .find((line) => line.startsWith("event:"))
                ?.slice("event:".length)
                .trim() ?? "message";
            const dataLine = lines.find((line) => line.startsWith("data:"));
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

        const patch = sanitizePatch(done?.characterPatch);
        const applied = Object.keys(patch).length > 0;
        if (applied) onApplyPatch(patch);

        const finalContent =
          done?.reply ||
          streamedText ||
          done?.attachmentNotice ||
          (applied
            ? "요청을 반영해서 캐릭터 설정을 수정했어요."
            : "이번에는 반영할 내용을 만들지 못했어요. 조금 더 구체적으로 다시 요청해 주세요.");
        setAssistantContent(finalContent);
      } catch (err) {
        if (placeholderAdded) {
          setMessages((current) =>
            current.filter(
              (message) =>
                !(message.id === assistantId && message.content === "")
            )
          );
        }
        setError(err instanceof Error ? err.message : "파이몬 오류");
      } finally {
        setLoading(false);
        setStatus("");
      }
    },
    [attachments, compactMessages, loading, onApplyPatch]
  );

  const resetChat = useCallback(() => {
    setMessages([INTRO_MESSAGE]);
    setAttachments([]);
    setInput("");
    setError("");
  }, []);

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
        setAttachments((current) =>
          [
            ...current,
            {
              id: crypto.randomUUID(),
              kind: "clipboard_image" as const,
              label: "클립보드 이미지",
              url,
              dataUrl,
            },
          ].slice(-6)
        );
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "참조 이미지가 첨부됐어요. 이 이미지를 바탕으로 외형을 묘사해 드릴까요?",
          },
        ]);
        openPanel();
      } catch (err) {
        setError(err instanceof Error ? err.message : "이미지 업로드 실패");
      } finally {
        setLoading(false);
      }
    },
    [openPanel]
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
                  {character.name
                    ? `"${character.name}" 캐릭터 설정을 채웁니다`
                    : "대화로 캐릭터 설정을 채웁니다"}
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
                참조1, 참조2로 지칭
              </span>
              {attachments.map((attachment, index) => (
                <div
                  key={attachment.id}
                  className="relative flex w-24 shrink-0 flex-col overflow-hidden rounded-md border border-border bg-secondary text-[11px]"
                >
                  <div className="relative h-16 w-full bg-muted">
                    {attachment.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={attachment.url}
                        alt={`${attachment.label} 미리보기`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-muted-foreground">
                        <ImagePlus className="size-5" />
                      </span>
                    )}
                    <span className="absolute bottom-1 left-1 rounded bg-background/85 px-1 py-0.5 font-semibold shadow-sm backdrop-blur-sm">
                      참조{index + 1}
                    </span>
                  </div>
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
                placeholder="바닷가에서 수영하는 은발 엘프 여성을 만들어줘"
                className="max-h-28 min-h-10 resize-none text-sm"
                onKeyDown={(event) => {
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
          open ? "rotate-3 shadow-2xl ring-2 ring-primary/25" : "rotate-0"
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
