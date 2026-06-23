# RUNPOD: LTX 2.3 ComfyUI Setup Notes

## Overview

RunPod에서 개인용 LTX 2.3 영상 생성 환경을 구성하기 위한 진행 기록과 운영 기준이다.

목표는 다음과 같다.

- RunPod Pod에서 ComfyUI 기반 LTX 2.3 영상 생성
- Pod를 껐다 켜도 모델/LoRA/output을 유지할 수 있는 Network Volume 구성
- GPU availability 문제로 기존 Pod를 resume하지 못할 때 새 Pod로 복구 가능한 구조
- 초기 생성 테스트 후 CivitAI 계열 checkpoint/LoRA 추가

## Current Decision

| 항목 | 결정 |
|---|---|
| Provider | RunPod |
| 실행 방식 | GPU Cloud Pod |
| UI | ComfyUI |
| Video model family | LTX 2.3 |
| Template 후보 | `LTX-2.3 NSFW` community template 또는 Official ComfyUI |
| 빠른 테스트 | `LTX-2.3 NSFW` template |
| 안정적 장기 운영 | Official ComfyUI + 직접 LTX 설치 |
| Container disk | `600GB` |
| Network Volume | `250GB`로 시작, 부족하면 `500GB`로 증가 |
| Mount path | `/workspace` |
| ComfyUI port | `8188` |
| Jupyter port | `8888` |

## Cost Model

RunPod 비용은 생성 버튼을 누른 시간만 기준이 아니다.

| 상태 | GPU 비용 | Storage 비용 |
|---|---:|---:|
| Pod Running/Starting | 발생 | 발생 |
| Pod Stopped | 중지 | Network Volume은 계속 발생 |
| 파일 업로드만 하는 중 | 발생 | 발생 |
| Network Volume 보관만 하는 중 | 없음 | 발생 |

운영 원칙:

- 작업할 때만 Pod를 켠다.
- 다운로드, 업로드, 생성, 결과 확인이 끝나면 바로 `Stop`한다.
- Network Volume은 보관용이므로 Pod를 꺼도 비용이 계속 든다.
- 1TB 미만 Network Volume은 대략 `$0.07/GB/month` 기준으로 계산한다.

예상 Network Volume 비용:

| Size | 대략 월 비용 |
|---:|---:|
| 250GB | `$17.50/month` |
| 500GB | `$35.00/month` |

## Storage Lessons

초기 구성에서 가장 크게 헷갈린 부분은 `Volume disk`와 `Network Volume`의 차이다.

| 항목 | 의미 | 새 Pod 재사용 |
|---|---|---|
| Container disk | 컨테이너 내부 임시/실행 영역 | 불안정, Pod lifecycle 영향 |
| Volume disk | Pod에 묶인 persistent disk | 새 Pod attach 용도로 부적합 |
| Network Volume | 독립 storage resource | 가능 |

중요:

- 새 Pod에 다시 붙일 수 있는 것은 **Network Volume**이다.
- RunPod `Storage` 화면에 Network Volume 항목이 보여야 진짜 Network Volume이 만들어진 것이다.
- 기존 화면에 `Create Network Volume`만 보이고 목록이 비어 있었다면 아직 Network Volume이 없던 상태다.
- `Automatically create`는 기존 Network Volume이 없을 때만 사용한다.
- 기존 Network Volume을 재사용할 때는 `Automatically create`가 아니라 기존 volume 이름을 선택해야 한다.

## Data Center Constraint

Network Volume은 같은 data center의 Pod/GPU에 붙이는 것이 기본 전제다.

예:

```text
Network Volume data center: US-IL-1
New Pod GPU data center:   US-IL-1
```

GPU를 먼저 고르면 Network Volume 선택이 비활성화되거나 기존 volume이 안 보일 수 있다.

안전한 순서:

1. Network Volume의 data center 확인
2. 새 Pod region을 해당 data center로 고정
3. 그 data center 안에서 available GPU 선택
4. Storage에서 기존 Network Volume 선택

## Recommended GPU Order

LTX 2.3은 48GB급 VRAM이 안정적이다.

추천 순서:

1. `L40S 48GB`
2. `RTX 6000 Ada 48GB`
3. `RTX A6000 48GB`
4. `A40 48GB`
5. `RTX 5090 32GB`
6. `RTX 4090 24GB` only for small/distilled tests

주의:

