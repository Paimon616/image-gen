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

// One list field (outfits / backgrounds / situations) merged out of whatever the
// answer sent for it. Four forms, none of which can silently wipe the record:
//
//   <field>Append   only the new items → appended (the fast, preferred form)
//   <field>         upsert by id, then by name → existing entries the answer did
//                   NOT mention are KEPT, and an empty field on a returned item
//                   keeps the stored text
//   <field>Remove   ids or names to delete
//   <field>Replace  true → the array really is the new complete list
//
// The upsert default matters: Paimon regularly answers "add one situation" with
// a one-item `situations` array, and a character's 100 saved situations must not
// disappear because of it. Wiping them takes the explicit Replace flag (or the
// studio's own 전체 삭제 button).
function mergeList<T extends { id: string; name: string; description: string; prompt: string }>(
  existing: T[],
  record: Record<string, unknown>,
  field: "outfits" | "backgrounds" | "situations",
  normalize: (value: unknown) => T[]
): T[] | null {
  const appendKey = `${field}Append`;
  const removeKey = `${field}Remove`;
  const replaceKey = `${field}Replace`;

  const hasFull = field in record;
  const hasAppend = appendKey in record;
  const hasRemove = removeKey in record;
  if (!hasFull && !hasAppend && !hasRemove) return null;

  if (hasFull && record[replaceKey] === true) {
    return normalize(record[field]);
  }

  let merged = [...existing];

  const upsert = (items: T[], appendOnly: boolean) => {
    for (const item of items) {
      const index = appendOnly
        ? -1
        : merged.findIndex(
            (entry) =>
              entry.id === item.id ||
              (Boolean(item.name.trim()) &&
                entry.name.trim().toLowerCase() === item.name.trim().toLowerCase())
          );
      if (index === -1) {
        merged.push(item);
        continue;
      }
      const current = merged[index];
      // An empty field on the returned item means "unchanged", not "cleared" —
      // the answer may have been written from a name-only listing.
      merged[index] = {
        ...current,
        ...item,
        id: current.id,
        name: item.name.trim() ? item.name : current.name,
        description: item.description.trim() ? item.description : current.description,
        prompt: item.prompt.trim() ? item.prompt : current.prompt,
      };
    }
  };

  if (hasFull) upsert(normalize(record[field]), false);
  if (hasAppend) upsert(normalize(record[appendKey]), true);

  if (hasRemove && Array.isArray(record[removeKey])) {
    const targets = (record[removeKey] as unknown[])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (targets.length > 0) {
      merged = merged.filter(
        (entry) =>
          !targets.includes(entry.id.toLowerCase()) &&
          !targets.includes(entry.name.trim().toLowerCase())
      );
    }
  }

  return merged;
}

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
  const outfits = mergeList(
    character.outfits,
    record,
    "outfits",
    normalizeOutfits
  );
  if (outfits) patch.outfits = outfits;

  const backgrounds = mergeList(
    character.backgrounds,
    record,
    "backgrounds",
    normalizeBackgrounds
  );
  if (backgrounds) patch.backgrounds = backgrounds;

  // Situations reference outfits/backgrounds by id or name — resolve against the
  // merged set (patch overrides existing) so references resolve either way.
  const outfitsForRefs = patch.outfits ?? character.outfits;
  const backgroundsForRefs = patch.backgrounds ?? character.backgrounds;
  const situations = mergeList(character.situations, record, "situations", (value) =>
    normalizeSituations(value, outfitsForRefs, backgroundsForRefs)
  );
  if (situations) patch.situations = situations;

  return patch;
}

