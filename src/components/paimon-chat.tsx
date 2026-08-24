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
import type { GeneratedImage, GenerationParams } from "@/lib/types";
import { readImageDataUrlForVision } from "@/lib/image-resize";
import {
  baseImageFromParams,
  FULL_COMPOSE_SCOPE,
  loadCharacterLibrary,
  usePaimonChatStore,
  type PaimonAttachment,
  type PaimonCharacter,
  type PaimonComposeOptions,
  type PaimonComposeScope,
} from "@/lib/paimon-chat-store";

export type { PaimonAttachment } from "@/lib/paimon-chat-store";

interface PaimonChatProps {
  attachments: PaimonAttachment[];
  onAttachmentsChange: (attachments: PaimonAttachment[]) => void;
  // Opens an image in the shared detail viewer (used by situation thumbnails).
  onOpenImage?: (image: GeneratedImage) => void;
}

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

export function PaimonChat({
  attachments,
  onAttachmentsChange,
  onOpenImage,
}: PaimonChatProps) {
  // Chat transcript, the in-flight turn and the multi-situation batch all live
  // in a module-level store (see paimon-chat-store.ts), so a run started here
  // keeps going — and stays visible on return — when the user navigates away.
  const messages = usePaimonChatStore((state) => state.messages);
  const loading = usePaimonChatStore((state) => state.loading);
  const status = usePaimonChatStore((state) => state.status);
  const error = usePaimonChatStore((state) => state.error);
  const batchProgress = usePaimonChatStore((state) => state.batch);
  const cancelBatch = usePaimonChatStore((state) => state.cancelBatch);
  const resetMessages = usePaimonChatStore((state) => state.reset);

  // A batch keeps running while the user is on another page, so open the panel
  // straight away when they come back to a run that is still going. (On a fresh
  // page load there is never a batch, so this matches the server render.)
  const [open, setOpen] = useState(() =>
    Boolean(usePaimonChatStore.getState().batch)
  );
  const [renderPanel, setRenderPanel] = useState(open);
  const [input, setInput] = useState("");
  // Character/situation picker (person-icon menu) state.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerChars, setPickerChars] = useState<PaimonCharacter[] | null>(null);
  const [pickerActiveName, setPickerActiveName] = useState<string | null>(null);
  // Picker options: auto-generate queues each picked situation; multi-select lets
  // the user check several situations and run them one after another.
  const [autoGenerate, setAutoGenerate] = useState(false);
  const [multiSelect, setMultiSelect] = useState(false);
  // Which segments of the baseline prompt this compose is allowed to rewrite.
  // All three on = the old behavior (a full re-compose of the situation).
  const [scope, setScope] = useState<PaimonComposeScope>(FULL_COMPOSE_SCOPE);
  // Picked 기준 이미지 (an already-generated image of this character whose
  // metadata becomes the baseline). null = the character's main image.
  const [baseImageId, setBaseImageId] = useState<string | null>(null);
  const [selectedSituationIds, setSelectedSituationIds] = useState<Set<string>>(
    new Set()
  );
  // Thumbnails of already-generated images, grouped by situation id, for the
  // active character in the picker.
  const [situationImages, setSituationImages] = useState<
    Record<string, GeneratedImage[]>
  >({});
  const [situationImagesLoading, setSituationImagesLoading] = useState(false);
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

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim() || loading) return;
      setInput("");
      usePaimonChatStore.getState().sendMessage(content, attachments);
    },
    [attachments, loading]
  );

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
    setBaseImageId(null);
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
  // situation id, so each situation row can show what's been made for it — and
  // so "미생성만 선택" knows which situations have no image yet.
  const loadSituationImages = useCallback(async (characterId: string) => {
    setSituationImagesLoading(true);
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
    } finally {
      setSituationImagesLoading(false);
    }
  }, []);

  // Opens a character's situation list and loads its existing thumbnails.
  const openCharacterSituations = useCallback(
    (character: PaimonCharacter) => {
      setPickerActiveName(character.name);
      setSelectedSituationIds(new Set());
      setSituationImages({});
      setBaseImageId(null);
      void loadSituationImages(character.id);
    },
    [loadSituationImages]
  );

  // Saved images of the active character that can serve as the 기준 이미지 —
  // only those whose metadata sidecar still carries a prompt, newest first.
  const baseImageChoices = useMemo(
    () =>
      Object.values(situationImages)
        .flat()
        .filter((image) => (image.params?.prompt ?? "").trim())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 24),
    [situationImages]
  );

  const selectedBaseImage = useMemo(
    () => baseImageChoices.find((image) => image.id === baseImageId) ?? null,
    [baseImageChoices, baseImageId]
  );

  // The two picker options that change WHAT gets composed: which prompt segments
  // are in scope, and which image's metadata is the baseline.
  const composeOptions = useMemo<PaimonComposeOptions>(
    () => ({
      scope,
      baseImage: selectedBaseImage
        ? baseImageFromParams(selectedBaseImage.params)
        : undefined,
      baseImageLabel: selectedBaseImage?.filename,
    }),
    [scope, selectedBaseImage]
  );

  const toggleScope = useCallback((key: keyof PaimonComposeScope) => {
    setScope((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  // Single pick (multi-select off): compose the situation, generate if the
  // auto-generate box is checked. Closes the picker.
  const applyCharacterSituation = useCallback(
    (character: PaimonCharacter, situationId?: string) => {
      setPickerOpen(false);
      setPickerActiveName(null);
      void usePaimonChatStore
        .getState()
        .composeSituation(
          character,
          situationId,
          autoGenerate,
          attachments,
          composeOptions
        );
    },
    [attachments, autoGenerate, composeOptions]
  );

  const runBatch = useCallback(
    (character: PaimonCharacter) => {
      const chosen = character.situations
        .filter((situation) => selectedSituationIds.has(situation.id))
        .map((situation) => situation.id);
      if (chosen.length === 0) return;

      setPickerOpen(false);
      setPickerActiveName(null);
      setSelectedSituationIds(new Set());
      void usePaimonChatStore
        .getState()
        .runBatch(character, chosen, attachments, composeOptions);
    },
    [attachments, composeOptions, selectedSituationIds]
  );

  const toggleSituationSelected = useCallback((situationId: string) => {
    setSelectedSituationIds((current) => {
      const next = new Set(current);
      if (next.has(situationId)) next.delete(situationId);
      else next.add(situationId);
      return next;
    });
  }, []);

  // Bulk pickers. Both switch multi-select on so the checked rows and the run
  // button appear right away.
  const selectSituations = useCallback((situationIds: string[]) => {
    setMultiSelect(true);
    setSelectedSituationIds(new Set(situationIds));
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
    resetMessages();
    onAttachmentsChange([]);
    setInput("");
  }, [onAttachmentsChange, resetMessages]);

  const handlePaste = useCallback(
    async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageItem = Array.from(event.clipboardData.items).find((item) =>
        item.type.startsWith("image/")
      );
      const file = imageItem?.getAsFile();

      if (!file) return;

      event.preventDefault();
      const store = usePaimonChatStore.getState();
      store.setLoading(true);
      store.setError("");
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
        store.pushAssistantMessage("클립보드 이미지가 채팅에 첨부됐어요.");
      } catch (err) {
        store.setError(
          err instanceof Error ? err.message : "이미지 업로드 실패"
        );
      } finally {
        usePaimonChatStore.getState().setLoading(false);
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
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {renderPanel && (
        <section
          className={`flex h-[min(76vh,620px)] w-[min(calc(100vw-2rem),420px)] origin-bottom-right flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl transition-[opacity,transform,filter] duration-[180ms] ease-out ${
            open
              ? "pointer-events-auto translate-y-0 scale-100 opacity-100 blur-0"
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
              sendMessage(input);
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
                        // "Ungenerated" = no image has ever been saved for that
                        // situation (the thumbnails just loaded above).
                        const ungeneratedIds = active.situations
                          .filter(
                            (situation) =>
                              (situationImages[situation.id] ?? []).length === 0
                          )
                          .map((situation) => situation.id);
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

                            {/* Which prompt segments this compose may rewrite.
                                Everything unchecked stays exactly as the base
                                image had it. */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1.5">
                              <span className="text-[11px] font-medium text-muted-foreground">
                                교체 항목
                              </span>
                              {(
                                [
                                  ["outfit", "의상"],
                                  ["background", "배경"],
                                  ["situation", "상황"],
                                ] as [keyof PaimonComposeScope, string][]
                              ).map(([key, label]) => (
                                <label
                                  key={key}
                                  className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
                                >
                                  <input
                                    type="checkbox"
                                    className="size-3.5 accent-primary"
                                    checked={scope[key]}
                                    onChange={() => toggleScope(key)}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>

                            {/* 기준 이미지: whose metadata is loaded before the
                                checked segments are rewritten. */}
                            <div className="px-1 pt-1.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] font-medium text-muted-foreground">
                                  기준 이미지
                                </span>
                                <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                                  {selectedBaseImage
                                    ? selectedBaseImage.filename
                                    : active.mainImage
                                      ? "메인 이미지"
                                      : "없음 · 현재 설정 사용"}
                                </span>
                              </div>
                              {/* 캐릭터 LoRA is merged on top of whichever
                                  기준 이미지 is picked, so it reads as a
                                  standing fact rather than a per-image one. */}
                              {(active.loras?.length ?? 0) > 0 && (
                                <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                  캐릭터 LoRA 항상 적용:{" "}
                                  {active.loras
                                    ?.map((lora) => `${lora.path}(${lora.scale})`)
                                    .join(", ")}
                                </p>
                              )}
                              <div className="mt-1 flex gap-1 overflow-x-auto pb-0.5">
                                <button
                                  type="button"
                                  className={`flex size-12 shrink-0 flex-col items-center justify-center rounded border text-[10px] ${
                                    baseImageId === null
                                      ? "border-primary bg-primary/10 text-foreground ring-1 ring-primary"
                                      : "border-border bg-muted text-muted-foreground"
                                  }`}
                                  onClick={() => setBaseImageId(null)}
                                  title={
                                    active.mainImage
                                      ? "캐릭터 메인 이미지를 기준으로"
                                      : "기준 이미지 없이 현재 설정 사용"
                                  }
                                >
                                  {active.mainImage ? "메인" : "없음"}
                                </button>
                                {situationImagesLoading && (
                                  <span className="flex size-12 shrink-0 items-center justify-center rounded border border-border bg-muted">
                                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                                  </span>
                                )}
                                {baseImageChoices.map((image) => (
                                  <button
                                    key={image.id}
                                    type="button"
                                    className={`size-12 shrink-0 overflow-hidden rounded border ${
                                      baseImageId === image.id
                                        ? "border-primary ring-1 ring-primary"
                                        : "border-border"
                                    } bg-muted`}
                                    onClick={() =>
                                      setBaseImageId(
                                        baseImageId === image.id
                                          ? null
                                          : image.id
                                      )
                                    }
                                    title={`${image.filename} 를 기준 이미지로`}
                                  >
                                    <img
                                      src={image.thumbnailUrl || image.url}
                                      alt="기준 이미지 후보"
                                      className="h-full w-full object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
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

                            {/* Bulk selection — both turn 여러 장 on. */}
                            <div className="flex flex-wrap items-center gap-1 border-b border-border px-1 pb-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                disabled={active.situations.length === 0}
                                onClick={() =>
                                  selectSituations(
                                    active.situations.map(
                                      (situation) => situation.id
                                    )
                                  )
                                }
                              >
                                상황 모두 선택 ({active.situations.length})
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px]"
                                disabled={
                                  situationImagesLoading ||
                                  ungeneratedIds.length === 0
                                }
                                onClick={() => selectSituations(ungeneratedIds)}
                                title="아직 이미지가 없는 상황만 선택"
                              >
                                {situationImagesLoading ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  `미생성 모두 선택 (${ungeneratedIds.length})`
                                )}
                              </Button>
                              {selectedCount > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-[11px] text-muted-foreground"
                                  onClick={() =>
                                    setSelectedSituationIds(new Set())
                                  }
                                >
                                  선택 해제
                                </Button>
                              )}
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
                                      {thumbs.length === 0 && (
                                        <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
                                          미생성
                                        </span>
                                      )}
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
                                  onClick={() => runBatch(active)}
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
                    sendMessage(input);
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
        className={`pointer-events-auto size-12 rounded-full shadow-xl transition-[transform,background-color,box-shadow] duration-200 ease-out hover:scale-105 ${
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
