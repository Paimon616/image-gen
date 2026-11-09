import {
  loadSituationLibrary,
  situationLibraryPayload,
} from "./character-situations";
import { createPaimonConversationStore } from "./paimon-conversation";
import { useSeedanceStore } from "./seedance-store";
import {
  clampSeedanceDuration,
  SEEDANCE_MODELS,
  SEEDANCE_RATIOS,
  SEEDANCE_RESOLUTIONS,
  type SeedanceParams,
} from "./seedance";

// Only the settings Paimon is allowed to touch. The frames themselves are data
// URIs — they go along as attachments, never as patchable params.
function sanitizeSeedancePatch(value: unknown): Partial<SeedanceParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const patch: Partial<SeedanceParams> = {};

  if (typeof record.prompt === "string") patch.prompt = record.prompt;
  if (record.mode === "i2v" || record.mode === "t2v") patch.mode = record.mode;
  const model = SEEDANCE_MODELS.find((m) => m.id === record.video_model);
  if (model) patch.model = model.id;
  if (
    typeof record.resolution === "string" &&
    (SEEDANCE_RESOLUTIONS as string[]).includes(record.resolution)
  ) {
    patch.resolution = record.resolution as SeedanceParams["resolution"];
  }
  if (
    typeof record.ratio === "string" &&
    (SEEDANCE_RATIOS as string[]).includes(record.ratio)
  ) {
    patch.ratio = record.ratio as SeedanceParams["ratio"];
  }
  // Clamped against the widest range here; the store re-clamps to whichever
  // model ends up selected once the patch is merged.
  if (typeof record.duration === "number" && Number.isFinite(record.duration)) {
    patch.duration = clampSeedanceDuration(record.duration);
  }
  for (const key of ["cameraFixed", "watermark", "cleanFrame"] as const) {
    if (typeof record[key] === "boolean") patch[key] = record[key];
  }
  if (record.seed === null) patch.seed = null;
  else if (typeof record.seed === "number" && Number.isFinite(record.seed)) {
    patch.seed = Math.trunc(record.seed);
  }

  return patch;
}

// A frame is either a data URI (pasted/uploaded) or a public URL; the chat route
// accepts both, but only one of the two fields per attachment.
function frameAttachment(frame: string, referenceId: string) {
  return frame.startsWith("data:")
    ? { kind: "gallery_image" as const, dataUrl: frame, referenceId }
    : { kind: "gallery_image" as const, url: frame, referenceId };
}

// SeeDance's Paimon. The transcript and the params it edits both live in
// module-level stores, so an answer still streaming when the user leaves the
// page finishes and lands on the params they come back to.
export const useSeedancePaimonStore = createPaimonConversationStore({
  endpoint: "/api/paimon/chat",
  appliedReply: () => "요청을 반영해서 SeeDance 설정을 수정했어요.",
  buildBody: async ({ messages, attachments }) => {
    const params = useSeedanceStore.getState().params;
    return {
      messages,
      // The saved characters, so a situation can be named in free-form chat too
      // (the situation picker also embeds the picked record in its instruction).
      characterLibrary: situationLibraryPayload(
        await loadSituationLibrary(),
        messages[messages.length - 1]?.content ?? ""
      ),
      // Image fields are stripped: multi-MB data URIs must not ride along as
      // params (they are sent as attachments below instead).
      currentParams: {
        video_model: params.model,
        mode: params.mode,
        prompt: params.prompt,
        resolution: params.resolution,
        ratio: params.ratio,
        duration: params.duration,
        cameraFixed: params.cameraFixed,
        watermark: params.watermark,
        cleanFrame: params.cleanFrame,
        seed: params.seed,
      },
      attachments: [
        ...(params.imageReference
          ? [frameAttachment(params.imageReference, "참조 이미지")]
          : []),
        // Named so Paimon writes a prompt that respects which sheet locks the
        // person and which one locks the location.
        ...(params.characterReference
          ? [frameAttachment(params.characterReference, "캐릭터 시트")]
          : []),
        ...(params.backgroundReference
          ? [frameAttachment(params.backgroundReference, "배경 시트")]
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
    const patch = sanitizeSeedancePatch(done.paramsPatch);
    if (Object.keys(patch).length === 0) return false;
    useSeedanceStore.getState().setParams((current) => ({ ...current, ...patch }));
    return true;
  },
});
