import { useMediaWorkspaceStore } from "./media-workspace-store";
import type { SeedanceParams, SeedanceVideo } from "./seedance";
import { useSeedanceStore } from "./seedance-store";
import type { SituationVideoLink } from "./situation-video-store";
import { useStore } from "./store";
import { UNGROUPED_WORKSPACE_ID } from "./types";

// SeeDance generation lives at module scope — not in the page — so a run keeps
// streaming (and a Paimon situation batch keeps submitting clips) after the
// user navigates away from the SeeDance screen. The SSE stream writes straight
// into the module-level seedance store, which the page re-subscribes to when
// the user comes back. Mirrors the image generator's global queue store.

type Lang = "ko" | "en";

const STATUS_LABEL: Record<string, { ko: string; en: string }> = {
  queued: { ko: "대기 중", en: "Queued" },
  running: { ko: "생성 중", en: "Generating" },
  processing: { ko: "생성 중", en: "Generating" },
  downloading: { ko: "다운로드 중", en: "Downloading" },
};

const ERROR_LABEL = {
  needImage: { ko: "시작 이미지를 추가하세요.", en: "Add a start image." },
  needPrompt: { ko: "프롬프트를 입력하세요.", en: "Enter a prompt." },
} as const;

function currentLanguage(): Lang {
  return useStore.getState().language === "ko" ? "ko" : "en";
}

// Keyed by the pending card's client id so cancel can abort a specific run.
const abortControllers: Record<string, AbortController> = {};

export function cancelSeedanceGeneration(id: string) {
  abortControllers[id]?.abort();
  useSeedanceStore.getState().removePending(id);
}

// Validates and submits one SeeDance generation. Returns a localized error
// message when the params can't generate at all (so a mounted page can show it
// next to the button), or null once the run has been accepted. `link` names the
// character/situation a Paimon situation run composed this clip for; the server
// tags the finished clip's sidecar with it so the video registers into that
// situation in the character studio.
export async function startSeedanceGeneration(
  source: SeedanceParams,
  link?: SituationVideoLink
): Promise<string | null> {
  const language = currentLanguage();

  if (source.mode === "i2v" && !source.firstFrame) {
    return ERROR_LABEL.needImage[language];
  }
  if (!source.prompt.trim() && source.mode === "t2v") {
    return ERROR_LABEL.needPrompt[language];
  }

  const { addPending, updatePending, removePending, setVideos } =
    useSeedanceStore.getState();
  // The clip is filed under the workspace the SeeDance screen is filtered to,
  // read at submit time so a background batch honors the last-picked chip.
  const activeWorkspaceId =
    useMediaWorkspaceStore.getState().byMedia.seedance.activeWorkspaceId;

  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const controller = new AbortController();
  abortControllers[clientId] = controller;

  const pendingCard: SeedanceVideo = {
    id: clientId,
    url: "",
    filename: "",
    timestamp: Date.now(),
    contentType: "video/mp4",
    prompt: source.prompt,
    params: {
      mode: source.mode,
      prompt: source.prompt,
      resolution: source.resolution,
      ratio: source.ratio,
      duration: source.duration,
      cameraFixed: source.cameraFixed,
      watermark: source.watermark,
      cleanFrame: source.cleanFrame,
      seed: source.seed,
      hasFirstFrame: Boolean(source.firstFrame),
      hasLastFrame: Boolean(source.lastFrame),
      referenceCount: source.references.length,
    },
    thumbnail: source.firstFrame ?? null,
    status: {
      state: "queued",
      progress: 0.04,
      message: STATUS_LABEL.queued[language],
    },
  };
  addPending(pendingCard);

  try {
    const res = await fetch("/api/seedance/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The "ungrouped" sentinel isn't a real workspace, so it queues as no
      // target at all.
      body: JSON.stringify({
        ...source,
        clientId,
        workspaceId:
          activeWorkspaceId && activeWorkspaceId !== UNGROUPED_WORKSPACE_ID
            ? activeWorkspaceId
            : undefined,
        characterId: link?.characterId,
        situationId: link?.situationId,
      }),
      signal: controller.signal,
    });
    if (!res.body) throw new Error("No response stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let pollCount = 0;

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

        if (event === "task") {
          updatePending(clientId, {
            status: {
              state: "generating",
              progress: 0.12,
              message: STATUS_LABEL.running[language],
            },
          });
        } else if (event === "poll") {
          const status = String(data.status ?? "");
          if (status === "downloading") {
            updatePending(clientId, {
              status: {
                state: "generating",
                progress: 0.95,
                message: STATUS_LABEL.downloading[language],
              },
            });
          } else {
            pollCount += 1;
            const progress = Math.min(0.9, 0.15 + pollCount * 0.03);
            updatePending(clientId, {
              status: {
                state: "generating",
                progress,
                message: STATUS_LABEL.running[language],
              },
            });
          }
        } else if (event === "complete") {
          const video = data.video as SeedanceVideo | undefined;
          if (video) setVideos((prev) => [video, ...prev]);
          // Refresh the chip counts after the auto-registration above.
          if (activeWorkspaceId) {
            void useMediaWorkspaceStore.getState().fetchWorkspaces("seedance");
          }
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
