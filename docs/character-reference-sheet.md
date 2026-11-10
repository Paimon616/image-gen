# 캐릭터 기준 시트 (BETA)

캐릭터 얼굴, 머리, 의상이 이미지마다 흔들리는 문제를 줄이는 자체 GPU 파이프라인.
유료 API 없음. 로컬 ComfyUI 또는 LAN GPU 워커(RunPod 팟도 가능)에서만 동작.

흐름: 캐릭터 생성 시 기준 시트 1장 확정 → 그 캐릭터의 이후 모든 렌더에 IP-Adapter 참조 자동 적용.
LoRA는 대표 캐릭터에만 별도 학습(기존 캐릭터 LoRA 기능), 시트와 함께 써도 됨.

## 켜는 법

1. 설정 > 기본 > 베타 기능 > `캐릭터 기준 시트 (BETA)` 켜기. 끄면 기존 동작 그대로(탭, 경고, 참조 주입 전부 비활성).
2. 캐릭터 스튜디오 > 캐릭터 선택 > `기준 시트` 탭.
3. `IP-Adapter 준비 상태`에서 대상(로컬 / GPU 워커 / RunPod) 확인. 빨간 항목이 있으면:
   - 로컬: `설치` 버튼(= `npm run setup:ipadapter`, Windows `npm run setup:ipadapter:win`) 후 ComfyUI 재시작.
   - GPU 워커: `모델 받기` 버튼(헬퍼 다운로드 경로, Civitai 키 필요). 노드는 워커 PC에서 최신 worker-kit으로 `start-worker.bat` 재실행.
4. `후보 4장 생성` → 결과 중 하나 `이걸로 확정`. 확정 시 참조 영역(정면 얼굴)이 자동 지정됨. 필요하면 위치 조정.
5. 이후 그 캐릭터의 상황 렌더(Paimon 상황 선택, 배치 포함)는 자동으로 시트 참조 적용.

캐릭터별 스위치(`이 캐릭터에 시트 참조 사용`)와 참조 강도(기본 0.5, 권장 0.4~0.6)는 탭에서 조절.
시트 미확정 상태로 상황 생성 시 확인 창 표시, 상황 탭에 경고 배너 표시.

## 동작 방식

| 단계 | 위치 |
| --- | --- |
| 시트 프롬프트(Illustrious 태그: turnaround, front/side/back full body, 표정 4종, 흰 배경) | `src/lib/character-sheet.ts` `buildCharacterSheetPrompt` |
| 후보 파라미터(메인 이미지 설정 기준, 캐릭터 LoRA + 트리거 워드 병합, 1216x832, ControlNet/소스/PuLID/ADetailer 해제, 백엔드 ComfyUI 고정) | `buildSheetCandidateParams` |
| 후보 생성 | 공용 생성 큐(`useGenerationQueueStore.enqueue`), `situationId = "__sheet__"`로 캐릭터에 연결. 생성 대상은 이미지 생성 화면 설정(로컬 / 워커 풀 / RunPod)을 따름 |
| 확정 데이터 | `Character.referenceSheet` = `{url, filename, confirmed, enabled, prompt, seed, strength}` (`data/characters.json`) |
| 참조 주입 | `api/generate/stream`: `characterId`가 붙은 요청에서 베타 ON + 시트 확정 + 캐릭터 스위치 ON + ComfyUI + 시트 후보 아님이면 `character_sheet_image`, `character_sheet_strength` 설정. 클라이언트가 보낸 값은 무시(서버만 결정) |
| 워크플로 | `src/lib/comfyui.ts` `addIpAdapterNodes` + `ipAdapterReferences` (SDXL 기본 그래프, PuLID 뒤): `IPAdapterModelLoader` + `CLIPVisionLoader` + `LoadImage` → `PrepImageForClipVision(pad)` → `IPAdapterAdvanced(linear, end_at 0.8)`. 네거티브에 `character sheet, reference sheet, multiple views, turnaround, expression chart` 자동 추가(시트 레이아웃 전이 방지) |

`pad` 크롭: 시트 전체(모든 뷰)를 CLIP Vision에 넣음. center 크롭이면 정면만 남음.
PuLID(`캐릭터 이미지`)와 동시 사용 가능. 둘 다 MODEL 패치라 체인으로 연결.
결과 이미지 메타데이터에 `character_sheet_image`가 남음(뷰어 "기준 시트 (BETA)" 썸네일).

