import "server-only";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  createEmptyCharacter,
  type Character,
  type CharacterBackground,
  type CharacterOutfit,
  type CharacterSituation,
} from "@/lib/types";

const DATA_DIR = join(process.cwd(), "data");
const CHARACTERS_FILE = join(DATA_DIR, "characters.json");

const MAX_NAME_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 200;
// Prompt/description fields can hold sizable narration; cap defensively so a
// runaway payload can't bloat the JSON file unbounded.
const MAX_TEXT_LENGTH = 8000;
const MAX_OUTFITS = 40;
const MAX_BACKGROUNDS = 40;
// Situations can be batch-generated from a synopsis (e.g. "make 80 situations"),
// so this cap is deliberately higher than outfits/backgrounds.
const MAX_SITUATIONS = 200;

interface CharactersData {
  characters: Character[];
}

// All mutations are serialized through this promise chain so concurrent
// create/patch/delete requests can't clobber each other's read-modify-write.
let writeChain: Promise<unknown> = Promise.resolve();

export function isValidCharacterId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

function str(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

export function normalizeCharacterName(value: unknown): string {
  return str(value, MAX_NAME_LENGTH).trim();
}

// Only accept app-served relative image URLs (or null). Blocks arbitrary
// remote/`javascript:` URLs from being persisted into a character record.
function normalizeThumbnail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/api/uploads/") || trimmed.startsWith("/api/images/")) {
    return trimmed.slice(0, 500);
  }
  return null;
}

function normalizeOutfits(value: unknown): CharacterOutfit[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .slice(0, MAX_OUTFITS)
    .map((item) => ({
      id: isValidCharacterId(item.id) ? (item.id as string) : randomUUID(),
      name: str(item.name, MAX_NAME_LENGTH).trim(),
      description: str(item.description, MAX_TEXT_LENGTH),
      prompt: str(item.prompt, MAX_TEXT_LENGTH),
    }));
}

function normalizeBackgrounds(value: unknown): CharacterBackground[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .slice(0, MAX_BACKGROUNDS)
    .map((item) => ({
      id: isValidCharacterId(item.id) ? (item.id as string) : randomUUID(),
      name: str(item.name, MAX_NAME_LENGTH).trim(),
      description: str(item.description, MAX_TEXT_LENGTH),
      prompt: str(item.prompt, MAX_TEXT_LENGTH),
    }));
}

// A situation's outfitId/backgroundId reference other records on the same
// character; keep only well-formed ids and default anything else to null so a
// dangling reference can't be persisted.
function normalizeRefId(value: unknown): string | null {
  return isValidCharacterId(value) ? (value as string) : null;
}

function normalizeSituations(value: unknown): CharacterSituation[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    )
    .slice(0, MAX_SITUATIONS)
    .map((item) => ({
      id: isValidCharacterId(item.id) ? (item.id as string) : randomUUID(),
      name: str(item.name, MAX_NAME_LENGTH).trim(),
      description: str(item.description, MAX_TEXT_LENGTH),
      prompt: str(item.prompt, MAX_TEXT_LENGTH),
      outfitId: normalizeRefId(item.outfitId),
      backgroundId: normalizeRefId(item.backgroundId),
    }));
}

// Older records stored a single background as backgroundDescription/
// backgroundPrompt. Fold those into the backgrounds[] list on read.
function legacyBackgrounds(record: Record<string, unknown>): unknown[] {
  const description = str(record.backgroundDescription, MAX_TEXT_LENGTH);
  const prompt = str(record.backgroundPrompt, MAX_TEXT_LENGTH);
  if (!description.trim() && !prompt.trim()) return [];
  return [{ name: "배경 1", description, prompt }];
}