// What of the character actually rides along in the request. Two things are cut:
// the main image's generation metadata (this Paimon authors text, it never needs
// the baseline params) and the prompts of situations the message is not about —
// a 100-situation character was sending ~40KB of prompts the model had to read
// before writing anything. Names always stay, so it can still avoid duplicates
// and address an existing situation.
function characterPayload(character: Character, focusText: string) {
  const haystack = focusText.toLowerCase();
  const situations = character.situations.map((situation) => {
    const name = situation.name.trim();
    const mentioned =
      Boolean(name) && haystack.includes(name.toLowerCase());
    return mentioned
      ? situation
      : { id: situation.id, name: situation.name };
  });
  const omitted = situations.some((situation) => !("prompt" in situation));

  return {
    ...character,
    mainImage: character.mainImage
      ? { url: character.mainImage.url }
      : null,
    situations,
    // Marks the trim so an omitted prompt never reads as an empty situation.
    situationPromptsOmitted: omitted || undefined,
  };
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

// "상황 100개 만들어줘" is one request but several answers. A single answer that
// tries to write 100 items drifts into near-duplicates and can run past the
// token ceiling (which loses the whole turn), so the route caps each answer at
// 40 and the rest is fetched by continuing automatically — each round lands and
// is saved before the next one starts.
const MAX_BATCH_ROUNDS = 8;

interface BatchRun {
  target: number;
  got: number;
  rounds: number;
}

const batchRuns: Record<string, BatchRun> = {};

// How many situations the user asked for in this message, or 0 when it is not a
// counted batch request.
function requestedSituationCount(text: string) {
  if (!/상황|situation/i.test(text)) return 0;
  const match = text.match(/(\d{1,3})\s*개/) ?? text.match(/(\d{1,3})/);
  const value = match ? Number(match[1]) : 0;
  return Number.isFinite(value) && value > 1 ? Math.min(value, 300) : 0;
}

function lastUserMessage(conversationId: string) {
  const messages =
    useCharacterPaimonStore.getState().conversations[conversationId]?.messages ??
    [];
  return [...messages].reverse().find((message) => message.role === "user")
    ?.content ?? "";
}

// Sends the follow-up once the finished turn has released the conversation.
function continueBatch(conversationId: string, remaining: number, attempt = 0) {
  const store = useCharacterPaimonStore.getState();
  if (store.conversations[conversationId]?.loading) {
    if (attempt < 6) {
      window.setTimeout(
        () => continueBatch(conversationId, remaining, attempt + 1),
        400
      );
    }
    return;
  }
  store.send(
    conversationId,
    `이어서 상황 ${remaining}개 더 만들어줘. 기존 상황과 이름·동작·구도가 겹치지 않게.`
  );
}

export const useCharacterPaimonStore = createPaimonConversationStore({
  endpoint: "/api/paimon/character",
  historyLimit: 10,
  appliedReply: () => "요청을 반영해서 캐릭터 설정을 수정했어요.",
  // Cancelling a round of a counted batch ("상황 N개") must also end the
  // auto-continuation, or the next completed turn would resume it.
  onCancel: (conversationId) => {
    delete batchRuns[conversationId];
  },
  buildBody: ({ conversationId, messages, attachments }) => ({
    character: characterSnapshots[conversationId]
      ? characterPayload(
          characterSnapshots[conversationId],
          messages[messages.length - 1]?.content ?? ""
        )
      : null,
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

    // Batch bookkeeping: how many situations this round actually added, and
    // whether the counted request the user made is still short.
    const added = patch.situations
      ? patch.situations.length - character.situations.length
      : 0;
    const run =
      batchRuns[conversationId] ??
      ({
        target: requestedSituationCount(lastUserMessage(conversationId)),
        got: 0,
        rounds: 0,
      } satisfies BatchRun);
    run.got += Math.max(0, added);
    run.rounds += 1;
    const remaining = run.target - run.got;
    // added <= 0 means the model has nothing new to give; stop instead of
    // looping on an answer that never grows the list.
    if (run.target > 0 && remaining > 0 && added > 0 && run.rounds < MAX_BATCH_ROUNDS) {
      batchRuns[conversationId] = run;
      continueBatch(conversationId, remaining);
    } else {
      delete batchRuns[conversationId];
    }

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
