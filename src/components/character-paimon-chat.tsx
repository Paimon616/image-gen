"use client";

import { useEffect } from "react";
import { PaimonPanel } from "@/components/paimon-panel";
import {
  publishCharacterSnapshot,
  useCharacterPaimonStore,
} from "@/lib/character-paimon-store";
import type { Character } from "@/lib/types";

interface CharacterPaimonChatProps {
  character: Character;
  // Open the panel straight away — used when this character's answer was still
  // being written as the studio mounted.
  autoOpen?: boolean;
}

const INTRO =
  "파이몬이에요. 어떤 캐릭터를 만들지 이야기해 주세요. 외형·의상·배경·상황을 알맞은 칸에 자동으로 채워드릴게요. 성인/NSFW 묘사도 가능해요.";

export function CharacterPaimonChat({
  character,
  autoOpen = false,
}: CharacterPaimonChatProps) {
  // The chat itself lives in a module-level store keyed by character id (see
  // character-paimon-store.ts), so an answer that is still streaming when the
  // user leaves the studio finishes, lands its patch, and is still here on
  // return. Only the freshest character snapshot has to be published for it.
  useEffect(() => {
    publishCharacterSnapshot(character);
  }, [character]);

  return (
    <PaimonPanel
      store={useCharacterPaimonStore}
      conversationId={character.id}
      subtitle={
        character.name
          ? `"${character.name}" 캐릭터 설정을 채웁니다`
          : "대화로 캐릭터 설정을 채웁니다"
      }
      intro={INTRO}
      placeholder="바닷가에서 수영하는 은발 엘프 여성을 만들어줘"
      defaultOpen={autoOpen}
    />
  );
}