function normalizeCharacter(raw: unknown): Character | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isValidCharacterId(record.id)) return null;

  return {
    id: record.id as string,
    name: normalizeCharacterName(record.name),
    summary: str(record.summary, MAX_SUMMARY_LENGTH),
    synopsis: str(record.synopsis, MAX_TEXT_LENGTH),
    thumbnail: normalizeThumbnail(record.thumbnail),
    appearanceDescription: str(record.appearanceDescription, MAX_TEXT_LENGTH),
    appearancePrompt: str(record.appearancePrompt, MAX_TEXT_LENGTH),
    outfits: normalizeOutfits(record.outfits),
    backgrounds: normalizeBackgrounds(
      Array.isArray(record.backgrounds)
        ? record.backgrounds
        : legacyBackgrounds(record)
    ),
    situations: normalizeSituations(record.situations),
    // Legacy records have no `order`; fall back to createdAt so their existing
    // relative order (the old sort key) is preserved on first read.
    order:
      typeof record.order === "number"
        ? record.order
        : typeof record.createdAt === "number"
          ? record.createdAt
          : Date.now(),
    createdAt:
      typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    updatedAt:
      typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
  };
}

function normalizeData(raw: unknown): CharactersData {
  if (!raw || typeof raw !== "object") return { characters: [] };
  const record = raw as Record<string, unknown>;
  const characters = Array.isArray(record.characters)
    ? record.characters
        .map(normalizeCharacter)
        .filter((item): item is Character => item !== null)
    : [];
  return { characters };
}

async function readData(): Promise<CharactersData> {
  try {
    const content = await readFile(CHARACTERS_FILE, "utf-8");
    return normalizeData(JSON.parse(content));
  } catch {
    return { characters: [] };
  }
}

async function writeData(data: CharactersData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CHARACTERS_FILE, JSON.stringify(data, null, 2));
}

function mutate<T>(
  updater: (data: CharactersData) => { data: CharactersData; result: T }
) {
  const next = writeChain.then(async () => {
    const current = await readData();
    const { data, result } = updater(current);
    await writeData(data);
    return result;
  });
  writeChain = next.catch(() => {});
  return next;
}

export async function listCharacters(): Promise<Character[]> {
  const { characters } = await readData();
  return [...characters].sort((a, b) => a.order - b.order);
}

export async function getCharacter(id: string): Promise<Character | null> {
  const { characters } = await readData();
  return characters.find((item) => item.id === id) ?? null;
}

export function createCharacter(name: string): Promise<Character> {
  const now = Date.now();
  return mutate((data) => {
    // Append after the current last item so new characters land at the bottom.
    const maxOrder = data.characters.reduce(
      (max, item) => Math.max(max, item.order),
      -1
    );
    const character: Character = {
      id: randomUUID(),
      ...createEmptyCharacter(name),
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    };
    return {
      data: { characters: [...data.characters, character] },
      result: character,
    };
  });
}

// Reassign `order` to match the given id sequence. Ids not present are ignored;
// any character missing from the list keeps its relative position at the end.
export function reorderCharacters(ids: unknown): Promise<Character[]> {
  const idList = Array.isArray(ids)
    ? ids.filter((id): id is string => isValidCharacterId(id))
    : [];
  const rank = new Map(idList.map((id, index) => [id, index]));
  return mutate((data) => {
    const sorted = [...data.characters].sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      // Stable fallback for un-ranked characters: keep their prior order.
      return a.order - b.order;
    });
    const reordered = sorted.map((item, index) => ({ ...item, order: index }));
    return { data: { characters: reordered }, result: reordered };
  });
}

