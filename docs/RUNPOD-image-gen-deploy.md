# RunPod: Image Gen 배포 가이드

RunPod Pod 안에서 ComfyUI와 Image Gen(Next.js UI)을 함께 실행하여,
Pod 내부 localhost 통신으로 직접 연결하는 방법을 설명한다.

## 개념도

```text
┌─────────────────── RunPod Pod ───────────────────┐
│                                                   │
│  ┌─────────────┐       ┌──────────────────────┐  │
│  │   ComfyUI   │       │     Image Gen        │  │
│  │  (port 8188)│◄─────►│  Next.js (port 3000) │  │
│  │  Python     │  HTTP │  Node.js             │  │
│  └─────────────┘       └──────────────────────┘  │
│        │                        │                │
│        │                        │                │
│  /workspace/ComfyUI     /workspace/image-gen     │
│  ├── models/            ├── src/                 │
│  ├── output/            ├── workflows/           │
│  └── custom_nodes/      └── .env.local           │
│                                                   │
│  Network Volume: /workspace (Pod 껐다 켜도 유지)  │
└───────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
   ComfyUI Proxy            Image Gen Proxy
   :8188                    :3000
```

Image Gen이 Pod 안에서 ComfyUI의 `127.0.0.1:8188`로 직접 호출한다.
외부 네트워크 지연이 없고, 인증이나 터널링이 필요 없다.

## 사전 조건

### 1. Pod 포트 설정

RunPod → Pod 생성/수정 시 다음 포트를 노출해야 한다:

| 포트 | 용도 |
|-----|------|
| `8188` | ComfyUI |
| `3000` | Image Gen (Next.js) |
| `8888` | Jupyter (선택, 디버깅용) |

> RunPod의 "HTTP Service Port"로 `3000`를 추가한다.
> Edit Pod → Expose HTTP Ports → `3000,8188,8888`

### 2. Pod 구성 권장값

```text
Container disk: 100GB (이미지 빌드/캐시용)
Network Volume: 250GB 이상 (모델, output, image-gen 소스 보관)
Mount path: /workspace
GPU: 48GB VRAM 권장 (L40S, RTX 6000 Ada, A6000)
```

## 설치 순서

### Step 1: Pod 시작 후 Jupyter Terminal 열기

RunPod에서 Pod를 Start하고 Jupyter 또는 SSH Terminal을 연다.

### Step 2: Image Gen 저장소 clone

```bash
cd /workspace
git clone <your-image-gen-repo-url> image-gen
cd image-gen
```

> 이미 `/workspace/image-gen`이 있으면 `git pull`로 최신 코드를 받는다:
> ```bash
> cd /workspace/image-gen
> git pull
> ```

### Step 3: 배포 스크립트 실행

**처음 설치하는 경우** (Node.js 설치 + npm install + build + 시작):

```bash
cd /workspace/image-gen
bash scripts/runpod-deploy.sh
```

이 스크립트가 수행하는 작업:
1. Node.js 22 LTS 설치 (없는 경우)
2. `npm install` — 의존성 설치
3. `.env.local` 생성 — ComfyUI 연결 정보 설정
4. ComfyUI 연결 확인
5. `npm run build` — Next.js 프로덕션 빌드
6. `npm run start` — Image Gen 시작

### Step 4: 접속

Image Gen이 시작되면 다음 URL로 접속한다:

```text
https://<pod-id>-3000.proxy.runpod.net
```

`<pod-id>`는 RunPod Pod 상세 페이지에서 확인할 수 있다.

## 이후 실행 (Pod 재시작 시)

Pod를 Stop 했다가 다시 Start한 후에는 빌드 없이 바로 시작할 수 있다:

```bash
cd /workspace/image-gen
bash scripts/runpod-start.sh
```

이 스크립트는:
1. ComfyUI가 실행 중이 아니면 백그라운드에서 시작
2. Image Gen(Next.js)을 포어그라운드에서 시작
3. `Ctrl-C`로 두 프로세스를 함께 종료

## 환경 변수

`.env.local`이 자동으로 생성된다. 필요하면 직접 수정:

```bash
# ComfyUI 연결 (Pod 내부 localhost)
COMFYUI_BASE_URL=http://127.0.0.1:8188

# ComfyUI 모델 디렉토리
COMFYUI_MODELS_DIR=/workspace/ComfyUI/models

# 비디오 생성 워크플로우
COMFYUI_VIDEO_WORKFLOW_PATH=workflows/ltx23-10eros-t2v-api.json

# 타임아웃 (밀리초)
COMFYUI_TIMEOUT_MS=1800000
```

환경 변수를 override하려면 스크립트 실행 전에 export:

