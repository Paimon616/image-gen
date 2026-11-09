# GPU 워커: 동료 PC GPU를 원격 ComfyUI 백엔드로 쓰기

동료 윈도우 PC(RTX 4080, RTX 3060)를 이 앱의 원격 ComfyUI 백엔드로 붙이는 구조.
워크플로, 모델, 노드 관리는 marc가 맥에서 하고, 동료 PC는 GPU만 빌려 줌.
동료는 bat 하나로 켜고 끄기만 함.

## 결론 요약

| 항목 | 결정 |
| --- | --- |
| 동료 PC 준비 | `worker-kit/windows/start-worker.bat` 하나. 첫 실행 때 ComfyUI 포터블 설치, 방화벽 규칙(관리자 승인 1회), 실행까지 자동 |
| 네트워크 | 사내망 직접 접속. Windows 방화벽에서 8188 포트를 marc 맥 IP에만 허용, 공인망 개방 없음 |
| 앱 | 생성 대상에 `GPU 워커` 추가. 서버가 워커마다 헬스체크, 대기열, 모델 보유를 보고 배정 |
| 배정 규칙 | 한 장은 GPU 하나에서만 생성. 4080 우선, 4080에 2장 이상 쌓이면 3060이 넘치는 작업을 받음. 미리보기, 업스케일 같은 가벼운 작업은 쉬고 있는 3060 먼저 |
| 모델 동기화 | 선택 사항. 맥에서 `npm run gpu-worker:depot`을 켜 두면 워커가 켜질 때 받아 감. 안 쓰면 모델 파일을 손으로 복사 |
| SwarmUI | 쓰지 않음(아래 비교) |

## 지금 앱이 ComfyUI를 부르는 방식 (조사 결과)

- 기본 주소 `COMFYUI_BASE_URL`(기본 `http://127.0.0.1:8188`). RunPod 팟은 `ComfyClientOptions.baseUrl`로 같은 코드 경로를 탐.
- 생성 흐름(`src/app/api/generate/stream/route.ts`)
  1. `/ws?clientId=` 웹소켓으로 진행률 수신
  2. `buildDefaultWorkflow`로 API 포맷 워크플로를 만들어 `POST /prompt`
  3. `/history/{id}` 폴링으로 결과 참조 확보
  4. `/view`로 이미지를 받아 맥의 `output/`에 저장(갤러리, 메타데이터 모두 맥에 남음)
- 참조 이미지는 `POST /upload/image`로 원격 ComfyUI에 업로드. 동료 PC의 파일 시스템에 직접 접근하지 않음.
- 클라이언트 큐(`generation-queue-store.ts`)는 지금까지 한 번에 1건만 실행.
- 앱 서버는 `127.0.0.1`에만 바인딩되고 인증이 없음. 그래서 동료 PC가 앱에 직접 접속하게 만들지 않음.

## 구조

```
 marc 맥                                            동료 PC (사내망)
 ┌──────────────────────────────┐                  ┌─────────────────────────────┐
 │ image-gen (127.0.0.1:5353)   │  HTTP + WS 8188  │ ComfyUI 포터블 (--listen)   │
 │  /api/generate/stream ───────┼─────────────────>│  RTX 4080 (primary)         │
 │   └ gpu-workers 배정         │                  └─────────────────────────────┘
 │  /api/gpu-workers (상태)     │                  ┌─────────────────────────────┐
 │                              ├─────────────────>│ ComfyUI 포터블 (--listen)   │
 │ gpu-worker-depot (5354, 선택)│<── 모델/노드 ────│  RTX 3060 (light)           │
 └──────────────────────────────┘    pull (토큰)   └─────────────────────────────┘
```

- 앱 → 워커: ComfyUI 표준 API(`/prompt`, `/ws`, `/history`, `/view`, `/upload/image`, `/queue`, `/system_stats`, `/models/{folder}`). RunPod와 같은 코드 경로를 쓰고 `remoteKind: "gpu-worker"`로 구분함. RunPod 전용 헬퍼(:3000) 조회는 건너뜀.
- 워커 → depot(선택): 워커가 켜질 때 manifest와 모델을 끌어감. 맥에서 동료 PC로 밀어 넣는 경로는 없음.

