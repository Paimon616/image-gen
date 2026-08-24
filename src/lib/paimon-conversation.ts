import { create } from "zustand";
import { readImageDataUrlForVision } from "./image-resize";

export type PaimonRole = "user" | "assistant";

export interface PaimonMessage {
  id: string;
  role: PaimonRole;
  content: string;
}

export interface PaimonAttachment {
  id: string;
  kind: "clipboard_image" | "gallery_image";
  label: string;
  url?: string;
  dataUrl?: string;
}

export interface PaimonDonePayload {
  reply?: string;
  paramsPatch?: unknown;
  characterPatch?: unknown;
  attachmentNotice?: string;
}

export interface PaimonConversation {
  messages: PaimonMessage[];
  attachments: PaimonAttachment[];
  loading: boolean;
  status: string;
  error: string;
}

export interface PaimonConversationState {
  // Keyed so one store can hold several independent chats (the character studio
  // keeps one per character). Single-surface stores just use DEFAULT_CONVERSATION.
  conversations: Record<string, PaimonConversation>;

  // Ids of the conversations with a turn in flight, oldest first. Lets a screen
  // that mounts mid-answer jump straight to the chat that is still running (and
  // to the most recently started one when several are).
  activeTurns: string[];

  runTurn: (
    conversationId: string,
    content: string
  ) => Promise<PaimonDonePayload | null>;
  send: (conversationId: string, content: string) => void;
  // Aborts the turn that is streaming in this conversation. The partial reply
  // stays in the transcript; the patch it would have produced is discarded.
  cancelTurn: (conversationId: string) => void;
  reset: (conversationId: string) => void;
  setError: (conversationId: string, error: string) => void;
  pushAssistantMessage: (conversationId: string, content: string) => void;
  attachImageFile: (conversationId: string, file: File) => Promise<void>;
  addAttachment: (conversationId: string, attachment: PaimonAttachment) => void;
  removeAttachment: (conversationId: string, attachmentId: string) => void;
  clearAttachments: (conversationId: string) => void;
}

export const DEFAULT_CONVERSATION = "default";

// Stable empty values so selectors on a not-yet-created conversation never hand
// React a fresh object every render.
export const EMPTY_MESSAGES: PaimonMessage[] = [];
export const EMPTY_ATTACHMENTS: PaimonAttachment[] = [];

const EMPTY_CONVERSATION: PaimonConversation = {
  messages: EMPTY_MESSAGES,
  attachments: EMPTY_ATTACHMENTS,
  loading: false,
  status: "",
  error: "",
};

