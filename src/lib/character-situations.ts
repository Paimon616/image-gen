import type { Character, GeneratedImage, GenerationParams } from "./types";

// The saved-character library as the VIDEO surfaces need it. The image
// generator's own loader (paimon-chat-store.ts) only forwards prompt text,
// because a booru prompt is all an image model consumes. A video prompt is
// written from the natural-language side of the record instead — the situation's
// 묘사, the outfit/background descriptions and the character's appearance
// description are what tell Paimon what should MOVE — so this loader keeps both.
export interface SituationLibraryEntry {
  id: string;
  name: string;
  description: string;
  prompt: string;
  outfitName: string;
  outfitDescription: string;
  outfitPrompt: string;
  backgroundName: string;
  backgroundDescription: string;
  backgroundPrompt: string;
}

export interface SituationLibraryCharacter {
  id: string;
  name: string;
  summary: string;
  synopsis: string;
  appearanceDescription: string;
  appearancePrompt: string;
  situations: SituationLibraryEntry[];
}

// Studio text fields are hand-written and unbounded; cap what rides along in
// every Paimon turn so a long synopsis can't dominate the payload.
const MAX_TEXT = 800;
const MAX_CHARACTERS = 30;

function trimText(value: string | undefined | null) {
  return (value ?? "").trim().slice(0, MAX_TEXT);
}

function hasContent(entry: SituationLibraryEntry) {
  return Boolean(entry.prompt || entry.description);
}

// Loads the saved characters as a video-oriented library: identity + every
// situation with its resolved outfit/background, prompts AND descriptions.
// Failures degrade to an empty library, exactly like the image-side loader.
export async function loadSituationLibrary(): Promise<
  SituationLibraryCharacter[]
> {
  try {
    const res = await fetch("/api/characters", { cache: "no-store" });
    const data = (await res.json()) as { characters?: Character[] };
    return (data.characters ?? [])
      .map((character): SituationLibraryCharacter => {
        const outfitById = new Map(
          character.outfits.map((outfit) => [outfit.id, outfit])
        );
        const backgroundById = new Map(
          character.backgrounds.map((background) => [background.id, background])
        );

        return {
          id: character.id,
          name: character.name,
          summary: trimText(character.summary),
          synopsis: trimText(character.synopsis),
          appearanceDescription: trimText(character.appearanceDescription),
          appearancePrompt: trimText(character.appearancePrompt),
          situations: character.situations
            .map((situation): SituationLibraryEntry => {
              const outfit = situation.outfitId
                ? outfitById.get(situation.outfitId)
                : undefined;
              const background = situation.backgroundId
                ? backgroundById.get(situation.backgroundId)
                : undefined;

              return {
                id: situation.id,
                name: situation.name,
                description: trimText(situation.description),
                prompt: trimText(situation.prompt),
                outfitName: outfit?.name ?? "",
                outfitDescription: trimText(outfit?.description),
                outfitPrompt: trimText(outfit?.prompt),
                backgroundName: background?.name ?? "",
                backgroundDescription: trimText(background?.description),
                backgroundPrompt: trimText(background?.prompt),
              };
            })
            // A situation with neither a prompt nor a description carries nothing
            // Paimon could turn into a shot.
            .filter(hasContent),
        };
      })
      .filter(
        (character) =>
          character.situations.length > 0 ||
          character.appearancePrompt ||
          character.appearanceDescription
      )
      .slice(0, MAX_CHARACTERS);
  } catch {
    return [];
  }
}

// Situation id used for a character's images that aren't tied to a situation.
export const BASE_SITUATION_KEY = "__base__";

// Every image generated for a character, grouped by the situation it was
// composed from (newest first within each group) — the same feed the image
// generator's Paimon picker shows as thumbnails.
export async function loadSituationImages(
  characterId: string
): Promise<Record<string, GeneratedImage[]>> {
  const res = await fetch(`/api/characters/${characterId}/images`, {
    cache: "no-store",
  });
  const data = (await res.json()) as {
    images?: {
      id: string;
      filename: string;
      url: string;
      thumbnailUrl: string;
      situationId: string | null;
      timestamp: number;
      params: GenerationParams | null;
    }[];
  };

  const grouped: Record<string, GeneratedImage[]> = {};
  for (const image of data.images ?? []) {
    const key = image.situationId ?? BASE_SITUATION_KEY;
    (grouped[key] ??= []).push({
      id: image.id,
      url: image.url,
      thumbnailUrl: image.thumbnailUrl,
      filename: image.filename,
      params: image.params,
      timestamp: image.timestamp,
      characterId,
      situationId: image.situationId ?? undefined,
    });
  }
  return grouped;
}

function labelledLine(label: string, value: string) {
  return value ? `- ${label}: ${value}` : "";
}