## 이미지 생성 화면

- `기준 시트` 배지: Paimon 상황 선택 등으로 프롬프트가 캐릭터에 연결된 동안(큐 `characterContext`, 프롬프트 일치) 참조 이미지 영역 위에 표시. 시트 썸네일, 적용 여부, 미확정/캐릭터에서 꺼짐 상태.
  - `적용` 스위치: 이번 생성만 끄기(`character_sheet_disabled`).
  - 강도 슬라이더: 캐릭터 기본값 대신 쓸 값(`character_sheet_strength_override`), `기본값`으로 해제. 다른 캐릭터로 바뀌면 둘 다 초기화.
- `스타일 참조` 슬롯(기존 `style_image`, 이전엔 워크플로 미연결)을 같은 IP-Adapter로 연결: `style transfer` 가중치 타입, center 크롭, 강도 `style_image_strength`(기본 0.8). 캐릭터 연결 불필요.
- 둘 다 쓰면 로더(210/211) 공유, `IPAdapterAdvanced` 두 개 체인(시트 → 스타일). 노드 id는 참조마다 212+4n.
- SDXL/Illustrious 기본 그래프만. Krea 2 / Z-Image / Anima에서는 스타일 이미지도 무시.

## 노드, 모델 요구사항

| 종류 | 이름 | 위치 | 크기 |
| --- | --- | --- | --- |
| 커스텀 노드 | `ComfyUI_IPAdapter_plus` @ `a0f451a5113cf9becb0847b92884cb10cbdec0ef` | `custom_nodes/` | - |
| IP-Adapter (기본) | `NOOB-IPA-MARK1.safetensors` (Civitai 모델 버전 1121145, Civitai 키 필요) | `models/ipadapter/` | 1.4GB |
| CLIP Vision (기본) | `CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors` (h94/IP-Adapter `sdxl_models/image_encoder/model.safetensors`를 이 이름으로 저장) | `models/clip_vision/` | 3.7GB |
| (대체) | `ip-adapter-plus_sdxl_vit-h` + `CLIP-ViT-H-14-laion2B-s32B-b79K` | 같은 폴더 | 0.8 + 2.5GB |

대체 쌍은 Illustrious 계열에서 색 번짐, 인물 복제가 심해 권장하지 않음(아래 평가). 둘 다 있으면 NoobAI 쌍이 우선.

핀 위치(셋 동기 유지): `src/lib/character-sheet.ts`(`IPADAPTER_NODE_REPO`, `IPADAPTER_MODEL`, `IPADAPTER_CLIP_VISION`), `comfyui-config/custom-nodes.json`, `worker-kit/windows/custom-nodes.json`.

누락 감지: 그래프 빌드 전에 `/object_info`로 노드와 파일 콤보를 확인. 없으면 큐에 넣기 전에
`[IP-Adapter · 기준 시트 BETA] ... 커스텀 노드가 없습니다` / `... 모델 파일이 없습니다: <경로>` 오류로 중단(스타일 참조는 `[IP-Adapter · 스타일 참조]`).
파일 선택 규칙(`pickIpAdapterFiles`): NoobAI/Illustrious 어댑터 + bigG가 있으면 그 쌍. 없으면 SDXL(FaceID 제외), `plus_sdxl_vit-h` 우선, ViT-H 어댑터는 ViT-H 인코더, 일반 `ip-adapter_sdxl`은 bigG 인코더.

## 참조 영역 (얼굴 크롭)

여러 뷰가 담긴 시트를 통째로 IP-Adapter에 넣으면 장면에 캐릭터가 2명 그려지는 일이 생김. 그래서 시트 확정 시
왼쪽 위 정사각 영역(정면 얼굴~어깨, `DEFAULT_SHEET_CROP`)을 자동으로 잘라 `referenceSheet.crop`에 저장하고,
렌더에는 이 크롭만 넣음. 스튜디오 기준 시트 탭에서 클릭으로 위치, 슬라이더로 크기 조정 후 `참조 영역 저장`.
크롭 파일은 `output/sheetref-*.png`(갤러리 목록 제외), `POST /api/character-sheet/crop`.
무표정에 가까운 얼굴을 고르면 표정 전이가 줄어듦.

