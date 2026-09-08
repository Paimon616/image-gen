import { createPaimonConversationStore } from "./paimon-conversation";
import { type ConsistencySheetParams } from "./consistency-sheet";
import { useConsistencySheetStore } from "./consistency-sheet-store";

// Only the settings Paimon is allowed to touch. The reference images are data
// URIs — they go along as attachments, never as patchable params.
function sanitizeConsistencySheetPatch(
  value: unknown
): Partial<ConsistencySheetParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const patch: Partial<ConsistencySheetParams> = {};

  if (typeof record.prompt === "string") patch.prompt = record.prompt;
  if (record.mode === "character" || record.mode === "background") {
    patch.mode = record.mode;
  }
  return patch;
}

function referenceAttachment(image: string, referenceId: string) {
  return image.startsWith("data:")
    ? { kind: "gallery_image" as const, dataUrl: image, referenceId }
    : { kind: "gallery_image" as const, url: image, referenceId };
}

// The consistency sheet's Paimon. The transcript and the params it edits both
// live in module-level stores, so an answer still streaming when the user
// leaves the page finishes and lands on the params they come back to.
export const useConsistencySheetPaimonStore = createPaimonConversationStore({
  endpoint: "/api/paimon/chat",
  appliedReply: () => "요청을 반영해서 일관성 시트 설정을 수정했어요.",
  buildBody: async ({ messages, attachments }) => {
    const params = useConsistencySheetStore.getState().params;
    return {
      messages,
      // Image fields are stripped: multi-MB data URIs must not ride along as
      // params (they are sent as attachments below instead).
      currentParams: {
        image_model: "openai/gpt-5.4-image-2 (OpenRouter)",
        // What this surface produces, so Paimon writes prompts for a single
        // consistency reference sheet rather than a normal render.
        surface:
          params.mode === "character"
            ? "character consistency sheet (one image: full-body turnaround front/side/back + 4 face expressions, plain white background)"
            : "background consistency sheet (one image: ONE single location photographed from 4 camera positions in a 2x2 grid — same architecture, furniture, props and lighting in every panel, no people)",
        mode: params.mode,
        prompt: params.prompt,
      },
      attachments: [
        ...params.references.map((reference, index) =>
          referenceAttachment(reference, `참조${index + 1}`)
        ),
        ...attachments.map((attachment, index) => ({
          kind: attachment.kind,
          url: attachment.url,
          dataUrl: attachment.dataUrl,
          referenceId: `첨부${index + 1}`,
        })),
      ],
    };
  },
  applyDone: (done) => {
    const patch = sanitizeConsistencySheetPatch(done.paramsPatch);
    if (Object.keys(patch).length === 0) return false;
    useConsistencySheetStore
      .getState()
      .setParams((current) => ({ ...current, ...patch }));
    return true;
  },
});
