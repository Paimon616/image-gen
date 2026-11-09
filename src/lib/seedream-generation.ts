import { type SeedreamImage, type SeedreamParams } from "./seedream";
import { useSeedreamStore } from "./seedream-store";
import { useStore } from "./store";

// The generation lives at module scope — not in the page — so a run keeps
// streaming after the user navigates away from the Seedream screen. The SSE
// stream writes straight into the module-level store, which the page
// re-subscribes to when the user comes back. Mirrors the consistency sheet and
// SeeDance runners.

type Lang = "ko" | "en";

const STATUS_LABEL = {
  queued: { ko: "대기 중", en: "Queued" },
  running: { ko: "생성 중", en: "Generating" },
  saving: { ko: "저장 중", en: "Saving" },
} as const;

const NEED_PROMPT = {
  ko: "프롬프트를 입력하세요.",
  en: "Enter a prompt.",
} as const;

const NETWORK_ERROR = {
  ko: "네트워크 오류",
  en: "Network error",
} as const;

const FAILED = { ko: "생성 실패", en: "Generation failed" } as const;

// ModelArk refuses a reference smaller than 300px on a side, so the server
// drops those rather than failing the whole run. The user picked them, so say
// so instead of letting them quietly not count.
const DROPPED_REFERENCES = {
  ko: (n: number) =>
    `레퍼런스 ${n}장이 제외됐습니다 — 가로·세로 300px 미만은 보낼 수 없습니다.`,
  en: (n: number) =>
    `${n} reference image(s) skipped — ModelArk needs at least 300px on every side.`,
} as const;

function currentLanguage(): Lang {
  return useStore.getState().language === "ko" ? "ko" : "en";
}

// Keyed by the pending card's client id so cancel can abort a specific run.
const abortControllers: Record<string, AbortController> = {};

export function cancelSeedreamGeneration(id: string) {
  abortControllers[id]?.abort();
  useSeedreamStore.getState().removePending(id);
}

/**
 * Validates and submits one Seedream render. Returns a localized error message
 * when the params can't generate at all, or null once the run was accepted.
 */
export async function startSeedreamGeneration(
  source: SeedreamParams
): Promise<string | null> {
  const language = currentLanguage();

  // ModelArk rejects an empty prompt even when references are attached, so
  // this is a hard requirement rather than a nicety.
  if (!source.prompt.trim()) return NEED_PROMPT[language];

  const { addPending, updatePending, removePending, setImages, setNotice } =
    useSeedreamStore.getState();
  setNotice(null);

  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const controller = new AbortController();
  abortControllers[clientId] = controller;

  const pendingCard: SeedreamImage = {
    id: clientId,
    url: "",
    filename: "",
    timestamp: Date.now(),
    params: null,
    pendingPrompt: source.prompt,
    status: {
      state: "queued",
      progress: 0.04,
      message: STATUS_LABEL.queued[language],
    },
  };
  addPending(pendingCard);

  try {
    const res = await fetch("/api/seedream/generate", {
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
        const lines = block.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event: "));
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!eventLine || !dataLine) continue;
        const event = eventLine.slice("event: ".length).trim();
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataLine.slice("data: ".length));
        } catch {
          continue;
        }

        if (event === "tick") {
          // ModelArk's image endpoint is synchronous and reports no progress,
          // so the bar creeps toward 0.9 on the server's heartbeat instead of
          // claiming a percentage nobody measured.
          tickCount += 1;
          updatePending(clientId, {
            status: {
              state: "generating",
              progress: Math.min(0.9, 0.1 + tickCount * 0.04),
              message: STATUS_LABEL.running[language],
            },
          });
        } else if (event === "saving") {
          updatePending(clientId, {
            status: {
              state: "saving",
              progress: 0.95,
              message: STATUS_LABEL.saving[language],
            },
          });
        } else if (event === "complete") {
          const image = data.image as SeedreamImage | undefined;
          if (image) setImages((prev) => [image, ...prev]);
          const dropped =
            typeof data.droppedReferences === "number"
              ? data.droppedReferences
              : 0;
          if (dropped > 0) setNotice(DROPPED_REFERENCES[language](dropped));
          removePending(clientId);
        } else if (event === "error") {
          updatePending(clientId, {
            status: {
              state: "error",
              progress: 0,
              message: String(data.message ?? FAILED[language]),
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
          message: err instanceof Error ? err.message : NETWORK_ERROR[language],
        },
      });
    }
  } finally {
    delete abortControllers[clientId];
  }

  return null;
}
