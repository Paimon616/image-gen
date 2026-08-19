import { loadSituationLibrary } from "./character-situations";
import { createPaimonConversationStore } from "./paimon-conversation";
import { useVideoStore } from "./video-store";
import { DEFAULT_VIDEO_PARAMS, type VideoGenerationParams } from "./types";

const VIDEO_PARAM_KEYS = new Set(Object.keys(DEFAULT_VIDEO_PARAMS));

function sanitizeVideoParamsPatch(value: unknown): Partial<VideoGenerationParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const patch: Partial<VideoGenerationParams> = {};
  Object.entries(value).forEach(([key, nextValue]) => {
    if (VIDEO_PARAM_KEYS.has(key)) {
      (patch as Record<string, unknown>)[key] = nextValue;
    }
  });
  return patch;
}

// The video page's Paimon. Both the transcript and the params it edits live in
// module-level stores, so an answer that is still streaming when the user leaves
// the page finishes and still lands on the params they come back to.
export const useVideoPaimonStore = createPaimonConversationStore({
  endpoint: "/api/paimon/chat",
  appliedReply: () => "요청을 반영해서 비디오 설정을 수정했어요.",
  buildBody: async ({ messages, attachments }) => {
    const params = useVideoStore.getState().params;
    return {
      messages,
      currentParams: params,
      // The saved characters, so a situation can be named in free-form chat too
      // (the situation picker also embeds the picked record in its instruction).
      characterLibrary: await loadSituationLibrary(),
      // Let Paimon actually see the pixels of the start/reference image, not just
      // its URL: send it as the first visual attachment. Local /api/uploads and
      // /api/images URLs are inlined server-side by the chat route.
      attachments: [
        ...(params.source_image
          ? [
              {
                kind: "gallery_image" as const,
                url: params.source_image,
                referenceId: "시작 이미지",
              },
            ]
          : []),
        ...attachments.map((attachment, index) => ({
          kind: attachment.kind,
          url: attachment.url,
          dataUrl: attachment.dataUrl,
          referenceId: `참조${index + 1}`,
        })),
      ],
    };
  },
  applyDone: (done) => {
    const patch = sanitizeVideoParamsPatch(done.paramsPatch);
    if (Object.keys(patch).length === 0) return false;
    useVideoStore.getState().setParams((current) => ({ ...current, ...patch }));
    return true;
  },
});
