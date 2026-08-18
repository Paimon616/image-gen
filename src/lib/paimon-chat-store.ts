import { create } from "zustand";
import { useStore } from "./store";
import { useGenerationQueueStore } from "./generation-queue-store";
import type { Character, GeneratedImage, GenerationParams } from "./types";

export type PaimonChatRole = "user" | "assistant";

export interface PaimonChatMessage {
  id: string;
  role: PaimonChatRole;
  content: string;
}

export interface PaimonAttachment {
  id: string;
  kind: "clipboard_image" | "gallery_image";
  label: string;
  url?: string;
  dataUrl?: string;
  metadata?: Partial<GeneratedImage>;
}

export interface PaimonModelAsset {
  path: string;
  name: string;
  version?: string;
  base_model?: string;
  tags?: string[];
}

export interface PaimonModelContext {
  currentCheckpoint?: PaimonModelAsset;
  compatibleLoras: PaimonModelAsset[];
  checkpoints: PaimonModelAsset[];
}

export interface PaimonCharacter {
  id: string;
  name: string;
  summary: string;
  appearancePrompt: string;
  outfits: { name: string; prompt: string }[];
  backgrounds: { name: string; prompt: string }[];
  situations: {
    id: string;
    name: string;
    prompt: string;
    outfitName?: string;
    backgroundName?: string;
  }[];
}

export const PAIMON_INTRO_MESSAGE: PaimonChatMessage = {
  id: "intro",
  role: "assistant",
  content:
    "파이몬이에요. 현재 입력값과 참조 이미지를 읽고 이미지·영상 프롬프트, 모델 설정, LoRA, 업스케일을 바로 고쳐드릴게요.",
};

const EDITABLE_PARAM_KEYS = new Set<keyof GenerationParams>([
  "backend",
  "model",
  "model_name",
  "prompt",
  "negative_prompt",
  "num_inference_steps",
  "guidance_scale",
  "width",
  "height",
  "num_images",
  "output_format",
  "generation_mode",
  "seed",
  "sampler_name",
  "scheduler",
  "clip_skip",
  "vae_name",
  "upscale_model_name",
  "hires_upscale",
  "hires_steps",
  "hires_denoise",
  "img2img_resize",
  "adetailer_enabled",
  "adetailer_model",
  "adetailer_checkpoint",
  "adetailer_prompt",
  "adetailer_negative_prompt",
  "adetailer_use_steps",
  "adetailer_steps",
  "adetailer_confidence",
  "adetailer_mask_blur",
  "adetailer_noise_multiplier",
  "adetailer_inpaint_only_masked",
  "adetailer_loras",
  "adetailer_denoise",
  "loras",
  "embeddings",
  "controlnets",
  "prompt_weighting",
  "style_image",
  "character_image",
  "source_image",
  "denoise_strength",
  "pose_reference_image",
  "pose_reference_model",
  "pose_reference_strength",
  "enable_safety_checker",
]);

function sanitizePatch(value: unknown): Partial<GenerationParams> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const patch: Partial<GenerationParams> = {};

  Object.entries(value).forEach(([key, nextValue]) => {
    if (EDITABLE_PARAM_KEYS.has(key as keyof GenerationParams)) {
      (patch as Record<string, unknown>)[key] = nextValue;
    }
  });

  return patch;
}

