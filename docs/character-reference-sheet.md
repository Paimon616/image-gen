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
4. `후보 4장 생성` → 결과 중 하나 `이걸로 확정`. 확정 시 참조 영역(정면 인물의 머리~가슴)을 자동으로 찾아 지정. 필요하면 위치 조정하거나 `자동으로 찾기`.
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
정면 인물의 머리~가슴 정사각 영역을 자동으로 찾아 잘라 `referenceSheet.crop`에 저장하고,
렌더에는 이 크롭만 넣음. 스튜디오 기준 시트 탭에서 클릭으로 위치, 슬라이더로 크기 조정 후 `참조 영역 저장`.

자동 영역(`src/lib/sheet-auto-crop.ts`, `POST /api/character-sheet/crop {filename, auto: true}`): 모델이나 네트워크 없이 픽셀 규칙만 씀.
1. 테두리 색을 배경으로 보고 전경 분리, 연결 요소로 인물 덩어리 찾기. 키가 이미지의 55% 이상이면 전신 인물.
2. 인물 머리 띠(위 16%)에 피부색이 있으면 정면, 머리카락만 있으면 뒷모습.
3. 같은 열에 얼굴이 3개 이상 쌓여 있으면 표정 모음 열로 보고 감점. 붙어 있는 인물은 얼굴별로 따로 판단.
4. 고른 얼굴 바로 위에서 인물 키의 38% 크기 정사각형(머리~가슴).
못 찾으면 예전 고정 영역(`DEFAULT_SHEET_CROP`, 좌상단). 시트 9장으로 확인: 8장은 정면 인물, 1장은 붙어 있는 정면 인물 둘 사이.
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
- 당시 자동 영역(`DEFAULT_SHEET_CROP`, 좌상단 고정)은 승무원 시트에서 뒷모습을 잡았음. 이후 정면 인물 자동 탐지로 교체(위 참조 영역 절).

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

### Krea 2 (R23, RTX 3060)

Krea 2는 SDXL이 아니라 IP-Adapter 기준 시트가 적용되지 않음. 대신 Krea 2 캐릭터 참조(Identity Edit, `character_image`)에 시트의 참조 영역을 넣어 비교.
- 시트도 Krea 2로 생성(반실사, 한국인 인상). 애니 시트를 반실사 장면의 참조로 쓰면 시트의 흰 배경과 평면 채색이 장면에 옮겨가 배경이 선화처럼 나옴.
- 장면 프롬프트는 "Semi-realistic photo of …, wearing a flight attendant / nurse uniform"만. 복장 세부는 쓰지 않음. 장면 6개 × 2명, 시드 1세트, 8스텝.

| 항목 | 참조 없음 | 시트 참조 |
| --- | --- | --- |
| 승무원 모자(금색 날개) | 0/6 | 6/6 |
| 승무원 빨간 스카프 | 0/6 (줄무늬 리본) | 6/6 |
| 승무원 남색 재킷 | 0/6 (조끼 + 흰 셔츠) | 6/6 |
| 간호모(빨간 십자) | 0/6 (분홍 모자 2) | 6/6 |
| 간호사 흰 앞치마, 분홍 원피스 + 빨간 테두리 | 0/6 | 6/6 |
| 얼굴, 앞머리 | 장면마다 다름 | 시트와 거의 같음 |
| 속도(장당) | 약 44초 | 약 94초 |

- 효과는 SDXL IP-Adapter보다 훨씬 강함(복장, 얼굴 모두 거의 고정).
- 대가: 대부분 정면, 미소로 수렴. `from side` 같은 구도 지시가 약해짐. 강도(`character_reference_strength`, 기본 0.7)를 낮춰 볼 여지.
- 3060 VRAM 12GB에 fp8 본체(13.1GB)가 다 안 들어가 일부를 시스템 메모리로 돌림. 그래서 SDXL(약 14초)보다 느림.
- 자동 참조 영역은 반실사 시트에서도 대체로 정면 인물을 잡음(8장 중 6장). 실패한 2장은 얼굴 모음, 측면 인물.

#### 참조 방식 변형 (R24, 3060, 반실사 시트)
`character_reference_layout`(aligned/beside), 가중치(강도 0.7 → ref_boost 2.1, 0.33 → 1.0), `character_reference_restage`(지시문) 비교. 장면 3개 × 2명.
- 옷, 얼굴 유지는 네 조건 모두 거의 완벽. 자세, 구도 차이는 작음(이 장면들은 기존 방식에서도 지시를 대체로 따름). 표정은 모두 참조의 미소로 쏠림 → 표정은 프롬프트에 명시하거나 무표정 영역을 참조로.
- `beside` + 기존 지시문("illustration style 유지")은 반실사 장면을 만화체로 바꾸는 경우가 생김(간호사 책상).
- `beside` + 1.0 + `restage` 지시문이 가장 자연스러움. 애니 시트에는 그림체 유지 문장이 필요할 수 있어 기본값은 그대로 둠(옵션).

#### fp8 vs GGUF Q5_K_M (R25, 3060)
같은 프롬프트, 시드. 준비 1장 제외 3장 평균, ComfyUI 실행 시간.

| 모델 | 참조 없음 | 캐릭터 참조 | 첫 장(모델 로드 포함) |
| --- | --- | --- | --- |
| krea2_turbo_fp8_scaled (13.1GB) | 51.8초 | 98.0초 | 70.8초 |
| krea2_turbo-Q5_K_M.gguf (8.9GB) | 60.8초 | 110.9초 | 63.9초 |

