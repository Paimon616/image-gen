"use client";

import { useCallback, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  loadSituationImages,
  loadSituationLibrary,
  type SituationLibraryCharacter,
  type SituationLibraryEntry,
} from "@/lib/character-situations";
import type { GeneratedImage } from "@/lib/types";

export interface SituationRunRequest {
  character: SituationLibraryCharacter;
  // Empty = 기본 모습 (no situation). More than one = sequential batch.
  situations: SituationLibraryEntry[];
  seconds: number;
  autoGenerate: boolean;
  // situation id -> start-frame image URL (the newest image, or the thumbnail
  // the user clicked).
  imageBySituation: Record<string, string>;
}

interface CharacterSituationPickerProps {
  language: "ko" | "en";
  // Current clip length of the surface; the seconds field starts here.
  defaultSeconds: number;
  minSeconds?: number;
  maxSeconds?: number;
  // Short note under the seconds field (e.g. the resulting frame count).
  secondsHint?: string;
  disabled?: boolean;
  // A batch is already running, so a new run must not start.
  batchRunning?: boolean;
  onRun: (request: SituationRunRequest) => void;
}

const T = {
  button: { ko: "캐릭터", en: "Character" },
  title: { ko: "저장된 캐릭터·상황 불러오기", en: "Load a saved character/situation" },
  loading: { ko: "불러오는 중", en: "Loading" },
  none: {
    ko: "저장된 캐릭터가 없어요. 먼저 캐릭터 생성에서 만들어 주세요.",
    en: "No saved characters yet. Create one in Character Creation first.",
  },
  situationCount: { ko: "상황", en: "situations" },
  base: { ko: "기본", en: "Base" },
  pickSituation: { ko: "상황 선택", en: "Pick a situation" },
  backToList: { ko: "캐릭터 목록으로", en: "Back to characters" },
  autoGenerate: { ko: "자동 생성", en: "Auto-generate" },
  multi: { ko: "여러 개", en: "Multiple" },
  seconds: { ko: "길이(초)", en: "Length (s)" },
  selectAll: { ko: "상황 모두 선택", en: "Select all" },
  selectUngenerated: { ko: "미생성 모두 선택", en: "Select ungenerated" },
  ungeneratedTitle: {
    ko: "아직 이미지가 없는 상황만 선택",
    en: "Select only situations with no image",
  },
  clear: { ko: "선택 해제", en: "Clear" },
  noSituation: { ko: "상황 없이 (기본 모습)", en: "No situation (base look)" },
  ungenerated: { ko: "이미지 없음", en: "No image" },
  runBatch: { ko: "개 순차 생성", en: " selected, run in order" },
  useAsStart: { ko: "시작 프레임으로 사용", en: "Use as start frame" },
  noName: { ko: "이름 없음", en: "Untitled" },
} as const;

function tr(key: keyof typeof T, language: "ko" | "en") {
  return T[key][language];
}

/**
 * The character/situation picker for the video surfaces' Paimon chat, mirroring
 * the image generator's picker: browse saved characters, see the images already
 * generated per situation, then either compose one situation or check several and
 * run them one after another. What it hands back is only the selection — the
 * caller decides what to do with it (set a start frame, ask Paimon for a video
 * prompt, queue a generation).
 */
