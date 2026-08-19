"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useStore as useZustandStore } from "zustand";
import { Bot, ImagePlus, Loader2, MessageCircle, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  DEFAULT_CONVERSATION,
  EMPTY_ATTACHMENTS,
  EMPTY_MESSAGES,
  type PaimonConversationStore,
} from "@/lib/paimon-conversation";

interface PaimonPanelProps {
  store: PaimonConversationStore;
  // Which conversation inside the store this panel shows (the character studio
  // keeps one per character).
  conversationId?: string;
  subtitle: string;
  // Greeting bubble. Rendered from here rather than stored, so resetting the
  // chat and switching languages never leaves a stale intro in the transcript.
  intro: string;
  placeholder: string;
  title?: string;
  // Extra row above the composer (e.g. the image page's batch progress bar).
  footer?: ReactNode;
  // Extra controls inside the composer, above the textarea.
  toolbar?: ReactNode;
  // Controlled open state. Omit to let the panel manage its own.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Force the panel open on mount (used when background work is still running).
  defaultOpen?: boolean;
}

export function PaimonPanel({
  store,
  conversationId = DEFAULT_CONVERSATION,
  subtitle,
  intro,
  placeholder,
  title = "Paimon 파이몬",
  footer,
  toolbar,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
}: PaimonPanelProps) {
  // `store` is a prop, so subscribe through zustand's generic hook rather than
  // calling the bound hook itself (a prop cannot be a hook).
  const messages = useZustandStore(
    store,
    (state) => state.conversations[conversationId]?.messages ?? EMPTY_MESSAGES
  );
  const attachments = useZustandStore(
    store,
    (state) =>
      state.conversations[conversationId]?.attachments ?? EMPTY_ATTACHMENTS
  );
  const loading = useZustandStore(
    store,
    (state) => state.conversations[conversationId]?.loading ?? false
  );
  const status = useZustandStore(
    store,
    (state) => state.conversations[conversationId]?.status ?? ""
  );
  const error = useZustandStore(
    store,
    (state) => state.conversations[conversationId]?.error ?? ""
  );

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (onOpenChange) onOpenChange(next);
      else setUncontrolledOpen(next);
    },
    [onOpenChange]
  );
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  const introMessage = useMemo(
    () => ({ id: "intro", role: "assistant" as const, content: intro }),
    [intro]
  );
  const visibleMessages = useMemo(
    () => [introMessage, ...messages],
    [introMessage, messages]
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    store.getState().send(conversationId, text);
  }, [conversationId, input, loading, store]);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageItem = Array.from(event.clipboardData.items).find((item) =>
        item.type.startsWith("image/")
      );
      const file = imageItem?.getAsFile();
      if (!file) return;

      event.preventDefault();
      void store.getState().attachImageFile(conversationId, file);
    },
    [conversationId, store]
  );

  const lastMessage = visibleMessages[visibleMessages.length - 1];
  const isAssistantStreaming =
    loading && lastMessage?.role === "assistant" && lastMessage.content.length > 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
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
                <h3 className="truncate text-sm font-semibold">{title}</h3>
                <p className="truncate text-[11px] text-muted-foreground">
                  {subtitle}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => {
                  store.getState().reset(conversationId);
                  setInput("");
                }}
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
                    onClick={() =>
                      store.getState().removeAttachment(conversationId, attachment.id)
                    }
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
            {visibleMessages.map((message, index) => {
              const isStreaming =
                loading &&
                message.role === "assistant" &&
                index === visibleMessages.length - 1 &&
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

          {footer}

          <form
            className="border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
          >
            {toolbar}
            <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] gap-2">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
                placeholder={placeholder}
                className="max-h-28 min-h-10 resize-none text-sm"
                onKeyDown={(event) => {
                  // A Korean/Japanese/Chinese IME fires a confirming Enter
                  // (isComposing / keyCode 229) before the real submit Enter.
                  // Sending on that keystroke would clear the input
                  // mid-composition, so ignore it.
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !(event.nativeEvent.isComposing || event.keyCode === 229)
                  ) {
                    event.preventDefault();
                    send();
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

      <Button
        type="button"
        size="icon-lg"
        className={`size-12 rounded-full shadow-xl transition-[transform,background-color,box-shadow] duration-200 ease-out hover:scale-105 ${
          open ? "rotate-3 shadow-2xl ring-2 ring-primary/25" : "rotate-0"
        } motion-reduce:transform-none motion-reduce:transition-none`}
        onClick={() => setOpen(!open)}
        aria-label="Open Paimon"
        title={title}
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