function compactAsset(asset: unknown): PaimonModelAsset | null {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    return null;
  }

  const record = asset as Record<string, unknown>;
  if (typeof record.path !== "string" || typeof record.name !== "string") {
    return null;
  }

  return {
    path: record.path,
    name: record.name,
    version: typeof record.version === "string" ? record.version : "",
    base_model: typeof record.base_model === "string" ? record.base_model : "",
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function isPaimonModelAsset(
  asset: PaimonModelAsset | null
): asset is PaimonModelAsset {
  return Boolean(asset);
}

function normalizeFamily(value: string | undefined) {
  const lower = (value ?? "").toLowerCase();

  if (/pony|pdxl/.test(lower)) return "pony";
  if (/illustrious|ilxl/.test(lower)) return "illustrious";
  if (/noob/.test(lower)) return "noobai";
  if (/anima/.test(lower)) return "anima";
  if (/flux/.test(lower)) return "flux";
  if (/krea/.test(lower)) return "krea";
  if (/sdxl|xl/.test(lower)) return "sdxl";
  if (/sd\s*1\.?5|sd15|1\.5/.test(lower)) return "sd15";

  return lower.trim();
}

function sameFamily(left: string | undefined, right: string | undefined) {
  const leftFamily = normalizeFamily(left);
  const rightFamily = normalizeFamily(right);

  if (!leftFamily || !rightFamily) return false;
  if (leftFamily === rightFamily) return true;

  return (
    (leftFamily === "illustrious" && rightFamily === "noobai") ||
    (leftFamily === "noobai" && rightFamily === "illustrious")
  );
}

async function loadModelContext(
  params: GenerationParams
): Promise<PaimonModelContext> {
  try {
    const res = await fetch("/api/models", { cache: "no-store" });
    const data = await res.json();
    const checkpointAssets: unknown[] = Array.isArray(data.checkpointAssets)
      ? data.checkpointAssets
      : [];
    const loraAssets: unknown[] = Array.isArray(data.loraAssets)
      ? data.loraAssets
      : [];
    const checkpoints = checkpointAssets
      .map(compactAsset)
      .filter(isPaimonModelAsset);
    const loras = loraAssets.map(compactAsset).filter(isPaimonModelAsset);
    const currentCheckpoint = checkpoints.find(
      (asset) => asset.path === params.model_name
    );
    const currentFamily =
      currentCheckpoint?.base_model ||
      currentCheckpoint?.path ||
      params.model_name;
    const compatibleLoras = loras
      .filter((asset) => sameFamily(currentFamily, asset.base_model || asset.path))
      .slice(0, 40);

    return {
      currentCheckpoint,
      compatibleLoras,
      checkpoints: checkpoints.slice(0, 80),
    };
  } catch {
    return {
      compatibleLoras: [],
      checkpoints: [],
    };
  }
}

// Loads the user's saved characters as a compact library so Paimon can compose a
// character's identity + outfit + background + situation into the prompt. Only
// prompt-bearing fields are sent; failures degrade to an empty library.
export async function loadCharacterLibrary(): Promise<PaimonCharacter[]> {
  try {
    const res = await fetch("/api/characters", { cache: "no-store" });
    const data = (await res.json()) as { characters?: Character[] };
    return (data.characters ?? [])
      .filter(
        (character) =>
          character.appearancePrompt.trim() ||
          character.backgrounds.some((background) => background.prompt.trim()) ||
          character.outfits.some((outfit) => outfit.prompt.trim()) ||
          character.situations.some((situation) => situation.prompt.trim())
      )
      .slice(0, 30)
      .map((character) => {
        // Resolve each situation's outfit/background id to a name so Paimon can
        // pair them without knowing the internal ids.
        const outfitNameById = new Map(
          character.outfits.map((outfit) => [outfit.id, outfit.name])
        );
        const backgroundNameById = new Map(
          character.backgrounds.map((background) => [
            background.id,
            background.name,
          ])
        );
        return {
          id: character.id,
          name: character.name,
          summary: character.summary,
          appearancePrompt: character.appearancePrompt,
          outfits: character.outfits
            .filter((outfit) => outfit.prompt.trim())
            .map((outfit) => ({ name: outfit.name, prompt: outfit.prompt })),
          backgrounds: character.backgrounds
            .filter((background) => background.prompt.trim())
            .map((background) => ({
              name: background.name,
              prompt: background.prompt,
            })),
          situations: character.situations
            .filter((situation) => situation.prompt.trim())
            .map((situation) => ({
              id: situation.id,
              name: situation.name,
              prompt: situation.prompt,
              outfitName: situation.outfitId
                ? outfitNameById.get(situation.outfitId)
                : undefined,
              backgroundName: situation.backgroundId
                ? backgroundNameById.get(situation.backgroundId)
                : undefined,
            })),
        };
      });
  } catch {
    return [];
  }
}

function buildInstruction(characterName: string, situationName?: string) {
  return situationName
    ? `저장된 캐릭터 '${characterName}'를 '${situationName}' 상황으로 만들어줘. 지금 설정된 모델·네거티브·이미지 크기는 그대로 두고, 그 상황의 의상·배경·상황 프롬프트를 캐릭터 정체성과 합쳐서 현재 모델에 맞게 프롬프트에 적용해줘.`
    : `저장된 캐릭터 '${characterName}'로 만들어줘. 지금 설정된 모델·네거티브·이미지 크기는 그대로 두고, 현재 모델에 맞게 프롬프트를 구성해줘.`;
}

export interface PaimonBatchProgress {
  done: number;
  total: number;
  current: string;
}

interface PaimonChatState {
  messages: PaimonChatMessage[];
  loading: boolean;
  status: string;
  error: string;
  // Non-null while a multi-situation run is composing + queueing. Lives here
  // (not in the panel) so the run keeps going after the page unmounts.
  batch: PaimonBatchProgress | null;

  setError: (error: string) => void;
  setLoading: (loading: boolean) => void;
  pushAssistantMessage: (content: string) => void;
  reset: () => void;
  // One Paimon turn. Resolves to the sanitized params patch, or null when the
  // turn failed, so callers can compose + generate off the result.
  runTurn: (
    content: string,
    attachments: PaimonAttachment[]
  ) => Promise<Partial<GenerationParams> | null>;
  sendMessage: (content: string, attachments: PaimonAttachment[]) => void;
  composeSituation: (
    character: PaimonCharacter,
    situationId: string | undefined,
    generate: boolean,
    attachments: PaimonAttachment[]
  ) => Promise<boolean>;
  runBatch: (
    character: PaimonCharacter,
    situationIds: string[],
    attachments: PaimonAttachment[]
  ) => Promise<void>;
  cancelBatch: () => void;
}

// Module scope so the flag survives the panel unmounting mid-batch.
let batchCancelled = false;

export const usePaimonChatStore = create<PaimonChatState>((set, get) => ({
  messages: [PAIMON_INTRO_MESSAGE],
  loading: false,
  status: "",
  error: "",
  batch: null,

  setError: (error) => set({ error }),
  setLoading: (loading) => set({ loading }),

  pushAssistantMessage: (content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { id: crypto.randomUUID(), role: "assistant", content },
      ],
    })),

  reset: () => set({ messages: [PAIMON_INTRO_MESSAGE], error: "" }),

  runTurn: async (content, attachments) => {
    const trimmed = content.trim();
    if (!trimmed) return null;

    const params = useStore.getState().params;
    const userMessage: PaimonChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const compactMessages = get()
      .messages.filter((message) => message.id !== "intro")
      .slice(-10)
      .map(({ role, content: text }) => ({ role, content: text }));

    set((state) => ({
      messages: [...state.messages, userMessage],
      loading: true,
      status: "",
      error: "",
    }));

    const assistantId = crypto.randomUUID();
    let placeholderAdded = false;
    const ensurePlaceholder = () => {
      if (placeholderAdded) return;
      placeholderAdded = true;
      set((state) => ({
        messages: [
          ...state.messages,
          { id: assistantId, role: "assistant", content: "" },
        ],
      }));
    };
    const appendToAssistant = (text: string) => {
      ensurePlaceholder();
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + text }
            : message
        ),
      }));
    };
    const setAssistantContent = (text: string) => {
      ensurePlaceholder();
      set((state) => ({
        messages: state.messages.map((message) =>
          message.id === assistantId ? { ...message, content: text } : message
        ),
      }));
    };

    try {
      const [modelContext, characterLibrary] = await Promise.all([
        loadModelContext(params),
        loadCharacterLibrary(),
      ]);
      const res = await fetch("/api/paimon/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentParams: params,
          modelContext,
          characterLibrary,
          attachments: attachments.map((attachment, index) => ({
            ...attachment,
            referenceId: `참조${index + 1}`,
          })),
          messages: [...compactMessages, userMessage].map(
            ({ role, content: text }) => ({ role, content: text })
          ),
        }),
      });

      const contentType = res.headers.get("Content-Type") ?? "";

      // Non-streaming error responses (missing key, upstream failure) come back
      // as JSON.
      if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "파이몬 호출에 실패했습니다.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";
      let done: {
        reply?: string;
        paramsPatch?: unknown;
        attachmentNotice?: string;
      } | null = null;
      let streamError = "";

      while (true) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue;

          const eventLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("event:"));
          const dataLine = rawEvent
            .split("\n")
            .find((line) => line.startsWith("data:"));
          const event = eventLine?.slice("event:".length).trim() ?? "message";
          const payload = dataLine
            ? JSON.parse(dataLine.slice("data:".length).trim())
            : null;

          if (event === "status" && typeof payload?.message === "string") {
            set({ status: payload.message });
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

      const patch = sanitizePatch(done?.paramsPatch);
      const applied = Object.keys(patch).length > 0;
      if (applied) {
        useStore.getState().setParams(patch);
      }

      const finalContent =
        done?.reply ||
        streamedText ||
        done?.attachmentNotice ||
        (applied
          ? "요청을 반영해서 현재 생성 정보를 수정했어요."
          : "이번에는 반영할 내용을 만들지 못했어요. 조금 더 구체적으로 다시 요청해 주세요.");
      setAssistantContent(finalContent);
      return patch;
    } catch (err) {
      // Drop an empty placeholder so a failed turn doesn't leave a blank bubble.
      if (placeholderAdded) {
        set((state) => ({
          messages: state.messages.filter(
            (message) => !(message.id === assistantId && message.content === "")
          ),
        }));
      }
      set({ error: err instanceof Error ? err.message : "파이몬 오류" });
      return null;
    } finally {
      set({ loading: false, status: "" });
    }
  },

  sendMessage: (content, attachments) => {
    if (get().loading) return;
    void get().runTurn(content, attachments);
  },

  // Composes one character/situation into the prompt (via a Paimon turn) and,
  // when `generate` is set, enqueues it linked to that situation. Returns true
  // on a successful compose.
  composeSituation: async (character, situationId, generate, attachments) => {
    const situation =
      character.situations.find((item) => item.id === situationId) ?? null;
    const patch = await get().runTurn(
      buildInstruction(character.name, situation?.name),
      attachments
    );
    if (!patch) return false;

    const merged = { ...useStore.getState().params, ...patch };
    const queue = useGenerationQueueStore.getState();
    queue.setCharacterContext({
      characterId: character.id,
      situationId: situation?.id,
      prompt: merged.prompt,
    });
    if (generate && merged.prompt.trim()) {
      await queue.enqueue(merged, {
        characterId: character.id,
        situationId: situation?.id,
      });
    }
    return true;
  },

  // Compose + queue each picked situation in order. Each one is prompted,
  // queued, then the next — until all are queued or the user cancels. The loop
  // runs outside React, so leaving the generator page never interrupts it.
  runBatch: async (character, situationIds, attachments) => {
    const chosen = character.situations.filter((situation) =>
      situationIds.includes(situation.id)
    );
    if (chosen.length === 0 || get().batch) return;

    batchCancelled = false;

    for (let i = 0; i < chosen.length; i += 1) {
      if (batchCancelled) break;
      set({
        batch: {
          done: i,
          total: chosen.length,
          current: chosen[i].name || "이름 없음",
        },
      });
      // Intentional serial await: compose+queue one situation before the next.
      await get().composeSituation(character, chosen[i].id, true, attachments);
    }

    set({ batch: null });
  },

  cancelBatch: () => {
    batchCancelled = true;
  },
}));