- `A5000 24GB`는 LTX 2.3에 빡빡할 수 있다.
- `A40 48GB`는 느리지만 가격이 낮고 VRAM이 충분해서 테스트용으로 가능하다.
- Region latency보다 GPU availability와 storage attach 가능성이 더 중요하다.

## Template Choice

### Option A: LTX-2.3 NSFW Community Template

Use when:

- 오늘 바로 LTX 2.3을 돌려보고 싶다.
- 이미 workflow/model/custom node가 들어간 환경이 필요하다.
- 초기 설정 시간을 줄이고 싶다.

Known properties:

```text
Template: LTX-2.3 NSFW
Docker image: docker.io/antilopax/ltx23:v9
```

Pros:

- LTX workflow가 이미 들어있을 가능성이 높다.
- ComfyUI custom node/model 설치 시간이 적다.
- 이전에 보던 화면과 이어서 사용하기 쉽다.

Cons:

- Community template이다.
- 디스크를 매우 많이 쓴다. 이전 시도에서 400GB 중 약 325GB까지 사용했다.
- Storage edit 후 부팅 루프가 발생한 적이 있다.
- Container disk는 최소 500GB 이상, 권장 600GB로 잡는 편이 안전하다.

### Option B: Official ComfyUI

Use when:

- 더 안정적인 기반이 필요하다.
- 직접 LTX node/model/workflow를 관리하고 싶다.
- Community template의 부팅 루프를 피하고 싶다.

Pros:

- 깨끗하고 예측 가능한 환경이다.
- 장기 운영에 더 적합하다.

Cons:

- LTX 2.3 모델, workflow, custom node를 직접 설치해야 한다.
- 첫 세팅 시간이 더 길다.

## New Pod Setup Checklist

새로 시작할 때 권장 설정:

```text
Type: GPU Cloud Pod
Template: LTX-2.3 NSFW 또는 Official ComfyUI
Container disk: 600GB
Persistent storage: Network Volume
Network Volume size: 250GB
Mount path: /workspace
Ports: 8188, 8888
GPU: 48GB VRAM preferred
```

배포 전 확인:

- Storage type이 `Network volume`인지 확인한다.
- `Volume disk`로 되어 있으면 새 Pod 재사용 목적에 맞지 않는다.
- Network Volume을 새로 만드는 경우 `Automatically create`를 사용해도 된다.
- 생성 후 RunPod `Storage` 메뉴에 Network Volume이 보여야 한다.

## Known Failure Modes

### Pod resume failed: not enough free GPUs

Error:

```text
Pod resume failed: There are not enough free GPUs on the host machine to start this pod.
```

Meaning:

- 기존 Pod가 있던 host에 빈 GPU가 없다.
- 설정 문제라기보다 availability 문제다.
- Stop한 사이에 다른 사용자가 GPU를 점유했을 수 있다.

Action:

1. 5-10분 정도만 resume 재시도
2. 안 되면 새 Pod 생성
3. 기존 Network Volume이 있으면 같은 data center에서 새 Pod에 attach
4. 기존 Network Volume이 없으면 새 Network Volume으로 다시 시작

### Jupyter/ComfyUI stuck on Initializing

판단 기준:

- Logs가 계속 움직이면 기다린다.
- `No space left on device`, `failed`, `permission denied`가 보이면 중단한다.
- 같은 `start container ... begin` 류 로그만 반복되면 restart loop 가능성이 높다.

Action:

1. `Stop`
2. 30-60초 대기
3. `Start`
4. 5분 내 같은 로그 반복이면 새 Pod 재배포 고려

### No space left on device

원인:

- Container disk가 너무 작다.
- Community template이 기본 모델/cache를 매우 많이 설치한다.

Action:

- Container disk를 600GB로 잡는다.
- Network Volume은 모델/output 보관용으로 250GB 이상 잡는다.
- 큰 checkpoint 추가 전 `df -h`를 확인한다.

## First ComfyUI Test

초기 실행 후 잘못된 workflow를 선택하면 placeholder file 오류가 난다.

예:

```text
LoadImage: Invalid image file: your_image.png
VHS_LoadAudioUpload: Invalid file path: /app/ComfyUI/input/somerandommusic.mp3
```

이 경우 현재 workflow는 첫 테스트용이 아니다. 이미지와 오디오 입력을 요구하는 `Custom-Audio-Music-Video` workflow다.