export interface PaimonConversationConfig {
  endpoint: string;
  // Builds the POST body for one turn. Runs at send time, so it always reads the
  // freshest params/character snapshot — even when no panel is mounted.
  buildBody: (args: {
    conversationId: string;
    messages: { role: PaimonRole; content: string }[];
    attachments: PaimonAttachment[];
  }) => unknown | Promise<unknown>;
  // Applies whatever the turn produced (params patch, character patch, ...).
  // Returns true when something was applied, which picks the fallback reply.
  applyDone: (
    done: PaimonDonePayload,
    conversationId: string
  ) => boolean | Promise<boolean>;
  // Fallback reply text when the model streamed nothing usable.
  appliedReply?: () => string;
  emptyReply?: () => string;
  errorLabel?: () => string;
  // How many past turns to send back as context.
  historyLimit?: number;
  // Called when the user cancels a turn — a store can stop its own follow-up
  // work (e.g. the character store's auto-continuing situation batch).
  onCancel?: (conversationId: string) => void;
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

// Builds one Paimon chat store. The state lives at module scope, so a turn that
// is still streaming when the user navigates away keeps writing into it and the
// finished answer (and its patch) is there when they come back.
export function createPaimonConversationStore(config: PaimonConversationConfig) {
  const historyLimit = config.historyLimit ?? 10;

  // One in-flight turn per conversation; module scope like the store itself, so
  // a turn started before the panel unmounted can still be cancelled on return.
  const abortControllers = new Map<string, AbortController>();

  return create<PaimonConversationState>((set, get) => {
    const conversation = (id: string) =>
      get().conversations[id] ?? EMPTY_CONVERSATION;

    const patchConversation = (
      id: string,
      update: (current: PaimonConversation) => Partial<PaimonConversation>
    ) =>
      set((state) => {
        const current = state.conversations[id] ?? EMPTY_CONVERSATION;
        return {
          conversations: {
            ...state.conversations,
            [id]: { ...current, ...update(current) },
          },
        };
      });

    return {
      conversations: {},
      activeTurns: [],

      setError: (id, error) => patchConversation(id, () => ({ error })),

      pushAssistantMessage: (id, content) =>
        patchConversation(id, (current) => ({
          messages: [
            ...current.messages,
            { id: crypto.randomUUID(), role: "assistant" as const, content },
          ],
        })),

      addAttachment: (id, attachment) =>
        patchConversation(id, (current) => ({
          attachments: [...current.attachments, attachment].slice(-6),
        })),

      removeAttachment: (id, attachmentId) =>
        patchConversation(id, (current) => ({
          attachments: current.attachments.filter(
            (attachment) => attachment.id !== attachmentId
          ),
        })),

      clearAttachments: (id) => patchConversation(id, () => ({ attachments: [] })),

      reset: (id) =>
        patchConversation(id, () => ({
          messages: [],
          attachments: [],
          error: "",
        })),

      // Uploads a pasted image (full-size for reuse) plus a downscaled copy for
      // the vision model, then attaches it to the conversation.
      attachImageFile: async (id, file) => {
        patchConversation(id, () => ({ loading: true, error: "" }));
        try {
          const [url, dataUrl] = await Promise.all([
            uploadImageFile(file),
            readImageDataUrlForVision(file),
          ]);
          get().addAttachment(id, {
            id: crypto.randomUUID(),
            kind: "clipboard_image",
            label: "클립보드 이미지",
            url,
            dataUrl,
          });
        } catch (err) {
          patchConversation(id, () => ({
            error: err instanceof Error ? err.message : "이미지 업로드 실패",
          }));
        } finally {
          patchConversation(id, () => ({ loading: false }));
        }
      },

      runTurn: async (id, content) => {
        const trimmed = content.trim();
        if (!trimmed) return null;

        const current = conversation(id);
        const userMessage: PaimonMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
        };
        const history = current.messages
          .slice(-historyLimit)
          .map(({ role, content: text }) => ({ role, content: text }));

        patchConversation(id, (state) => ({
          messages: [...state.messages, userMessage],
          loading: true,
          status: "",
          error: "",
        }));
        set((state) => ({
          activeTurns: [
            ...state.activeTurns.filter((entry) => entry !== id),
            id,
          ],
        }));

        // Replaces (and implicitly ends) a stale controller for this
        // conversation — send() blocks concurrent turns, so there is at most
        // one live turn per id.
        const abortController = new AbortController();
        abortControllers.set(id, abortController);

        const assistantId = crypto.randomUUID();
        let streamedText = "";
        let placeholderAdded = false;
        const ensurePlaceholder = () => {
          if (placeholderAdded) return;
          placeholderAdded = true;
          patchConversation(id, (state) => ({
            messages: [
              ...state.messages,
              { id: assistantId, role: "assistant" as const, content: "" },
            ],
          }));
        };
        const appendToAssistant = (text: string) => {
          ensurePlaceholder();
          patchConversation(id, (state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + text }
                : message
            ),
          }));
        };
        const setAssistantContent = (text: string) => {
          ensurePlaceholder();
          patchConversation(id, (state) => ({
            messages: state.messages.map((message) =>
              message.id === assistantId ? { ...message, content: text } : message
            ),
          }));
        };

        try {
          const body = await config.buildBody({
            conversationId: id,
            messages: [...history, { role: userMessage.role, content: trimmed }],
            attachments: current.attachments,
          });
          const res = await fetch(config.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: abortController.signal,
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
          let done: PaimonDonePayload | null = null;
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
                patchConversation(id, () => ({ status: payload.message }));
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

          const applied = await config.applyDone(done ?? {}, id);
          const finalContent =
            done?.reply ||
            streamedText ||
            done?.attachmentNotice ||
            (applied
              ? config.appliedReply?.() ?? "요청을 반영했어요."
              : config.emptyReply?.() ??
                "이번에는 반영할 내용을 만들지 못했어요. 조금 더 구체적으로 다시 요청해 주세요.");
          setAssistantContent(finalContent);
          return done;
        } catch (err) {
          // The user cancelled: keep what was streamed, mark it as cut off,
          // and don't surface an error. The would-be patch is discarded.
          if (abortController.signal.aborted) {
            if (streamedText) {
              setAssistantContent(`${streamedText}\n\n_(여기까지 쓰고 취소됐어요.)_`);
            } else {
              if (placeholderAdded) {
                patchConversation(id, (state) => ({
                  messages: state.messages.filter(
                    (message) =>
                      !(message.id === assistantId && message.content === "")
                  ),
                }));
              }
              get().pushAssistantMessage(id, "답변 생성을 취소했어요.");
            }
            return null;
          }
          // Drop an empty placeholder so a failed turn doesn't leave a blank bubble.
          if (placeholderAdded) {
            patchConversation(id, (state) => ({
              messages: state.messages.filter(
                (message) =>
                  !(message.id === assistantId && message.content === "")
              ),
            }));
          }
          patchConversation(id, () => ({
            error:
              err instanceof Error
                ? err.message
                : config.errorLabel?.() ?? "파이몬 오류",
          }));
          return null;
        } finally {
          if (abortControllers.get(id) === abortController) {
            abortControllers.delete(id);
          }
          patchConversation(id, () => ({ loading: false, status: "" }));
          set((state) => ({
            activeTurns: state.activeTurns.filter((entry) => entry !== id),
          }));
        }
      },

      send: (id, content) => {
        if (conversation(id).loading) return;
        void get().runTurn(id, content);
      },

      cancelTurn: (id) => {
        const controller = abortControllers.get(id);
        if (!controller) return;
        config.onCancel?.(id);
        controller.abort();
      },
    };
  });
}

export type PaimonConversationStore = ReturnType<
  typeof createPaimonConversationStore
>;

// The conversation whose answer is still being written, preferring the most
// recently started one when several are in flight.
export function runningConversationId(
  store: PaimonConversationStore
): string | null {
  const { activeTurns } = store.getState();
  return activeTurns[activeTurns.length - 1] ?? null;
}
