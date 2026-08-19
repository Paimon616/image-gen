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

// How much motion one clip can carry before the I2V pipelines start drifting.
// The start image is injected at frame 0 only, so a long clip that also asks for
// a big action arc has nothing left anchoring it by the end — which is exactly
// where the rendering visibly falls apart. Short clips therefore get a
// micro-motion brief, and long ones get a hard cap on how many beats they may
// contain instead of a bigger story.
function motionBudgetLine(seconds: number) {
  if (seconds <= 4) {
    return `- ${seconds}초는 아주 짧아. 미세 동작만 넣어줘: 호흡, 눈 깜빡임, 시선 이동, 머리카락·옷의 미세한 흔들림, 그리고 아주 작은 상체 움직임 하나. 자세 자체를 바꾸지 마.`;
  }
  if (seconds <= 8) {
    return `- ${seconds}초 안에 끝나는 주요 동작 1개 + 그에 딸린 미세 동작(호흡·시선·머리카락)으로 구성해. 컷 전환·장면 전환·다른 장소는 넣지 마.`;
  }
  return `- ${seconds}초는 길어서 뒤로 갈수록 원본에서 멀어지기 쉬워. 주요 동작은 최대 2개까지만, 같은 자리에서 이어지도록 천천히 전개해. 컷 전환·장면 전환·다른 장소·자세 카테고리 변경은 넣지 마.`;
}

function cameraLine(seconds: number) {
  const move =
    seconds <= 4
      ? "고정이거나 아주 느린 움직임 하나(미세한 푸시인 또는 드리프트)"
      : "하나의 명확한 움직임(고정 / 느린 푸시인 / 풀백 / 팬 / 틸트 / 달리 / 오빗 / 핸드헬드 드리프트)";
  return `- 카메라워크: 샷 사이즈, 카메라 높이·앵글, 그리고 ${move}과 그 속도, 어디서 끝나는지를 명시해줘. 샷 사이즈는 시작 프레임에서 크게 벗어나지 않게 유지해.`;
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
    motionBudgetLine(seconds),
    `- 동작: 손·팔·상체·허리·다리·머리카락·옷자락이 어떤 순서로 어떻게 움직이는지 구체적으로 써줘. 물리적으로 가능한 동작만.`,
    `- 표정: 시선 방향과 그 변화, 눈 깜빡임, 눈썹, 입·입술, 호흡, 감정이 어떻게 번지는지까지 구체적으로 써줘.`,
    cameraLine(seconds),
    `- 조명·배경의 미세한 변화와 마지막 비트(끝 프레임)도 적어줘.`,
    `- 태그 나열이 아니라 영상 모델이 읽는 자연어 촬영 지시문으로 써줘. 상황 프롬프트가 태그라면 움직임으로 바꿔서 풀어줘.`,
    // The dominant failure mode of these I2V pipelines is drift: the start frame
    // is only injected at frame 0, so anything the prompt asks to RE-STAGE
    // (standing up, re-framing, a different rendering style) forces the model to
    // invent it and the clip visibly degrades toward the end.
    hasStartFrame
      ? `- 재구성 금지: 시작 프레임의 자세 카테고리(앉음/섬/누움/엎드림), 프레이밍(피사체가 화면에서 차지하는 크기와 위치), 그림체(선 굵기·셰이딩 방식·색감)는 바꾸지 마. 일어서기·자리 이동·의상 교체·장소 변경·다른 화풍으로의 전환은 넣지 마.`
      : "",
    hasStartFrame
      ? `- 렌더링 스타일은 시작 프레임 그대로 유지해줘. 단, 'anime / illustration / cel shading / photorealistic / 3d render' 같은 매체·화풍 이름은 쓰지 마. 대신 선·윤곽 처리, 셰이딩의 부드러움, 피부·재질 표현, 색감과 콘트라스트, 조명 방향을 그대로 유지한다는 식으로 써줘.`
      : "",
    withNegativePrompt
      ? `- 네거티브 프롬프트에는 화질·움직임 항목 외에 style change, restyle, identity change, face morph, outfit change, background change, washed out colors, color banding, loss of detail, softened edges를 넣어줘. 매체·화풍 단어(anime, illustration, cel shading, photorealistic, 3d render, cgi)는 네거티브에 절대 넣지 마 — 시작 프레임이 속한 쪽을 부정하면 화풍이 무너져.`
      : `- 원치 않는 요소는 네거티브 프롬프트가 없으니 프롬프트 안에서 자연어로 배제해줘(화풍 변화·인물 교체·의상 변경 없음).`,
    withNegativePrompt
      ? `- 프롬프트와 네거티브 프롬프트만 수정하고, 모델·파이프라인·해상도·길이 설정은 그대로 둬.`
      : `- 프롬프트만 수정하고, 모델·해상도·길이·시작 프레임 설정은 그대로 둬.`,
  ].filter(Boolean);

  return [header, frameLine, ...info, ...requirements].join("\n");
}