- Q5가 VRAM에 통째로 들어가는데도 13~17% 느림. GGUF는 계산 때 레이어마다 압축을 푸는 비용이 있고, fp8은 비동기 오프로딩(스트림 2개)이 전송을 잘 가려 줌.
- 화질은 같은 시드에서 구도, 디테일이 거의 같음. 눈에 띄는 열화 없음.
- 결론: 3060에서는 fp8 유지. Q5는 모델 로드가 빠르고(첫 장 −7초) 파일이 작은 정도의 이점.

### Krea 2 페인터리 애니 (R26) · 장면별 참조 영역 (R27), RTX 3060

R26: 시트를 Krea 2로 "Anime-style illustration with soft painterly shading and warm color grading" 화풍으로 생성. 장면은 같은 화풍 문장 + 긴 자연어, 복장은 "flight attendant / nurse uniform"만. 장면마다 표정 지정(하품, 놀람, 윙크, 긴장 등).

| 항목 | 참조 없음 | 시트 참조 |
| --- | --- | --- |
| 승무원 모자, 빨간 스카프, 남색 재킷 | 0/6 (조끼, 줄무늬 스카프) | 6/6 |
| 간호모, 흰 앞치마 + 빨간 깃 | 0/6, 1/6 | 6/6 |
| 지정한 표정 | 따름 | 따름 (표정을 문장으로 적으면 참조 미소로 쏠리지 않음) |
| "seen from the side" 장면 | 옆모습 | 카메라 쪽으로 돌아섬 (참조가 정면 상반신뿐이라서) |

R27: 시트 확정 시 정면 상반신, 정면 전신, 측면, 뒷모습 영역을 자동 탐지(`findSheetRegions`)해 `referenceSheet.regions`에 저장. 장면 프롬프트로 고름(`pickSheetRegion`: from behind/뒷모습 → back, from side/profile/옆모습 → side, upper body/close-up/상반신 → 참조 영역, full body/walking/standing/전신 → front_full, 그 외 참조 영역). Krea 2는 고른 영역을 캐릭터 참조로 자동 연결. 실제 앱 경로(characterId)로 비교.
- 승무원(측면, 뒷모습 탐지됨): 측면 장면이 진짜 옆모습 전신, 뒷모습 장면이 진짜 뒷모습. 정면 영역만 쓸 때는 둘 다 카메라를 향함. 전신 장면은 스타킹, 구두까지 시트와 일치.
- 간호사(측면, 뒷모습 미탐지): 전신 장면에 흰 니삭스, 신발이 추가로 맞음. 측면, 뒷모습 장면은 참조 영역으로 대체되어 정면을 봄(탐지 실패 시 예상 동작).
- 탐지 정확도(실제 시트 21장): 정면 18/21. 측면, 뒷모습은 Krea 2 시트에서 대체로 정확, SDXL 표정 모음 시트에서는 못 찾는 경우가 많음(오탐 대신 미탐지).

## 일관성 시트 GPU 엔진 (Krea 2)

일관성 시트 페이지의 `생성 엔진`에서 `Krea 2 (사내 GPU · 무료)`를 고르면 GPT-Image-2(fal.ai, 유료) 대신 Krea 2로 생성. 앱의 일반 생성 경로(`/api/generate/stream`)를 그대로 타므로 GPU 워커 배정, 모델 확인, 업로드가 이미지 생성 탭과 같음. 결과는 같은 시트 갤러리에 저장(`model: krea2_... (GPU)`).
- 대상: `GPU 워커 (3060 등)` 또는 `이 PC`(앱을 띄운 PC의 ComfyUI).
- 캐릭터, 배경 시트: 프롬프트로 생성. 레퍼런스가 있으면 첫 장만 Krea 2 캐릭터 참조로 사용(노드가 참조를 최대 2장 받음).
- 장면: 캐릭터 시트는 정면 전신 영역을 자동으로 잘라 인물 참조, 배경 시트는 4분할의 첫 칸을 장소 참조로 써서 Krea 2 두 참조 편집(장소 aligned, 인물 beside)으로 "이 인물을 이 장소에". 복장 참조는 쓰지 않음.
- 크기 고정: 시트 1024×1024, 장면 768×1344(Krea 2는 약 1MP 학습). 3060 기준 시트 약 1분, 장면 약 2분.
- 모델 파일 이름은 `CONSISTENCY_SHEET_GPU_MODEL`(기본 `krea2_turbo_fp8_scaled.safetensors`).

### 로컬 GPU(예: RTX 4080 PC)에서 쓰기
1. 그 PC에 image-gen과 ComfyUI 설치(이미지 생성 탭 로컬 생성과 같은 준비).
2. `install-local-models.bat`(기본 그룹 image, krea2): Krea 2 Turbo fp8, Qwen3-VL fp8 인코더, VAE, Identity Edit LoRA, `comfyui-krea2edit` 노드를 받음. Civitai 키 필요(LoRA).
3. 앱에서 일관성 시트 → 생성 엔진 `Krea 2` → `이 PC`. 이미지 생성 탭도 대상 `로컬`로 Krea 2 사용 가능.
4. 4080은 VRAM 16GB라 fp8 본체가 통째로 올라가고 fp8 연산도 지원해 3060보다 훨씬 빠를 것으로 예상(미측정).
- 그 PC를 사내 공용 GPU 워커로 붙이려면 `worker-kit/windows` 키트를 설치하면 됨(docs/gpu-workers.md). 그러면 다른 맥에서도 `GPU 워커` 대상으로 그 4080을 씀.