## 평가 결과 (2026-11-09)

조건: hassakuXLIllustrious_v22, LoRA 없음, 704x1024, 20 steps, 5개 상황(카페, 밤거리, 교실, 해변 원피스 = 의상 변경, 비), 같은 시드. Mac M5(MPS)에서 실행.

| 라운드 | 설정 | 결과 |
| --- | --- | --- |
| R1-off | 시트 없음 | 화질 깨끗. 은발·적안은 태그만으로 유지. 교복 상의 색(흰/검), 리본 색이 이미지마다 다름 |
| R1 | SDXL PLUS, 시트 전체, 0.5 | 의상은 시트 쪽으로 수렴. 인물 복제(비), 구도 붕괴, 채도 과다 |
| R2/R3 | SDXL PLUS, 정면 크롭, 0.5 / 0.35 | 복제는 사라짐. 파스텔로 씻긴 색, 피부 붉어짐. 강도를 낮춰도 그대로 |
| R5 | 같은 그래프, 강도 0 | 깨끗 → 색 문제는 IP-Adapter 주입 자체(SDXL base 어댑터 × Illustrious) |
| R7 | NoobAI + 정면 크롭, 0.5 | 색 정상. 교복, 리본, 얼굴 일관. 해변 원피스에 교복 칼라 침범 |
| R8 | NoobAI + 시트 전체, 0.5 | 색 정상, 의상 변경 정상. 교실에서 인물 복제 1건 |
| R9 | NoobAI + 얼굴/상반신 크롭, 0.5 | 최선. 복제 없음, 의상 변경 정상, 교복·얼굴·머리 일관. 시트 표정(씩 웃음) 일부 전이 |
| R10 | NoobAI + 얼굴 크롭, 0.65 | 과고정. 해변 원피스까지 교복화, 표정 전이 심함, 포즈 반영 약화 |
| R11 / R12 | 다른 시드: 얼굴 크롭 0.5 / 시트 없음 | 교복 상의 일치 3/4 vs 1/4. 시트 쪽 웃는 표정 전이, 해변 칼라 약간 |
| R13 | 제품 경로(확정 → 자동 참조 영역) | R11과 동일 결과 → 자동 크롭 경로 정상 |
| R14 | 얼굴 크롭 0.45 | 표정 전이 감소, 해변 칼라 침범 사라짐, 교복 일치 유지 |
| R15 | 정면 머리 뷰 영역 0.5 | 시트 일치 최고: 한쪽 사이드 리본, 눈매, 부드러운 미소. 해변 정상 |
| R16 | 외형 프롬프트를 시트에 맞춤 + 머리 뷰 영역 0.45 | 교복 4/4 일치, 은발 5/5(1장 앞머리 일부 검게), 해변 원피스 정상 |
| R17 | R16과 같은 프롬프트, 시트 없음 | "black hair ribbon"이 머리색으로 번져 흑발 4/5. 교복도 반팔/긴팔 혼재 |
| R18 | R16 그대로, RTX 3060 GPU 워커에서 | 맥과 같은 경향. 은발 4/5(비 장면 앞머리 일부 검게), 붉은 눈 5/5, 교복 4/4, 해변 원피스 정상, 색 바램과 중복 없음. 장당 약 14초 |
| R19 | R18과 같은 프롬프트, 시트 없음, 3060 | 은발 1/5, 나머지 흑발이나 흑백 혼합. 교실 반팔 교복. 장당 약 11초 |
| R20 | 깔끔한 프롬프트("black hair ribbon" → "hair ribbon"), 장면 5개 × 시드 4세트, 시트 0.45, 3060 | 은발 20/20, 붉은 눈 20/20, 긴소매 교복 16/16. 표정이 시트의 미소로 쏠림, 조명과 색감이 시트처럼 평평해짐(야경 네온 약해짐) |
| R21 | R20과 같은 프롬프트·시드, 시트 없음 | 은발 20/20, 붉은 눈 20/20, 긴소매 교복 10/16(반팔로 바뀜). 표정, 조명 다양. 리본 색(검정/빨강)은 R20과 차이 없음 |

