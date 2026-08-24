import { create } from "zustand";
import {
  DEFAULT_CONVERSATION,
  type PaimonConversationStore,
} from "./paimon-conversation";
import {
  buildVideoSituationInstruction,
  type SituationLibraryCharacter,
  type SituationLibraryEntry,
} from "./character-situations";

// Turns a saved character situation into a video: the situation's own generated
// image becomes the start frame, the requested clip length is written into the
// surface's duration fields, and one Paimon turn composes the motion/expression/
// camera prompt from the situation's description, prompt, outfit and background.
// Several situations can be run one after another (the same "여러 장" flow the
// image generator has).

export interface SituationBatchProgress {
  done: number;
  total: number;
  current: string;
}

export interface SituationRunOptions {
  seconds: number;
  autoGenerate: boolean;
  // Situation id -> the image URL to use as the start frame (the newest one, or
  // whichever thumbnail the user clicked in the picker).
  imageBySituation?: Record<string, string>;
}

// Which character/situation a queued clip was composed from. Rides along with
// the generation request so the server tags the finished clip's sidecar and the
// video registers itself into that situation in the character studio.
export interface SituationVideoLink {
  characterId: string;
  situationId?: string;
}

export interface SituationVideoConfig {
  // The surface's Paimon chat; the composing turn runs through it, so the
  // instruction and answer show up in the transcript the user is looking at.
  paimon: PaimonConversationStore;
  // The surface has a negative_prompt field to patch as well.
  withNegativePrompt: boolean;
  hasStartFrame: () => boolean;
  // Installs `imageUrl` as the surface's start frame. Returns false when it
  // could not be prepared (e.g. the data-URI conversion SeeDance needs failed).
  applyStartFrame: (imageUrl: string) => Promise<boolean>;
  applyDuration: (seconds: number) => void | Promise<void>;
  // Queues one generation from whatever is in the params store right now.
  // Module-scope (backed by a global queue/stream, not the page), so an
  // auto-generate batch keeps going after the user navigates away. The link
  // names the character/situation this clip is being generated for, so the
  // finished video is registered to that situation.
  enqueue: (link: SituationVideoLink) => void;
  // The surface refuses to generate without a start frame (i2v pipeline / i2v
  // mode), so a situation with no saved image is composed but not generated.
  requiresStartFrame: () => boolean;
}

interface SituationVideoState {
  // Non-null while a multi-situation run is composing/queueing. Lives in the
  // store (not the panel) so the run survives the panel closing.
  batch: SituationBatchProgress | null;

  compose: (
    character: SituationLibraryCharacter,
    situation: SituationLibraryEntry | null,
    options: SituationRunOptions
  ) => Promise<boolean>;
  runBatch: (
    character: SituationLibraryCharacter,
    situations: SituationLibraryEntry[],
    options: SituationRunOptions
  ) => Promise<void>;
  cancelBatch: () => void;
}

export function createSituationVideoStore(config: SituationVideoConfig) {
  // Module scope so the flag survives the panel unmounting mid-batch.
  let batchCancelled = false;

  return create<SituationVideoState>((set, get) => ({
    batch: null,

    compose: async (character, situation, options) => {
      const paimon = config.paimon.getState();
      const imageUrl = situation
        ? options.imageBySituation?.[situation.id]
        : undefined;

      let startFrameFromSituation = false;
      if (imageUrl) {
        try {
          startFrameFromSituation = await config.applyStartFrame(imageUrl);
        } catch {
          startFrameFromSituation = false;
        }
        if (!startFrameFromSituation) {
          paimon.pushAssistantMessage(
            DEFAULT_CONVERSATION,
            `'${situation?.name || "이 상황"}'의 이미지를 시작 프레임으로 불러오지 못했어요. 프롬프트만 작성할게요.`
          );
        }
      }

      // Written before the turn so Paimon sees the target length in
      // currentParams, and again after it so a stray patch can't undo it.
      await config.applyDuration(options.seconds);

      const done = await config.paimon.getState().runTurn(
        DEFAULT_CONVERSATION,
        buildVideoSituationInstruction({
          character,
          situation,
          seconds: options.seconds,
          hasStartFrame: config.hasStartFrame(),
          startFrameFromSituation,
          withNegativePrompt: config.withNegativePrompt,
        })
      );
      if (!done) return false;

      await config.applyDuration(options.seconds);

      if (!options.autoGenerate) return true;

      if (config.requiresStartFrame() && !config.hasStartFrame()) {
        config.paimon
          .getState()
          .pushAssistantMessage(
            DEFAULT_CONVERSATION,
            "시작 프레임이 없어서 자동 생성은 건너뛰었어요. 이 상황의 이미지를 먼저 만들거나 시작 이미지를 직접 지정해주세요."
          );
        return true;
      }

      config.enqueue({
        characterId: character.id,
        situationId: situation?.id,
      });
      return true;
    },

    // Compose + queue each picked situation in order: one is prompted and
    // queued before the next starts, so the transcript stays readable and the
    // GPU queue is filled one clip at a time.
    runBatch: async (character, situations, options) => {
      if (situations.length === 0 || get().batch) return;

      batchCancelled = false;

      for (let index = 0; index < situations.length; index += 1) {
        if (batchCancelled) break;
        set({
          batch: {
            done: index,
            total: situations.length,
            current: situations[index].name || "이름 없음",
          },
        });
        // Intentional serial await: compose+queue one situation before the next.
        await get().compose(character, situations[index], options);
      }

      set({ batch: null });
    },

    cancelBatch: () => {
      batchCancelled = true;
    },
  }));
}

export type SituationVideoStore = ReturnType<typeof createSituationVideoStore>;
