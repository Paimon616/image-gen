import {
  consistencySheetReferences,
  type ConsistencySheetImage,
  type ConsistencySheetParams,
} from "./consistency-sheet";
import { useConsistencySheetStore } from "./consistency-sheet-store";
import { useStore } from "./store";

// The generation lives at module scope — not in the page — so a run keeps
// streaming after the user navigates away from the consistency sheet screen.
// The SSE stream writes straight into the module-level store, which the page
// re-subscribes to when the user comes back. Mirrors the SeeDance runner.

type Lang = "ko" | "en";

const STATUS_LABEL: Record<string, { ko: string; en: string }> = {
  queued: { ko: "대기 중", en: "Queued" },
  running: { ko: "생성 중", en: "Generating" },
  saving: { ko: "저장 중", en: "Saving" },
};

const NEED_PROMPT = {
  ko: "시트로 만들 캐릭터나 공간을 프롬프트로 설명하세요.",
  en: "Describe the character or the place for the sheet.",
} as const;

const NEED_SCENE_PROMPT = {
  ko: "어떤 장면인지 프롬프트로 설명하세요.",
  en: "Describe the scene you want.",
} as const;

function currentLanguage(): Lang {
  return useStore.getState().language === "ko" ? "ko" : "en";
}

// Keyed by the pending card's client id so cancel can abort a specific run.
const abortControllers: Record<string, AbortController> = {};

export function cancelConsistencySheetGeneration(id: string) {
  abortControllers[id]?.abort();
  useConsistencySheetStore.getState().removePending(id);
}

// Validates and submits one sheet generation. Returns a localized error
// message when the params can't generate at all, or null once the run has
// been accepted.
export async function startConsistencySheetGeneration(
  source: ConsistencySheetParams
): Promise<string | null> {
  const language = currentLanguage();

  if (!source.prompt.trim() && consistencySheetReferences(source).length === 0) {
    return (source.mode === "scene" ? NEED_SCENE_PROMPT : NEED_PROMPT)[language];
  }

  const { addPending, updatePending, removePending, setImages } =
    useConsistencySheetStore.getState();

  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const controller = new AbortController();
  abortControllers[clientId] = controller;

  const pendingCard: ConsistencySheetImage = {
    id: clientId,
    url: "",
    filename: "",
    timestamp: Date.now(),
    contentType: "image/png",
    prompt: source.prompt,
    // The finished sheet's params come back with the run; the pending card only
    // ever shows the prompt, and the model is picked server-side.
    params: null,
    status: {
      state: "queued",
      progress: 0.04,
      message: STATUS_LABEL.queued[language],
    },
  };
  addPending(pendingCard);

  try {
    const res = await fetch("/api/consistency-sheet/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...source, clientId }),
      signal: controller.signal,
    });
    if (!res.body) throw new Error("No response stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let tickCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const eventLine = block.split("\n").find((l) => l.startsWith("event: "));
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "));
        if (!eventLine || !dataLine) continue;
        const event = eventLine.slice("event: ".length).trim();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataLine.slice("data: ".length));
        } catch {
          continue;
        }

        if (event === "tick" && data.state === "GPU") {
          // GPU engine: the generation route's own progress messages.
          const percent = typeof data.progress === "number" ? data.progress : null;
          updatePending(clientId, {
            status: {
              state: "generating",
              progress: percent !== null ? Math.min(0.95, Math.max(0.05, percent / 100)) : 0.1,
              message: String(data.message || STATUS_LABEL.running[language]),
            },
          });
        } else if (event === "tick") {
          // One tick per queue poll, carrying fal's own queue state.
          tickCount += 1;
          const progress = Math.min(0.9, 0.1 + tickCount * 0.03);
          const waiting = data.state === "IN_QUEUE";
          const position =
            typeof data.queuePosition === "number" ? data.queuePosition : null;
          updatePending(clientId, {
            status: {
              state: "generating",
              progress,
              message: waiting
                ? position && position > 0
                  ? `${STATUS_LABEL.queued[language]} · ${position}`
                  : STATUS_LABEL.queued[language]
                : STATUS_LABEL.running[language],
            },
          });
        } else if (event === "saving") {
          updatePending(clientId, {
            status: {
              state: "generating",
              progress: 0.95,
              message: STATUS_LABEL.saving[language],
            },
          });
        } else if (event === "complete") {
          const image = data.image as ConsistencySheetImage | undefined;
          if (image) setImages((prev) => [image, ...prev]);
          removePending(clientId);
        } else if (event === "error") {
          updatePending(clientId, {
            status: {
              state: "error",
              progress: 0,
              message: String(data.message ?? "생성 실패"),
            },
          });
        } else if (event === "canceled") {
          removePending(clientId);
        }
      }
    }
  } catch (err) {
    if (controller.signal.aborted) {
      removePending(clientId);
    } else {
      updatePending(clientId, {
        status: {
          state: "error",
          progress: 0,
          message: err instanceof Error ? err.message : "네트워크 오류",
        },
      });
    }
  } finally {
    delete abortControllers[clientId];
  }

  return null;
}