첫 테스트는 Text-to-Video workflow를 사용한다.

추천 workflow 이름:

```text
LTX2_3_t2v
LTX2_T2V
Text to Video
```

피해야 할 workflow:

```text
Custom-Audio
Music-Video
I2V
Image to Video
```

첫 테스트 값:

```text
width: 768
height: 432
frames: 41
steps: 12-16
checkpoint: default
LoRA: default or none
```

실행 전 확인:

- 오른쪽 error panel에 빨간 오류가 없어야 한다.
- 이미지/오디오 placeholder 오류가 남아 있으면 실행하지 않는다.
- 첫 생성은 1개만 queue한다.

결과 위치:

```text
/workspace/ComfyUI/output
```

## Model And LoRA Plan

추가 예정 모델:

| Type | URL | modelVersionId |
|---|---|---:|
| LTX checkpoint | `https://civitai.red/models/2447875/ltx23-10eros?modelVersionId=2892069` | `2892069` |
| LoRA | `https://civitai.red/models/1811313/dr34ml4y-all-in-one-nsfw-wanltx2?modelVersionId=2950842` | `2950842` |
| LoRA | `https://civitai.red/models/2668916/nsfw-body-physics-fluid-motion-enhancer-or-lora-or-ltx23?modelVersionId=2996907` | `2996907` |

추천 순서:

1. 기본 workflow로 작은 영상 생성 성공 확인
2. LoRA 2개 추가
3. checkpoint 추가
4. `df -h`로 디스크 여유 확인
5. ComfyUI refresh/restart

## Download Commands

Jupyter Terminal에서 실행한다.

```bash
mkdir -p /workspace/ComfyUI/models/checkpoints
mkdir -p /workspace/ComfyUI/models/loras
```

Checkpoint:

```bash
cd /workspace/ComfyUI/models/checkpoints
curl -L "https://civitai.red/api/download/models/2892069" -o "LTX2.3_10Eros_v1.safetensors"
```

LoRAs:

```bash
cd /workspace/ComfyUI/models/loras
curl -L "https://civitai.red/api/download/models/2950842" -o "DR34ML4Y_All-In-One_NSF-W_WAN_LTX2.safetensors"
curl -L "https://civitai.red/api/download/models/2996907" -o "NSFW_Body_Physics_Fluid_Motion_Enhancer_LTX23.safetensors"
```

Check size:

```bash
du -h /workspace/ComfyUI/models/checkpoints/LTX2.3_10Eros_v1.safetensors
du -h /workspace/ComfyUI/models/loras/*.safetensors
df -h
```

If ComfyUI does not show the files, find the folders used by the current template:

```bash
find /workspace/ComfyUI/models -name "*ltx*fp8*.safetensors" -o -name "*22b*.safetensors"
find /workspace/ComfyUI/models -name "*lora*.safetensors" -o -name "*LoRA*.safetensors"
```

Then move the new files into the same folder as the already visible model files.

## PC Upload vs Pod Download

PC upload is acceptable for small LoRA files.

For large checkpoints, Pod-side download is preferred:

- PC upload can be slow.
- Browser upload can fail midway.
- Pod remains Running during upload, so GPU time cost continues.
- CivitAI/Hugging Face to RunPod direct download is usually faster.

## Operating Routine

작업할 때:

1. Pod Start
2. ComfyUI open
3. 필요한 모델/LoRA 확인
4. 작은 테스트 생성
5. 원하는 설정으로 생성
6. 결과 다운로드 또는 `/workspace/ComfyUI/output` 확인
7. 필요 없는 output 정리
8. Pod Stop

작업하지 않을 때:

- Pod는 Stop
- Network Volume은 유지
- 다음 작업 때 같은 data center에서 Network Volume attach

## Current Status

현재 진행 상태:

- 기존 Pod는 제거했다.
- 기존에는 진짜 Network Volume이 없었던 것으로 확인했다.
- 새 Network Volume 기반으로 다시 만드는 중이다.
- 계획 용량은 `Container disk 600GB` / `Network Volume 250GB`다.
- 초기화 완료 후 ComfyUI는 열렸다.
- 현재 선택한 `Custom-Audio-Music-Video` workflow는 placeholder image/audio 오류가 있어 첫 테스트용으로 부적합하다.
- 다음 단계는 `Text-to-Video` workflow로 작은 테스트 생성을 성공시키는 것이다.
