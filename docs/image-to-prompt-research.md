# 이미지 → 프롬프트 (Image-to-Prompt) 기능 조사 보고서

작성일: 2026-07-10
대상: image-gen (Next.js + ComfyUI 백엔드)

---

## 1. 요약 (TL;DR)

- **"어떤 이미지에나 통하는 정답 프롬프트"는 없다.** 프롬프트 정확도는 항상 *어느 체크포인트에서 재현할 것인가*에 상대적이다. 따라서 핵심 설계는 **타깃 체크포인트의 `base_model`에 맞춰 태거 방식을 자동 분기**하는 것이다.
- 이 앱의 모델 카탈로그는 **압도적으로 danbooru 계열(Illustrious/Pony/NoobAI/Anima)** 이다. → 대부분의 경우 **WD14 danbooru 태거**가 가장 재현율이 높다.
- 실사/SDXL 계열(SD 1.5, SDXL 1.0)에는 **자연어 interrogator(Florence-2 PromptGen)** 가 더 정확하다.
- 일반 이미지(스크린샷·사진·웹 이미지)도 동일 파이프라인으로 처리된다. 태거는 "소스"가 아니라 "보이는 것"을 뽑기 때문이다.
- 기존 `comfyui.ts` HTTP 파이프라인을 그대로 재사용 가능. 단 **텍스트 출력을 `/history`에서 읽으려면 워크플로우 끝에 `ShowText` 계열 노드가 필요**하다 (가장 중요한 함정).

---

## 2. 현재 코드베이스에 이미 있는 것

| 기능 | 위치 | 설명 |
|---|---|---|
| 메타데이터 → 파라미터 추출 | `src/components/metadata-import.tsx`, `src/lib/generation-metadata.ts` | 생성 이미지에 박힌 JSON/PNG info에서 프롬프트·파라미터·리소스를 폼에 적용. **일반 이미지엔 메타데이터가 없어 동작 불가.** |
| ComfyUI HTTP 파이프라인 | `src/lib/comfyui.ts` | `queueComfyWorkflow` → `/prompt` POST, `getHistory` → `/history/{id}` 폴링. `uploadImageToComfyUI`로 `/upload/image` 멀티파트 업로드 지원(147~172행). |
| 이미지 업로드 재사용 | `comfyui.ts:147` `uploadImageToComfyUI` | 원격 URL을 받아 ComfyUI input에 업로드 후 파일명 반환. img2img·controlnet에서 이미 사용 중 → **interrogate 입력에 그대로 재사용 가능.** |
| SSE 스트리밍 라우트 패턴 | `src/app/api/generate/stream/route.ts` | 새 interrogate 라우트의 참조 템플릿. |
| base_model 필드 | `data/model-catalog.json` | 체크포인트별 `base_model` 존재 → 태거 자동 분기의 근거 데이터. |

**결론:** 신규로 만들 것은 (a) interrogate용 ComfyUI 워크플로우 빌더, (b) 텍스트 출력 파서, (c) API 라우트, (d) UI 진입점 + base_model→태거 매핑뿐. 인프라 대부분은 재사용된다.

---

## 3. 카탈로그 base_model 분포 (태거 매핑 근거)

`data/model-catalog.json` 실측 분포:

| base_model | 대략 비중 | 권장 태거 |
|---|---|---|
| **Illustrious** | 압도적 다수 (~절반 이상) | WD14 (danbooru 태그) |
| **Pony** | 다수 | WD14 (danbooru 태그) |
| **Anima** | 다수 | WD14 (danbooru 태그) |
| **NoobAI** | 소수 (3개) | WD14 (danbooru + e621) |
| **SD 1.5** | 다수 | 자연어(실사) 또는 WD14(애니 파인튜닝) |
| **SDXL 1.0** | 소수 | 자연어 |
| **Flux.1 D** | 소수 (3개) | 자연어 |
| **LTXV 2.3** | 소수 (비디오, 제외) | — |
| **Upscaler** | 2개 (제외) | — |

→ **danbooru 계열이 카탈로그의 대부분**이므로 WD14를 기본값으로 두는 것이 타당하다.

---

## 4. 조사 결과: ComfyUI 노드/모델 옵션 (2025~2026)

### 4-1. WD14 / booru 태거 — 애니·일러스트 계열에 최적

- **주 노드:** `pythongosssss/ComfyUI-WD14-Tagger` (사실상 표준)
  - 설치: `custom_nodes/`에 clone 후 `pip install -r requirements.txt` (또는 ComfyUI-Manager). 모델은 런타임 자동 다운로드.
  - 노드 ID: **`WD14Tagger|pysssss`**. 입력 = IMAGE, 출력 = **STRING**(쉼표 구분 danbooru 태그) — API 친화적.
  - 파라미터: `model`, `threshold`(general), `character_threshold`, `exclude_tags`, `replace_underscore`, `trailing_comma`.