## 앱 쪽 구현

| 파일 | 역할 |
| --- | --- |
| `src/lib/gpu-worker-dispatch.ts` | 순수 배정 로직(I/O 없음). `chooseGpuWorker`, `classifyWorkload`, `requiredModelFiles`, `missingModelFiles` |
| `src/lib/gpu-worker-dispatch.test.ts` | `npm test` (node --test) |
| `src/lib/gpu-workers.ts` | 프로브(`/system_stats`, `/queue`, 2초 캐시), 모델 목록(`/models/{folder}`, 30초 캐시), 예약 카운트, prompt→워커 매핑(취소용), 포화 시 대기 |
| `src/app/api/gpu-workers/route.ts` | `GET` 워커 상태, `POST {action:"refresh-models"}` 모델 캐시 비우기 |
| `src/app/api/generate/stream/route.ts` | `generationTarget: "workers"` 처리. 워커 임대 → 웹소켓 연결 실패 시(큐 등록 전) 다음 워커로 → 완료/실패/취소 시 반납. SSE `worker` 이벤트로 배정된 워커 알림 |
| `src/app/api/generate/cancel/route.ts` | 워커에 보낸 prompt는 그 워커로 취소 전달 |
| `src/lib/generation-queue-store.ts` | `workers` 대상일 때 워커 슬롯 수만큼 병렬 실행. 로컬, RunPod는 기존처럼 1건씩 |
| `src/components/gpu-worker-status.tsx` | 생성 화면의 워커 상태(켜짐/꺼짐, GPU, 대기열) |
| 설정 > 팟 탭 > GPU 워커 | 워커 목록 JSON 편집 (`.local/settings.json`의 `gpuWorkers`) |

### 워커 등록

- 팀 공용: [data/default-gpu-workers.json](../data/default-gpu-workers.json)에 커밋. pull만 받으면 누구나 같은 워커가 보임. `.local/settings.json`에 `gpuWorkers`가 비어 있을 때 이 파일을 씀.
- 개인 덮어쓰기: 설정 > 팟 탭 > GPU 워커에 저장하면 그 목록이 우선.

### 여러 사람이 한 워커를 같이 쓸 때

- 각자 맥에서 image-gen을 돌리고 같은 워커 URL을 씀. ComfyUI 대기열이 도착 순서대로 처리.
- 각 앱은 자기 `clientId`와 `prompt_id`로 진행률과 결과만 받음. 결과는 각자 맥의 `output/`에 저장.
- 배정 시 `/queue` 깊이에 상대 작업도 잡혀서, maxQueue에 도달하면 대기.
- 취소는 `/interrupt`에 `prompt_id`를 실어 보냄. 내 작업이 실행 중일 때만 멈추고, 남의 작업은 건드리지 않음.
- 워커의 `worker-config.json`의 `allowFrom`은 IP 또는 CIDR. 현재 3060 PC1(`10.202.97.111`)은 `10.202.0.0/16`(사내 10.202.x.x 전체)로 열어 둠. 로그인이 없어 그 대역 누구나 GPU 사용과 출력 열람이 가능하므로, 사용자가 정해지면 좁히는 것을 권장.
- depot은 한 사람(marc)만 켜면 됨.

### 워커 등록 예시

```json
[
  { "id": "rtx4080", "label": "4080 (동료A)", "url": "http://10.0.0.80:8188",
    "role": "primary", "speed": 1, "maxQueue": 3, "enabled": true },
  { "id": "rtx3060", "label": "3060 (동료B)", "url": "http://10.0.0.60:8188",
    "role": "light", "speed": 0.4, "maxQueue": 2, "enabled": true }
]
```