// Partial merge (settings-style): only the fields present in `patch` are
// overwritten; id/createdAt are immutable and updatedAt is refreshed. Nested
// arrays (outfits/situations) are replaced wholesale when provided.
export function updateCharacter(
  id: string,
  patch: unknown
): Promise<Character | null> {
  return mutate((data) => {
    const existing = data.characters.find((item) => item.id === id);
    if (!existing) return { data, result: null };

    const record =
      patch && typeof patch === "object" && !Array.isArray(patch)
        ? (patch as Record<string, unknown>)
        : {};

    const merged: Character = {
      ...existing,
      name:
        "name" in record ? normalizeCharacterName(record.name) : existing.name,
      summary:
        "summary" in record
          ? str(record.summary, MAX_SUMMARY_LENGTH)
          : existing.summary,
      synopsis:
        "synopsis" in record
          ? str(record.synopsis, MAX_TEXT_LENGTH)
          : existing.synopsis,
      thumbnail:
        "thumbnail" in record
          ? normalizeThumbnail(record.thumbnail)
          : existing.thumbnail,
      appearanceDescription:
        "appearanceDescription" in record
          ? str(record.appearanceDescription, MAX_TEXT_LENGTH)
          : existing.appearanceDescription,
      appearancePrompt:
        "appearancePrompt" in record
          ? str(record.appearancePrompt, MAX_TEXT_LENGTH)
          : existing.appearancePrompt,
      outfits:
        "outfits" in record
          ? normalizeOutfits(record.outfits)
          : existing.outfits,
      backgrounds:
        "backgrounds" in record
          ? normalizeBackgrounds(record.backgrounds)
          : existing.backgrounds,
      situations:
        "situations" in record
          ? normalizeSituations(record.situations)
          : existing.situations,
      updatedAt: Date.now(),
    };

    return {
      data: {
        characters: data.characters.map((item) =>
          item.id === id ? merged : item
        ),
      },
      result: merged,
    };
  });
}

export function deleteCharacter(id: string): Promise<boolean> {
  return mutate((data) => {
    const exists = data.characters.some((item) => item.id === id);
    return {
      data: { characters: data.characters.filter((item) => item.id !== id) },
      result: exists,
    };
  });
}

// Writes a character record under the id it already carries, creating it when
// unknown and replacing it when it exists. Downloading a shared character reuses
// the sharer's id so a later re-download refreshes that same character instead
// of piling up copies.
export function upsertCharacter(raw: unknown): Promise<Character | null> {
  const incoming = normalizeCharacter(raw);
  if (!incoming) return Promise.resolve(null);

  return mutate((data) => {
    const existing = data.characters.find((item) => item.id === incoming.id);
    const maxOrder = data.characters.reduce(
      (max, item) => Math.max(max, item.order),
      -1
    );
    // Keep the local list position of a character that is being refreshed; a
    // newly downloaded one lands at the bottom.
    const merged: Character = {
      ...incoming,
      order: existing ? existing.order : maxOrder + 1,
      createdAt: existing ? existing.createdAt : incoming.createdAt,
      updatedAt: Date.now(),
    };

    return {
      data: {
        characters: existing
          ? data.characters.map((item) =>
              item.id === incoming.id ? merged : item
            )
          : [...data.characters, merged],
      },
      result: merged,
    };
  });
}

// Copies a character, giving the copy — and every outfit / background /
// situation inside it — fresh ids, with each situation's outfit/background
// reference remapped onto the copies. The copy is inserted directly after the
// original so it shows up next to what was duplicated.
export function duplicateCharacter(id: string): Promise<Character | null> {
  return mutate((data) => {
    const source = data.characters.find((item) => item.id === id);
    if (!source) return { data, result: null };

    const outfitIds = new Map(source.outfits.map((item) => [item.id, randomUUID()]));
    const backgroundIds = new Map(
      source.backgrounds.map((item) => [item.id, randomUUID()])
    );
    const now = Date.now();

    const copy: Character = {
      ...source,
      id: randomUUID(),
      name: normalizeCharacterName(`${source.name} 복사`),
      outfits: source.outfits.map((item) => ({
        ...item,
        id: outfitIds.get(item.id) ?? randomUUID(),
      })),
      backgrounds: source.backgrounds.map((item) => ({
        ...item,
        id: backgroundIds.get(item.id) ?? randomUUID(),
      })),
      situations: source.situations.map((item) => ({
        ...item,
        id: randomUUID(),
        outfitId: item.outfitId ? outfitIds.get(item.outfitId) ?? null : null,
        backgroundId: item.backgroundId
          ? backgroundIds.get(item.backgroundId) ?? null
          : null,
      })),
      order: source.order + 0.5,
      createdAt: now,
      updatedAt: now,
    };

    // Re-rank so the fractional order above collapses back to integers.
    const characters = [...data.characters, copy]
      .sort((a, b) => a.order - b.order)
      .map((item, index) => ({ ...item, order: index }));

    return {
      data: { characters },
      result: characters.find((item) => item.id === copy.id) ?? copy,
    };
  });
}