- **모델 변형** (SmilingWolf, v3 세대가 현행):
  - `wd-eva02-large-tagger-v3` — 최고 정확도, 가장 무거움/느림. **품질 우선 기본값.**
  - `wd-swinv2-tagger-v3` — 속도/품질 균형. **프로덕션 기본값 추천.**
  - `wd-vit-tagger-v3` / `wd-vit-large-tagger-v3` — 경량·고속.
  - `wd-convnextv2-tagger-v3` — 안정적 올라운더.
- **대안 노드:** `bedovyy/ComfyUI-WD-Timm-Tagger`(Timm 백엔드, 신모델·고속), `r-vage/ComfyUI_SmartLML`(WD14 + Florence-2 + LLaVA/QwenVL 통합 로더, 태그+자연어 겸용 시 유용).

### 4-2. 자연어 interrogator — 실사/포토리얼에 최적

- **Florence-2** — 빠름, 저VRAM(~1~2GB), 재현성 높음. **실사 기본값 추천.**
  - `MiaoshouAI/Florence-2-*-PromptGen` 파인튜닝이 SD 스타일 프롬프트를 출력(단순 캡션 아님).
  - 노드: `kijai/ComfyUI-Florence2`, `ComfyUI_LayerStyle_Advance`(`LayerUtility: Florence2Image2Prompt`), `ComfyUI-CaptionThis`.
  - task 모드: caption / detailed caption / more detailed caption.
- **JoyCaption (Beta One)** — 가장 풍부한 서술형. LLaVA 기반, 무겁고 느림.
  - 노드: `1038lab/ComfyUI-JoyCaption`, GGUF: `judian17/ComfyUI-joycaption-beta-one-GGUF`.
  - GGUF `IQ4_XS`는 8GB+ VRAM 가능. `llama-cpp-python` 필요.
- **CLIP Interrogator** — 레거시(BLIP+CLIP). `ComfyUI-Easy-Use`의 `easy imageInterrogator`. Florence-2/JoyCaption에 밀리나 폴백으로 유효.
- **BLIP/BLIP2** — 구식. Florence-2가 품질·VRAM 모두 우위.

### 4-3. 방식별 트레이드오프

| 방식 | 강점 | 약점 | 적합 base_model |
|---|---|---|---|
| WD14 (booru) | danbooru 어휘 정확·무료·로컬·고속 | 문장형 묘사 약함 | Illustrious/Pony/NoobAI/Anima |
| Florence-2 PromptGen | 빠름·저VRAM·재현성 | 태그 정밀도는 WD14보다 낮음 | SD 1.5(실사)/SDXL/Flux |
| JoyCaption | 최고 서술 품질 | 느림·고VRAM·의존성 무거움 | 실사, 상세 묘사 필요 시 |
| 비전 LLM(Gemini/GPT-4o) | 설치 불필요·유연 | API 키·비용·태그형 약함 | 폴백/보조 |

---

## 5. ComfyUI HTTP API로 헤드리스 실행하는 법

기존 이미지 생성과 동일 패턴이나 **결과가 이미지가 아니라 텍스트**라는 차이.

1. 이미지 입력: `uploadImageToComfyUI`(재사용) → `LoadImage` 노드가 파일명 참조.
2. 워크플로우 JSON: `LoadImage` → 태거/interrogator 노드 → **텍스트 종단 노드**.
3. `queueComfyWorkflow` → `/prompt` POST → `prompt_id`.
4. `/history/{prompt_id}` 폴링 → 출력에서 텍스트 읽기.

### ⚠️ 가장 중요한 함정: 텍스트 출력 회수

- `WD14Tagger|pysssss`는 STRING을 반환하지만, ComfyUI `/history`는 **UI 출력을 내보내는 노드가 있어야만** 그 값을 노출한다. 태거 노드만으로는 `/history`에 텍스트가 안 뜬다.
- **해결:** 워크플로우 끝에 `ShowText|pysssss`(pythongosssss custom-scripts) 또는 `easy showAnything`/`easy saveText`(ComfyUI-Easy-Use)를 붙이고, `history[prompt_id].outputs[nodeId].text`를 읽는다.
- 또는 SaveText류로 `.txt`를 쓰고 파일을 읽는다.

### comfyui.ts 확장 지점

현재 `ComfyHistoryOutput`(37~43행)은 `images/gifs/videos/audio`만 정의됨. **`text?: string[]` 필드 추가**가 필요하고, `imageRefsFromHistory`(746행)에 대응하는 `textFromHistory` 헬퍼와 `waitForComfyImageRefs`(835행) 패턴을 본뜬 `waitForComfyText`를 추가한다.

---

## 6. 체크포인트 인식 자동 분기 (권장 설계)