- `speed`: 4080 기준 상대 처리량. 첫 측정 후 실제 값으로 바꿈(예: 4080 6초, 3060 15초면 0.4).
- `maxQueue`: 워커가 동시에 들고 있을 최대 작업 수(실행 중 + 대기). 클라이언트 병렬 수 = 켜진 워커의 maxQueue 합.
- 맥 로컬 ComfyUI도 `http://127.0.0.1:8188`, `role: "light"`, 낮은 speed로 넣을 수 있음.

### 배정 규칙

- 대상 제외: 비활성, 꺼짐(프로브 실패), 필요한 체크포인트/LoRA/VAE가 없음, maxQueue 도달.
- full 작업: `(부하 + 1) / speed`가 가장 작은 워커. 동률이면 primary. 부하는 `max(ComfyUI 대기열, 앱이 보낸 작업 수)`라서 프로브 지연 중 몰림을 막음.
  - 4080(1.0)과 3060(0.4)이면 4080이 2장을 들고 있을 때부터 3060이 받음.
- light 작업: 쉬는 light 워커 먼저, 없으면 full 규칙. 자동 분류: 768x768 이하, 또는 8스텝 이하 1MP 이하. 하이레스 켜짐은 full. 요청에 `workload`를 주면 그 값이 우선.
- 전부 maxQueue로 차 있으면 실패하지 않고 1초 간격으로 대기(기본 최대 30분, `GPU_WORKER_MAX_WAIT_MS`). 꺼짐이나 모델 없음만 남으면 바로 실패하고 이유를 표시.
- 한 장을 여러 GPU로 쪼개지 않음. 처리량만 늘고 한 장 속도는 그대로. 한 장 속도는 Lightning, DMD2 같은 저스텝 모델이나 TensorRT 쪽에서 해결.

### 가짜 워커로 검증한 결과

맥에서 가짜 ComfyUI 2대(4초/장, 10초/장)와 꺼진 워커 1대를 등록하고 `bench-gpu-workers.mjs`로 8건을 동시에 보냄.

- 4080 역할 5건, 3060 역할 3건 배정. 꺼진 워커 건너뜀. 포화 구간은 대기 후 배정. 8/8 성공
- 4080, 3060에 없는 LoRA를 넣은 요청은 `missing-files` 사유와 함께 즉시 거부
- 생성 화면 `GPU 워커` 토글과 상태 목록 표시 확인

## 동료 PC 쪽 (worker-kit/windows)

| 파일 | 역할 |
| --- | --- |
| `start-worker.bat` | 켜기. 첫 실행 때 포터블 설치(~2GB)와 방화벽 규칙(관리자 승인 1회), depot이 설정돼 있으면 동기화, 그다음 백그라운드 실행 |
| `stop-worker.bat` | 끄기. GPU 즉시 해제 |
| `uninstall-worker.bat` | 방화벽 규칙 제거. 그다음 폴더 삭제로 완전 제거 |
| `worker-config.json` | marc가 채워서 전달. `allowFrom`(marc 맥 IP)은 필수, `depotUrl`/`token`은 선택 |
| `worker.ps1`, `firewall.ps1` | 실제 로직. PowerShell 5.1 호환, ASCII와 CRLF |

