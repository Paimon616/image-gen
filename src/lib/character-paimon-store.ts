import {
  createPaimonConversationStore,
  runningConversationId,
} from "./paimon-conversation";
import type {
  Character,
  CharacterBackground,
  CharacterOutfit,
  CharacterSituation,
} from "./types";

function normalizeOutfits(value: unknown): CharacterOutfit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      prompt: typeof item.prompt === "string" ? item.prompt : "",
    }));
}

function normalizeBackgrounds(value: unknown): CharacterBackground[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      prompt: typeof item.prompt === "string" ? item.prompt : "",
    }));
}

// Paimon rarely knows the internal UUIDs, so a situation may reference an outfit/
// background by id OR by name (as outfitId/outfitName, backgroundId/
// backgroundName). Resolve any of those against the known list to a real id.
function resolveRef(
  item: Record<string, unknown>,
  idKey: string,
  nameKey: string,
  list: { id: string; name: string }[]
): string | null {
  const idValue = item[idKey];
  if (typeof idValue === "string" && list.some((entry) => entry.id === idValue)) {
    return idValue;
  }
  const candidates = [item[nameKey], idValue].filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && candidate.trim().length > 0
  );
  for (const candidate of candidates) {
    const match = list.find(
      (entry) => entry.name.trim().toLowerCase() === candidate.trim().toLowerCase()
    );
    if (match) return match.id;
  }
  return null;
}

function normalizeSituations(
  value: unknown,
  outfits: { id: string; name: string }[],
  backgrounds: { id: string; name: string }[]
): CharacterSituation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : crypto.randomUUID(),
      name: typeof item.name === "string" ? item.name : "",
      description: typeof item.description === "string" ? item.description : "",
      prompt: typeof item.prompt === "string" ? item.prompt : "",
      outfitId: resolveRef(item, "outfitId", "outfitName", outfits),
      backgroundId: resolveRef(item, "backgroundId", "backgroundName", backgrounds),
    }));
}

const STRING_KEYS: (keyof Character)[] = [
  "name",
  "summary",
  "synopsis",
  "appearanceDescription",
  "appearancePrompt",
];

// Keep only known character fields, coercing arrays through the normalizers so
// Paimon-authored outfits/backgrounds/situations always carry a client id.
// `character` supplies the existing outfits/backgrounds so a situation can be
// linked to them even when the patch doesn't re-send those arrays.
function sanitizePatch(value: unknown, character: Character): Partial<Character> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const patch: Partial<Character> = {};

  for (const key of STRING_KEYS) {
    if (typeof record[key] === "string") {
      (patch as Record<string, unknown>)[key] = record[key];
    }
  }
  if ("outfits" in record) patch.outfits = normalizeOutfits(record.outfits);
  if ("backgrounds" in record)
    patch.backgrounds = normalizeBackgrounds(record.backgrounds);

  // Situations reference outfits/backgrounds by id or name — resolve against the
  // merged set (patch overrides existing) so references resolve either way.
  const outfitsForRefs = patch.outfits ?? character.outfits;
  const backgroundsForRefs = patch.backgrounds ?? character.backgrounds;
  if ("situations" in record) {
    patch.situations = normalizeSituations(
      record.situations,
      outfitsForRefs,
      backgroundsForRefs
    );
  }

  return patch;
}

// Latest snapshot of every character the studio has shown, kept at module scope
// so a turn that is still running after the studio unmounts can still build its
// request and normalize the patch it gets back.
const characterSnapshots: Record<string, Character> = {};

// Set while the studio is mounted. When it is null (the user navigated away
// mid-answer) the patch is written straight to disk instead, and the studio
// picks it up from the server the next time it mounts.
let liveApplier: ((characterId: string, patch: Partial<Character>) => void) | null =
  null;

export function publishCharacterSnapshot(character: Character) {
  characterSnapshots[character.id] = character;
}

export function registerCharacterPatchApplier(
  applier: (characterId: string, patch: Partial<Character>) => void
) {
  liveApplier = applier;
  return () => {
    if (liveApplier === applier) liveApplier = null;
  };
}

export const useCharacterPaimonStore = createPaimonConversationStore({
  endpoint: "/api/paimon/character",
  historyLimit: 10,
  appliedReply: () => "요청을 반영해서 캐릭터 설정을 수정했어요.",
  buildBody: ({ conversationId, messages, attachments }) => ({
    character: characterSnapshots[conversationId] ?? null,
    attachments: attachments.map((attachment, index) => ({
      kind: attachment.kind,
      url: attachment.url,
      dataUrl: attachment.dataUrl,
      referenceId: `참조${index + 1}`,
    })),
    messages,
  }),
  applyDone: async (done, conversationId) => {
    const character = characterSnapshots[conversationId];
    if (!character) return false;

    const patch = sanitizePatch(done.characterPatch, character);
    if (Object.keys(patch).length === 0) return false;

    // Keep the snapshot current so a follow-up turn sees the applied edit even
    // while the studio is unmounted.
    characterSnapshots[conversationId] = { ...character, ...patch };

    if (liveApplier) {
      liveApplier(conversationId, patch);
      return true;
    }

    // No studio mounted: persist directly. The route merges partial patches, so
    // sending only the changed fields is safe.
    await fetch(`/api/characters/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => {});
    return true;
  },
});

// Id of the character whose Paimon answer is still being written — the most
// recent one when several are running. The studio uses it to open that
// character (and its chat) when the user comes back mid-answer.
export function getRunningCharacterId() {
  return runningConversationId(useCharacterPaimonStore);
}