```bash
export COMFYUI_VIDEO_WORKFLOW_PATH=workflows/wan22-i2v-base-api.json
bash scripts/runpod-start.sh
```

## Image Gen에서 ComfyUI 워크플로우 사용하기

Image Gen의 Video 페이지는 `.env.local`의 `COMFYUI_VIDEO_WORKFLOW_PATH`에 지정된
JSON 파일을 ComfyUI API 워크플로우로 사용한다.

현재 포함된 워크플로우:

| 파일 | 모델 | 용도 |
|------|------|------|
| `workflows/ltx23-10eros-t2v-api.json` | LTX 2.3 10Eros | Text-to-Video |
| `workflows/wan22-i2v-base-api.json` | Wan 2.2 I2V | Image-to-Video |
| `workflows/wan22-i2v-civitai-133468541-api.json` | Wan 2.2 I2V + LoRA | Image-to-Video (Civitai) |

워크플로우를 바꾸려면:

```bash
# .env.local 수정
sed -i 's|COMFYUI_VIDEO_WORKFLOW_PATH=.*|COMFYUI_VIDEO_WORKFLOW_PATH=workflows/wan22-i2v-base-api.json|' /workspace/image-gen/.env.local

# Image Gen 재시작
# (Ctrl-C로 종료 후 다시 실행)
cd /workspace/image-gen
bash scripts/runpod-start.sh
```

## ComfyUI 직접 사용

Image Gen UI 외에도 ComfyUI 자체 UI를 직접 쓸 수 있다:

```text
https://<pod-id>-8188.proxy.runpod.net
```

Image Gen과 ComfyUI는 같은 Pod 안에서 독립적으로 실행되므로, 두 UI를 동시에 사용할 수 있다.
단, 같은 ComfyUI 인스턴스를 공유하므로 동시에 여러 생성을 큐에 넣으면 순차 처리된다.

## 백그라운드 실행 (터널 종료 후에도 유지)

Jupyter Terminal을 닫아도 서버를 유지하려면 `nohup` 또는 `tmux`를 사용한다:

### tmux 사용 (권장)

```bash
# tmux 설치 (없는 경우)
apt-get install -y tmux

# 세션 생성
tmux new -s image-gen

# 세션 안에서 실행
cd /workspace/image-gen
bash scripts/runpod-start.sh

# 세션에서 분리: Ctrl-B, D
# 세션 재연결:
tmux attach -t image-gen
```

### nohup 사용

```bash
cd /workspace/image-gen
nohup bash scripts/runpod-start.sh > /workspace/image-gen-runpod.log 2>&1 &

# 로그 확인:
tail -f /workspace/image-gen-runpod.log

# 종료:
pkill -f "npm run start"
pkill -f "python main.py"
```

## 문제 해결

### Image Gen 페이지가 안 열림

1. 포트 3000이 RunPod에 노출되어 있는지 확인
2. Image Gen 프로세스가 실행 중인지 확인:
   ```bash
   curl -s http://127.0.0.1:3000 | head -5
   ```
3. 로그 확인:
   ```bash
   tail -50 /workspace/image-gen-runpod.log
   ```

### ComfyUI 연결 오류

1. ComfyUI가 실행 중인지 확인:
   ```bash
   curl -s http://127.0.0.1:8188/system_stats | head -5
   ```
2. `.env.local`의 `COMFYUI_BASE_URL`이 `http://127.0.0.1:8188`인지 확인
3. ComfyUI 로그 확인:
   ```bash
   tail -50 /workspace/ComfyUI/comfyui.log
   ```

### 모델이 안 보임

1. `COMFYUI_MODELS_DIR`이 올바른지 확인:
   ```bash
   ls /workspace/ComfyUI/models/checkpoints/
   ls /workspace/ComfyUI/models/loras/
   ```
2. Image Gen 재시작 — 모델 목록은 시작 시 스캔한다

### 빌드 실��

```bash
cd /workspace/image-gen
rm -rf .next node_modules
npm install
npm run build
```

### 디스크 부족

```bash
df -h
du -sh /workspace/ComfyUI/models/*
du -sh /workspace/ComfyUI/output/*
# 불필요한 output 정리
rm -f /workspace/ComfyUI/output/*.mp4
```

## Pod Stop / 비용 절약

작업이 끝나면 Pod를 Stop한다:

```bash
# 서버 종료
# (실행 중인 터미널에서 Ctrl-C)

# RunPod 대시보드에서 Pod Stop
```

- Stop 상태에서는 GPU 비용이 발생하지 않는다
- Network Volume(/workspace)은 유지되므로 모델, output, image-gen 소스가 보존된다
- 다음 작업 시 Pod Start → `bash scripts/runpod-start.sh`로 바로 실행