ComfyUI 실행 인자: `--listen 0.0.0.0 --port 8188 --base-directory <kit>\data --disable-auto-launch --disable-api-nodes`.
모델, 커스텀 노드, 입출력이 전부 키트 폴더 안 `data\`에 있음.

### 모델 받기 (앱에서 버튼으로)

- 키트의 `helper.py`가 ComfyUI 옆에서 3000번 포트로 함께 뜸. RunPod 헬퍼와 같은 API(`/api/runpod/helper/status|files|download|download/stream|catalog|model-capabilities`) 중 모델 확인, 다운로드에 필요한 부분만 구현(파이썬 표준 라이브러리, 포터블 내장 파이썬으로 실행).
- 앱은 워커 id를 팟처럼 취급(`getRunpodPod`가 `gpuWorkers`도 찾음). 그래서 RunPod와 같은 확인과 다운로드 경로를 그대로 탐.
- 생성 화면에서 `GPU 워커`를 선택하면 워커 목록 아래 "모델 파일" 확인 버튼, 누락 목록, "다운로드 N개" 버튼이 보임. 생성 버튼을 눌러도 먼저 확인함(헬퍼가 응답하지 않으면 확인을 건너뛰고 생성 진행).
- 다운로드는 Civitai, HF에서 워커 PC로 바로 받음. 토큰은 요청마다 맥에서 전달(RunPod 팟과 같은 방식). 쓰기는 `data\models` 안으로만 제한, https만 허용, 다른 호스트로 리다이렉트될 때는 토큰을 떼고 보냄.
- 회사망 TLS 검사 인증서 대응: 파이썬 3.13+의 엄격 X.509 검증만 끄고 체인과 호스트명 검증은 유지.

### 모델, 노드 맞추기 (depot, 선택)

- 방법 A(권장): depot. 맥에서
  ```bash
  GPU_WORKER_TOKEN=$(openssl rand -hex 24) GPU_DEPOT_ALLOW=10.0.0.80,10.0.0.60 npm run gpu-worker:depot
  ```
  - `data/gpu-worker-profile.json`에 워커가 받을 커스텀 노드 이름과 모델 키(`checkpoints/x.safetensors`, `loras/y.safetensors`)를 적음.
  - ComfyUI 코어 커밋은 `comfyui-config/comfyui-version.txt`, 노드 커밋은 `comfyui-config/custom-nodes.json`의 고정값을 따름.
  - 맥에 파일이 있으면 맥에서 직접, 없으면 `model-catalog.json`의 source_url에서 맥이 대신 받아 전달. Civitai와 HF 토큰은 맥에만 있음.
  - 프로필 밖 파일은 내려주지 않음. 경로 우회(`..`) 차단, 토큰과 허용 IP 확인.
  - 워커는 manifest에 없는 커스텀 노드를 `custom_nodes_disabled`로 옮김. ComfyUI-Manager는 설치하지 않음(원격 임의 설치 경로 차단).
- 키트 고정 노드: `worker-kit/windows/custom-nodes.json`. marc가 키트 안에 커밋으로 고정한 목록(현재 `ComfyUI_IPAdapter_plus` 하나, 기준 시트 BETA용). `start-worker.bat`(또는 `worker.ps1 nodes`) 실행 시 그 PC에서만 설치. github.com https + 40자리 커밋 해시만 허용, 원격에서 추가, 변경 불가. depot 동기화도 이 목록은 비활성화하지 않음. 자세한 내용은 [character-reference-sheet.md](character-reference-sheet.md).
- 방법 B: 앱의 다운로드 버튼(위). 방법 C: 모델 파일을 `data\models\checkpoints`, `data\models\loras`에 직접 복사.
- 동기화 뒤에는 앱의 모델 캐시가 30초 안에 갱신됨. 바로 반영하려면 `POST /api/gpu-workers {"action":"refresh-models"}`.

## 네트워크와 보안

- 사내망 직접 접속. ComfyUI에는 로그인이 없으므로 포트 접근 제한이 유일한 보호막.
  - `firewall.ps1`: 8188 인바운드를 `allowFrom` 주소 + 키트의 python.exe로만 허용. 모든 프로필에 적용(도메인 미가입 PC는 사내망도 Public으로 잡히는 경우가 많아서). 제한은 주소 필터가 담당하고, 나머지 인바운드는 Windows 기본값으로 차단.
  - "python.exe 허용" 창에서 허용이나 취소를 눌러 생긴 규칙(전체 허용, 또는 우리 규칙을 덮는 차단)은 `start-worker.bat`이 감지해서 다시 정리함.
  - 공유기나 회사 방화벽에서 포트를 열지 않음. 외부에서 접근하는 경로 없음.
  - marc 맥 IP가 DHCP로 바뀌면 `worker-config.json`의 `allowFrom`을 고친 뒤 `firewall.ps1`을 다시 실행. 맥 IP를 사내 DHCP 예약으로 고정하는 편이 편함.
- 동료 파일 접근
  - 앱은 ComfyUI API만 씀. `/view`, `/upload`는 ComfyUI의 input/output/temp 폴더(= 키트 안 `data\`)로 제한됨.
  - 커스텀 노드는 동료 계정 권한으로 도는 파이썬 코드라서 고정 커밋의 목록만 허용. 더 강한 격리가 필요하면 별도 로컬 표준 계정으로 실행(예: 작업 스케줄러 "다른 사용자로 실행")하거나 WSL2 배포판으로 옮기는 2단계 옵션.
  - 키트는 자기 폴더 밖에 쓰지 않음(방화벽 규칙 제외).
- 켜고 끄기는 동료가 결정. 꺼져 있으면 앱이 그 워커를 건너뜀. 생성 중에 끄면 해당 작업만 실패하고 다음 작업은 다른 워커로 감.
- 그래픽 작업 중 VRAM 경쟁: 동료가 GPU를 쓸 때는 끄도록 안내. 필요하면 `extraArgs`에 `--lowvram`이나 `--reserve-vram 2` 추가.

## SwarmUI 비교

| | 자체 디스패처(채택) | SwarmUI |
| --- | --- | --- |
| 기존 워크플로 빌더 | 그대로 사용(`buildDefaultWorkflow`, Krea, PuLID, ADetailer 등) | Swarm 파라미터 체계로 다시 매핑하거나 raw 워크플로 경로를 따로 구현 |
| 다중 백엔드 | 4080/3060 역할, 속도 가중, 모델 보유 확인 | 백엔드 풀과 기본 부하 분산 지원 |
| 결과 저장 | 기존 갤러리, 메타데이터 그대로 | Swarm 출력 경로에서 다시 회수 |
| 추가 구성 요소 | 없음 | .NET 서버 하나 더 운영, 인증 별도 |
| 동료 PC | ComfyUI만 | ComfyUI(또는 Swarm 백엔드) 동일 |

이 앱은 ComfyUI API 포맷 워크플로를 직접 만들고 결과를 자체 갤러리로 관리함. 그래서 Swarm을 끼우면 이점보다 이중 관리가 큼. 나중에 사내 여러 사람이 공용 GPU 풀을 쓰게 되면 그때 다시 검토.

## 첫 시험 계획

맥에서 앱(`npm run local` 또는 `npm run dev`)을 켜고, 워커를 등록한 뒤 실행.

1. 4080 단독, 1024px SDXL(Illustrious + LoRA)
   ```bash
   node scripts/bench-gpu-workers.mjs --app http://127.0.0.1:5353 --target workers \
     --model hassakuXLIllustrious_v22.safetensors --lora <캐릭터LoRA>.safetensors:0.8 \
     --size 1024x1024 --steps 28 --jobs 5 --concurrency 1 --warmup 1 --json bench-4080.json
   ```
   - 3060은 설정에서 `enabled: false`. warmup 1장은 모델 로딩 시간이라 제외.
   - 기록: 장당 총 시간(맥 기준 끝에서 끝), 첫 스텝까지 시간, VRAM.
   - 832x1216(세로)도 같은 방식으로 1회.
2. 동시 요청, 4080 단독: `--jobs 8 --concurrency 4`. 대기 시간 p50, p95 확인.
3. 3060 추가(`enabled: true`): 2와 같은 조건 재측정. 처리량(img/min)과 p95 변화 비교. 3060 단독 1장 시간으로 `speed` 보정.
4. light 경로: `--workload light --size 768x768 --steps 8`로 3060 배정 확인.

참고 비교선: Character.AI 4장 약 3초, 제타 1장 약 5초, 크랙 1024x1536 1장 34~39초.

## 남은 일

- 실제 동료 PC 설치와 측정(동료 확인 후).
- 측정값으로 `speed`, `maxQueue` 보정.
- Lightning, DMD2 저스텝 체크포인트 프로필 추가 후 같은 벤치로 비교.
- `/api/generate`(비스트리밍 경로)와 비디오 큐는 워커 대상 미지원(이미지 스트림 경로만).