결론(R20/R21): 프롬프트가 깔끔하면 머리색, 눈색은 시트 없이도 유지됨. 시트의 실효는 프롬프트에 없는 세부(소매 길이, 교복 디테일)를 고정하는 것. 대신 표정과 색감이 시트 쪽으로 끌려감. 0.45는 의상 디테일 고정용으로 적당하고, 표정과 조명을 살리려면 더 낮추는 편이 나음.

### 특이 복장 (R22, RTX 3060)

승무원(남색 재킷, 빨간 스카프, 필박스 모자)과 간호사(간호모, 연분홍 원피스, 흰 앞치마) 캐릭터. 각 시트 후보 4장 중 1장을 확정. 장면 프롬프트에는 머리, 눈과 `flight attendant uniform` / `nurse uniform`만 넣고 복장 세부는 쓰지 않음. 장면 6개 × 시드 3세트 × (시트 없음, 머리 영역, 상반신 영역), 강도 0.45, 총 108장.

| 항목 | 시트 없음 | 머리 영역 | 상반신 영역 |
| --- | --- | --- | --- |
| 승무원 빨간 스카프 | 1/18 (청록, 파랑, 없음) | 16/18 | 12/18 |
| 승무원 모자 | 12/18 | 18/18 | 18/18 |
| 간호모(빨간 십자) | 약 12/18 (하트 등 변형) | 약 13/18 | 약 17/18 |
| 간호복 색 | 민트, 흰색 위주. 시트와 다름 | 흰색, 일부 분홍 | 흰색, 일부 분홍, 빨간 소매 띠 |
| 땋은 양갈래 | 약 6/18 | 약 14/18 | 약 15/18 |

- 프롬프트가 일반명사(`nurse uniform`)뿐일 때 시트 효과가 큼. 교복(R20/R21)보다 차이가 훨씬 뚜렷함.
- 영역에 따라 잡히는 부위가 다름. 머리 영역은 모자, 스카프처럼 얼굴 가까운 소품, 상반신 영역은 간호모와 옷 장식. 앞치마, 원피스 색처럼 영역 밖 요소는 거의 안 옮겨짐.
- 시트 없음은 체형이 과장되는 경우가 많았고, 시트 적용은 시트 비율에 가까움. 표정은 여전히 시트의 미소로 쏠림.
- 현재 자동 영역(`DEFAULT_SHEET_CROP`, 좌상단 고정)은 시트 배치에 따라 정면 인물을 못 잡을 수 있음(승무원 시트는 좌상단이 뒷모습). 확정 후 영역을 정면 머리~가슴으로 옮기는 것이 필요.

결론: NoobAI 어댑터 + 정면 머리(얼굴~가슴) 참조 영역 + 강도 0.45가 기본값. 영역은 시트에서 얼굴이 가장 크게 나온 정면 뷰 하나만 감쌀 것.
남은 한계: 시트 자체가 외형 프롬프트와 다르면(예: "black sailor uniform"인데 시트는 흰 상의) 프롬프트와 시트가 충돌함. 후보 중 외형과 맞는 것을 확정할 것.

## GPU 워커

- 노드: `worker-kit/windows/custom-nodes.json`(키트에 커밋된 고정 목록)을 `start-worker.bat`이 그 PC에서 설치. `worker.ps1 nodes`로 노드만 설치 가능.
  github.com https 저장소 + 40자리 커밋만 허용. 원격 트리거 없음. depot 동기화도 이 목록은 비활성화하지 않음.
- 모델: 스튜디오 `모델 받기` → `POST /api/character-sheet/assets {targetId}` → 기존 `streamRunpodResourceDownload`(워커 id는 `getRunpodPod`이 해석) → 워커 `helper.py` `/download/stream`.
  헬퍼 보안 규칙 그대로(`data\models` 안에만 쓰기, https만).

## 한계

- SDXL/Illustrious 기본 그래프만. Krea 2 / Z-Image / Anima 렌더에는 시트 참조 미적용(무시).
- A1111/Forge 백엔드 미적용.
- 시트는 렌더 시점 기준 캐릭터 레코드에서 읽음. 갤러리 이미지 파라미터를 캐릭터 연결 없이 재사용하면 시트 참조 빠짐.
- 강도 과다(0.8+) 시 시트 구도(여러 뷰)가 장면에 섞일 수 있음.
