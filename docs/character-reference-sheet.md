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
   - GPU 워커: `모델 받기` 버튼(헬퍼 다운로드 경로). 노드는 워커 PC에서 최신 worker-kit으로 `start-worker.bat` 재실행.
4. `후보 4장 생성` → 결과 중 하나 `이걸로 확정`.
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
| IP-Adapter | `ip-adapter-plus_sdxl_vit-h.safetensors` (h94/IP-Adapter `sdxl_models/`) | `models/ipadapter/` | 848MB |
| CLIP Vision | `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors` (h94/IP-Adapter `models/image_encoder/model.safetensors`를 이 이름으로 저장) | `models/clip_vision/` | 2.5GB |

핀 위치(셋 동기 유지): `src/lib/character-sheet.ts`(`IPADAPTER_NODE_REPO`, `IPADAPTER_MODEL`, `IPADAPTER_CLIP_VISION`), `comfyui-config/custom-nodes.json`, `worker-kit/windows/custom-nodes.json`.

누락 감지: 그래프 빌드 전에 `/object_info`로 노드와 파일 콤보를 확인. 없으면 큐에 넣기 전에
`[IP-Adapter · 기준 시트 BETA] ... 커스텀 노드가 없습니다` / `... 모델 파일이 없습니다: <경로>` 오류로 중단(스타일 참조는 `[IP-Adapter · 스타일 참조]`).
파일 선택 규칙(`pickIpAdapterFiles`): SDXL, FaceID 제외, `plus_sdxl_vit-h` 우선, ViT-H 어댑터는 ViT-H 인코더, 일반 `ip-adapter_sdxl`은 bigG 인코더.

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
