import { readImageUrlAsJpegDataUrl } from "./image-resize";
import {
  SEEDANCE_DURATION_MAX,
  SEEDANCE_DURATION_MIN,
} from "./seedance";
import { createSituationVideoStore } from "./situation-video-store";
import { useSeedancePaimonStore } from "./seedance-paimon-store";
import { useSeedanceStore } from "./seedance-store";

// SeeDance's situation runner. ModelArk fetches nothing from this machine, so a
// situation image has to be inlined as a data URI (mirroring what the screen's
// own drop zone does) before it can serve as the start frame.
export const useSeedanceSituationStore = createSituationVideoStore({
  paimon: useSeedancePaimonStore,
  // SeeDance has no negative prompt; unwanted content is phrased inside the
  // prompt itself.
  withNegativePrompt: false,

  hasStartFrame: () => Boolean(useSeedanceStore.getState().params.firstFrame),

  applyStartFrame: async (imageUrl) => {
    const dataUrl = await readImageUrlAsJpegDataUrl(imageUrl);
    useSeedanceStore.getState().setParams((current) => ({
      ...current,
      // A start frame only means anything in image-to-video mode.
      mode: "i2v",
      firstFrame: dataUrl,
      // The old clip's end frame would fight the new situation's start frame.
      lastFrame: null,
    }));
    return true;
  },

  applyDuration: (seconds) => {
    const duration = Math.min(
      SEEDANCE_DURATION_MAX,
      Math.max(SEEDANCE_DURATION_MIN, Math.round(seconds))
    );
    useSeedanceStore
      .getState()
      .setParams((current) => ({ ...current, duration }));
  },
});