```
사용자가 타깃 체크포인트 선택 + 이미지 업로드
        │
        ▼
base_model 조회 (model-catalog.json)
        │
   ┌────┴─────────────────────┐
   ▼                          ▼
Illustrious/Pony/          SD 1.5(실사)/
NoobAI/Anima               SDXL/Flux
   │                          │
   ▼                          ▼
WD14 태거                   Florence-2 PromptGen
(danbooru 태그)             (자연어)
   │                          │
   └────────────┬─────────────┘
                ▼
   (선택) 체크포인트 트리거워드/권장태그 병합
                ▼
        폼의 prompt에 적용
```

- **수동 override** 토글 제공: "태그형 강제 / 서술형 강제 / 자동". 타깃 미선택 시 또는 원본 충실 추출 시 사용.
- **뉘앙스:** Illustrious 2.0/2.0-Stable은 자연어를 일부 이해 → "태그 + 짧은 문장" 하이브리드 가능. 단 pre-2.0(WAI 등)은 불가. NoobAI는 e621 태그가 섞여 순수 danbooru와 일부 차이.

### (선택) 재현 검증 루프

뽑은 프롬프트로 해당 체크포인트에서 재생성 → 원본과 비교(간이 유사도)하여 "실제 재현되는 프롬프트인지" 확인. 생성 비용이 들어 옵션으로 둘 것.

---

## 7. 구현 시 필요한 작업 (계획 프리뷰)

1. **ComfyUI 준비:** `ComfyUI-WD14-Tagger` + (실사용) `ComfyUI-Florence2` + `pythongosssss ShowText` 노드 설치. 서버 환경 접근 필요.
2. **`comfyui.ts` 확장:**
   - `ComfyHistoryOutput`에 `text?` 추가.
   - `buildInterrogateWorkflow(imageRef, mode)` — WD14 / Florence-2 분기.
   - `waitForComfyText` + `textFromHistory`.
   - `interrogateImage(imageUrl, targetBaseModel, overrideMode?)`.
3. **API 라우트:** `src/app/api/interrogate/route.ts` (또는 stream) — 업로드 → 워크플로우 → 텍스트 반환.
4. **base_model→태거 매핑 유틸:** `data/model-catalog.json`의 `base_model`을 읽어 `wd14 | florence` 결정. `comfyui-model-files.ts` 근처에 배치.
5. **UI:** `metadata-import.tsx` 옆에 "이미지에서 프롬프트 뽑기" 진입점 — 이미지 업로드, 자동/수동 모드 토글, 결과를 `setParams`로 폼에 반영.

---

## 8. 권장 스택 (결론)

- **애니/일러스트 (카탈로그 대부분):** `ComfyUI-WD14-Tagger` + `wd-swinv2-tagger-v3`(기본) / `wd-eva02-large-tagger-v3`(고정확).
- **실사/SDXL/Flux:** `kijai/ComfyUI-Florence2` + `Florence-2-large-PromptGen`.
- **텍스트 회수:** 모든 interrogate 워크플로우를 `ShowText|pysssss`로 종단하여 `/history`에서 문자열 읽기.
- **UX:** 타깃 체크포인트 `base_model` 기반 자동 분기 + 수동 override.

---

## 참고 링크

- [pythongosssss/ComfyUI-WD14-Tagger](https://github.com/pythongosssss/ComfyUI-WD14-Tagger)
- [WD14 모델 선택 가이드 (DeepWiki)](https://deepwiki.com/pythongosssss/ComfyUI-WD14-Tagger/3.1-model-selection)
- [bedovyy/ComfyUI-WD-Timm-Tagger](https://comfy.icu/extension/bedovyy__ComfyUI-WD-Timm-Tagger)
- [r-vage/ComfyUI_SmartLML](https://github.com/r-vage/ComfyUI_SmartLML)
- [1038lab/ComfyUI-JoyCaption](https://github.com/1038lab/ComfyUI-JoyCaption)
- [judian17/ComfyUI-joycaption-beta-one-GGUF](https://github.com/judian17/ComfyUI-joycaption-beta-one-GGUF)
- [MiaoshouAI Florence-2 PromptGen](https://huggingface.co/MiaoshouAI/Florence-2-base-PromptGen)
- [kijai/ComfyUI-Florence2](https://github.com/kijai/ComfyUI-Florence2)
- [Florence2Image2Prompt (LayerStyle Advance)](https://comfyai.run/documentation/LayerUtility:%20Florence2Image2Prompt)
- [ComfyUI-CaptionThis](https://github.com/MieMieeeee/ComfyUI-CaptionThis)
- [ComfyUI Easy-Use imageInterrogator](https://www.runcomfy.com/comfyui-nodes/ComfyUI-Easy-Use/easy-imageInterrogator)
- [ComfyUI /history API 문서](https://docs.comfy.org/api-reference/cloud/job/get-history-for-specific-prompt)
- [WD14 captioner for Pony/Illustrious/NoobAI](https://lab.cloud/docs/generate/wd14_captioner/)
- [Arctenox Illustrious 프롬프트 가이드 (Civitai)](https://civitai.com/articles/23210/arctenoxs-simple-prompt-guide-for-illustrious)