export function CharacterSituationPicker({
  language,
  defaultSeconds,
  minSeconds = 1,
  maxSeconds = 60,
  secondsHint,
  disabled = false,
  batchRunning = false,
  onRun,
}: CharacterSituationPickerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [characters, setCharacters] = useState<
    SituationLibraryCharacter[] | null
  >(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [seconds, setSeconds] = useState(defaultSeconds);
  // Generated images per situation id for the open character, newest first.
  const [images, setImages] = useState<Record<string, GeneratedImage[]>>({});
  const [imagesLoading, setImagesLoading] = useState(false);
  // Explicit per-situation start-frame choice; without one the newest image wins.
  const [chosenImages, setChosenImages] = useState<Record<string, string>>({});

  const close = useCallback(() => {
    setOpen(false);
    setActiveId(null);
  }, []);

  const toggleOpen = useCallback(async () => {
    if (open) {
      close();
      return;
    }
    setOpen(true);
    setActiveId(null);
    setMultiSelect(false);
    setSelectedIds(new Set());
    setChosenImages({});
    setSeconds(Math.max(minSeconds, Math.min(maxSeconds, defaultSeconds)));
    setLoading(true);
    try {
      setCharacters(await loadSituationLibrary());
    } catch {
      setCharacters([]);
    } finally {
      setLoading(false);
    }
  }, [close, defaultSeconds, maxSeconds, minSeconds, open]);

  const openCharacter = useCallback(async (character: SituationLibraryCharacter) => {
    setActiveId(character.id);
    setSelectedIds(new Set());
    setChosenImages({});
    setImages({});
    setImagesLoading(true);
    try {
      setImages(await loadSituationImages(character.id));
    } catch {
      setImages({});
    } finally {
      setImagesLoading(false);
    }
  }, []);

  // The start frame for each situation in this run: the clicked thumbnail if
  // there is one, else the newest image the situation has.
  const imageMap = useCallback(
    (situations: SituationLibraryEntry[]) => {
      const map: Record<string, string> = {};
      for (const situation of situations) {
        const url =
          chosenImages[situation.id] ?? images[situation.id]?.[0]?.url ?? "";
        if (url) map[situation.id] = url;
      }
      return map;
    },
    [chosenImages, images]
  );

  const run = useCallback(
    (
      character: SituationLibraryCharacter,
      situations: SituationLibraryEntry[],
      forceGenerate = false
    ) => {
      close();
      setSelectedIds(new Set());
      onRun({
        character,
        situations,
        seconds,
        autoGenerate: forceGenerate || autoGenerate,
        imageBySituation: imageMap(situations),
      });
    },
    [autoGenerate, close, imageMap, onRun, seconds]
  );

  const toggleSelected = useCallback((situationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(situationId)) next.delete(situationId);
      else next.add(situationId);
      return next;
    });
  }, []);

  // Bulk pickers both switch multi-select on so the checked rows and the run
  // button appear right away.
  const selectMany = useCallback((situationIds: string[]) => {
    setMultiSelect(true);
    setSelectedIds(new Set(situationIds));
  }, []);

  const active = characters?.find((character) => character.id === activeId) ?? null;

  return (
    <div className="relative mb-2 flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 px-2.5 text-xs"
        onClick={() => void toggleOpen()}
        disabled={disabled}
        aria-expanded={open}
        title={tr("title", language)}
      >
        <UsersRound className="size-3.5" />
        {tr("button", language)}
      </Button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            aria-hidden
            tabIndex={-1}
            onClick={close}
          />
          <div className="absolute bottom-full left-0 z-20 mb-2 max-h-80 w-[min(22rem,calc(100vw-3rem))] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
            {loading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {tr("loading", language)}
              </div>
            ) : !characters || characters.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                {tr("none", language)}
              </p>
            ) : !active ? (
              <ul className="space-y-0.5">
                {characters.map((character) => (
                  <li key={character.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => {
                        if (character.situations.length === 0) run(character, []);
                        else void openCharacter(character);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {character.name || tr("noName", language)}
                        </span>
                        {character.summary && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {character.summary}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                        {character.situations.length > 0
                          ? `${tr("situationCount", language)} ${character.situations.length}`
                          : tr("base", language)}
                        <ChevronRight className="size-3.5" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              (() => {
                const selectedSituations = active.situations.filter((situation) =>
                  selectedIds.has(situation.id)
                );
                // "Ungenerated" = no image has ever been saved for that
                // situation, so it has no start frame to animate yet.
                const ungeneratedIds = active.situations
                  .filter(
                    (situation) => (images[situation.id] ?? []).length === 0
                  )
                  .map((situation) => situation.id);

                return (
                  <div>
                    <div className="flex items-center gap-1 border-b border-border px-1 pb-1">
                      <button
                        type="button"
                        className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        onClick={() => setActiveId(null)}
                        aria-label={tr("backToList", language)}
                      >
                        <ArrowLeft className="size-3.5" />
                      </button>
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {active.name} · {tr("pickSituation", language)}
                      </span>
                    </div>

                    {/* Clip length + auto-generate / multi-select toggles */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {tr("seconds", language)}
                        <input
                          type="number"
                          min={minSeconds}
                          max={maxSeconds}
                          step={1}
                          value={seconds}
                          onChange={(event) => {
                            const next = Number(event.target.value);
                            if (!Number.isFinite(next)) return;
                            setSeconds(
                              Math.max(minSeconds, Math.min(maxSeconds, Math.round(next)))
                            );
                          }}
                          className="h-6 w-14 rounded border border-border bg-background px-1.5 text-[11px] text-foreground"
                        />
                      </label>
                      <div className="flex items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-primary"
                            checked={autoGenerate}
                            onChange={(event) => setAutoGenerate(event.target.checked)}
                          />
                          {tr("autoGenerate", language)}
                        </label>
                        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                          <input
                            type="checkbox"
                            className="size-3.5 accent-primary"
                            checked={multiSelect}
                            onChange={(event) => {
                              setMultiSelect(event.target.checked);
                              setSelectedIds(new Set());
                            }}
                          />
                          {tr("multi", language)}
                        </label>
                      </div>
                    </div>
                    {secondsHint && (
                      <p className="px-1 pb-1.5 text-[10px] text-muted-foreground">
                        {secondsHint}
                      </p>
                    )}

                    {/* Bulk selection — both turn multi-select on. */}
                    <div className="flex flex-wrap items-center gap-1 border-b border-border px-1 pb-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={active.situations.length === 0}
                        onClick={() =>
                          selectMany(active.situations.map((situation) => situation.id))
                        }
                      >
                        {tr("selectAll", language)} ({active.situations.length})
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-[11px]"
                        disabled={imagesLoading || ungeneratedIds.length === 0}
                        onClick={() => selectMany(ungeneratedIds)}
                        title={tr("ungeneratedTitle", language)}
                      >
                        {imagesLoading ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          `${tr("selectUngenerated", language)} (${ungeneratedIds.length})`
                        )}
                      </Button>
                      {selectedSituations.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] text-muted-foreground"
                          onClick={() => setSelectedIds(new Set())}
                        >
                          {tr("clear", language)}
                        </Button>
                      )}
                    </div>

                    <ul className="mt-0.5 space-y-0.5">
                      {!multiSelect && (
                        <li>
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                            onClick={() => run(active, [])}
                          >
                            {tr("noSituation", language)}
                          </button>
                        </li>
                      )}
                      {active.situations.map((situation) => {
                        const meta = [situation.outfitName, situation.backgroundName]
                          .filter(Boolean)
                          .join(" · ");
                        const thumbs = images[situation.id] ?? [];
                        const chosen = chosenImages[situation.id] ?? thumbs[0]?.url;
                        const checked = selectedIds.has(situation.id);

                        return (
                          <li
                            key={situation.id}
                            className="rounded-md px-1 py-1 hover:bg-accent/50"
                          >
                            <div className="flex items-center gap-2">
                              {multiSelect && (
                                <input
                                  type="checkbox"
                                  className="size-3.5 shrink-0 accent-primary"
                                  checked={checked}
                                  onChange={() => toggleSelected(situation.id)}
                                  aria-label={situation.name}
                                />
                              )}
                              <button
                                type="button"
                                className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left text-sm hover:text-accent-foreground"
                                onClick={() => {
                                  if (multiSelect) toggleSelected(situation.id);
                                  else run(active, [situation]);
                                }}
                              >
                                <span className="block truncate">
                                  {situation.name || tr("noName", language)}
                                </span>
                                {meta && (
                                  <span className="block truncate text-[11px] text-muted-foreground">
                                    {meta}
                                  </span>
                                )}
                              </button>
                              {thumbs.length === 0 && (
                                <span className="shrink-0 rounded bg-secondary px-1 py-0.5 text-[10px] text-muted-foreground">
                                  {tr("ungenerated", language)}
                                </span>
                              )}
                            </div>
                            {thumbs.length > 0 && (
                              <div className="mt-1 flex gap-1 overflow-x-auto pl-1">
                                {thumbs.map((image) => (
                                  <button
                                    key={image.id}
                                    type="button"
                                    className={`size-12 shrink-0 overflow-hidden rounded border bg-muted ${
                                      chosen === image.url
                                        ? "border-primary ring-1 ring-primary"
                                        : "border-border"
                                    }`}
                                    onClick={() =>
                                      setChosenImages((current) => ({
                                        ...current,
                                        [situation.id]: image.url,
                                      }))
                                    }
                                    title={tr("useAsStart", language)}
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={image.thumbnailUrl || image.url}
                                      alt={situation.name}
                                      className="h-full w-full object-cover"
                                    />
                                  </button>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    {multiSelect && (
                      <div className="mt-1 border-t border-border px-1 pt-2">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 w-full text-xs"
                          disabled={selectedSituations.length === 0 || batchRunning}
                          onClick={() => run(active, selectedSituations, true)}
                        >
                          {language === "ko"
                            ? `선택 ${selectedSituations.length}${tr("runBatch", language)}`
                            : `${selectedSituations.length}${tr("runBatch", language)}`}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })()
            )}
          </div>
        </>
      )}
    </div>
  );
}
