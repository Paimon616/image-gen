import "server-only";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  createEmptyCharacter,
  type Character,
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
const MAX_SITUATIONS = 40;

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
    }));
}

function normalizeCharacter(raw: unknown): Character | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isValidCharacterId(record.id)) return null;

  return {
    id: record.id as string,
    name: normalizeCharacterName(record.name),
    summary: str(record.summary, MAX_SUMMARY_LENGTH),
    thumbnail: normalizeThumbnail(record.thumbnail),
    appearanceDescription: str(record.appearanceDescription, MAX_TEXT_LENGTH),
    appearancePrompt: str(record.appearancePrompt, MAX_TEXT_LENGTH),
    outfits: normalizeOutfits(record.outfits),
    backgroundDescription: str(record.backgroundDescription, MAX_TEXT_LENGTH),
    backgroundPrompt: str(record.backgroundPrompt, MAX_TEXT_LENGTH),
    situations: normalizeSituations(record.situations),
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
  return [...characters].sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCharacter(id: string): Promise<Character | null> {
  const { characters } = await readData();
  return characters.find((item) => item.id === id) ?? null;
}

export function createCharacter(name: string): Promise<Character> {
  const now = Date.now();
  const character: Character = {
    id: randomUUID(),
    ...createEmptyCharacter(name),
    createdAt: now,
    updatedAt: now,
  };

  return mutate((data) => ({
    data: { characters: [...data.characters, character] },
    result: character,
  }));
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
      backgroundDescription:
        "backgroundDescription" in record
          ? str(record.backgroundDescription, MAX_TEXT_LENGTH)
          : existing.backgroundDescription,
      backgroundPrompt:
        "backgroundPrompt" in record
          ? str(record.backgroundPrompt, MAX_TEXT_LENGTH)
          : existing.backgroundPrompt,
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