export interface VideoSituationInstructionOptions {
  character: SituationLibraryCharacter;
  // null = 기본 모습 (no situation picked).
  situation: SituationLibraryEntry | null;
  seconds: number;
  // A start frame is set for this clip (the situation's own image, or one the
  // user already had loaded).
  hasStartFrame: boolean;
  // The situation's saved image was just installed as that start frame.
  startFrameFromSituation: boolean;
  // The surface has a negative_prompt field (ComfyUI video does, SeeDance
  // doesn't), so only then is Paimon asked to write one.
  withNegativePrompt: boolean;
}

// The user-visible instruction for one situation → video turn. It carries the
// whole situation record inline (rather than trusting Paimon to look the name up in
// characterLibrary) so the composed shot can never drift onto another situation,
// and it spells out the four things the user asked to always be concrete:
// action, facial performance, camera work, and the clip's length budget.
export function buildVideoSituationInstruction({
  character,
  situation,
  seconds,
  hasStartFrame,
  startFrameFromSituation,
  withNegativePrompt,
}: VideoSituationInstructionOptions): string {
  const header = situation
    ? `저장된 캐릭터 '${character.name}'의 상황 '${
        situation.name || "이름 없음"
      }'을 ${seconds}초 영상으로 만들 영상 프롬프트를 작성해줘.`
    : `저장된 캐릭터 '${character.name}'의 기본 모습으로 ${seconds}초 영상을 만들 영상 프롬프트를 작성해줘.`;

  const frameLine = startFrameFromSituation
    ? "이 상황으로 생성된 이미지를 시작 프레임으로 이미 지정했어. 첨부된 '시작 이미지'가 이 영상의 0초 프레임이니까, 얼굴·헤어·의상·체형·구도·배경·색감·조명은 그대로 유지하고 시간에 따라 변하는 것만 묘사해줘."
    : hasStartFrame
      ? "지금 지정된 '시작 이미지'가 이 영상의 0초 프레임이야. 그 이미지의 인물·의상·배경·구도를 유지한 상태에서 움직임만 묘사해줘."
      : "이 상황에는 저장된 이미지가 없어. 시작 프레임 없이 아래 상황 정보만으로 프롬프트를 써줘.";

  const info = [
    "",
    "상황 정보 (이 내용이 기준이야):",
    labelledLine("캐릭터", `${character.name}${character.summary ? ` — ${character.summary}` : ""}`),
    labelledLine("캐릭터 묘사", character.appearanceDescription),
    labelledLine("캐릭터 프롬프트", character.appearancePrompt),
    situation ? labelledLine("상황 이름", situation.name) : "",
    situation ? labelledLine("상황 묘사", situation.description) : "",
    situation ? labelledLine("상황 프롬프트", situation.prompt) : "",
    situation ? labelledLine("의상", situation.outfitName) : "",
    situation ? labelledLine("의상 묘사", situation.outfitDescription) : "",
    situation ? labelledLine("의상 프롬프트", situation.outfitPrompt) : "",
    situation ? labelledLine("배경", situation.backgroundName) : "",
    situation ? labelledLine("배경 묘사", situation.backgroundDescription) : "",
    situation ? labelledLine("배경 프롬프트", situation.backgroundPrompt) : "",
  ].filter(Boolean);

  const requirements = [
    "",
    `요구사항:`,
    `- ${seconds}초 안에 끝나는 하나의 연속된 동작 아크로 구성해. 컷 전환·장면 전환·다른 장소는 넣지 마.`,
    `- 동작: 손·팔·상체·허리·다리·머리카락·옷자락이 어떤 순서로 어떻게 움직이는지 구체적으로 써줘. 물리적으로 가능한 동작만.`,
    `- 표정: 시선 방향과 그 변화, 눈 깜빡임, 눈썹, 입·입술, 호흡, 감정이 어떻게 번지는지까지 구체적으로 써줘.`,
    `- 카메라워크: 샷 사이즈, 카메라 높이·앵글, 그리고 하나의 명확한 카메라 움직임(고정 / 느린 푸시인 / 풀백 / 팬 / 틸트 / 달리 / 오빗 / 핸드헬드 드리프트)과 그 속도, 어디서 끝나는지를 명시해줘.`,
    `- 조명·배경의 미세한 변화와 마지막 비트(끝 프레임)도 적어줘.`,
    `- 태그 나열이 아니라 영상 모델이 읽는 자연어 촬영 지시문으로 써줘. 상황 프롬프트가 태그라면 움직임으로 바꿔서 풀어줘.`,
    withNegativePrompt
      ? `- 프롬프트와 네거티브 프롬프트만 수정하고, 모델·파이프라인·해상도·길이 설정은 그대로 둬.`
      : `- 프롬프트만 수정하고, 모델·해상도·길이·시작 프레임 설정은 그대로 둬.`,
  ];

  return [header, frameLine, ...info, ...requirements].join("\n");
}
