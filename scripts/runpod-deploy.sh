#!/usr/bin/env bash
set -euo pipefail

#
# RunPod Pod 내부에서 image-gen(Next.js)을 ComfyUI와 함께 실행하는 배포 스크립트.
#
# 전제:
#   - ComfyUI가 이미 Pod 안에서 8188 포트로 실행 중
#   - ComfyUI 모델 디렉토리: /workspace/ComfyUI/models
#   - Pod에 3000 포트가 외부 노출되어 있어야 함 (RunPod → Edit Pod → HTTP Service Port [3000])
#
# 사용법 (Pod Jupyter Terminal 또는 SSH 에서 실행):
#
#   cd /workspace
#   curl -fsSL https://raw.githubusercontent.com/<your-repo>/main/scripts/runpod-deploy.sh | bash
#
#   또는 직접 clone 후 실행:
#   git clone <repo-url> /workspace/image-gen
#   cd /workspace/image-gen
#   bash scripts/runpod-deploy.sh
#

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_GEN_PORT="${IMAGE_GEN_PORT:-3000}"
IMAGE_GEN_HOST="${IMAGE_GEN_HOST:-0.0.0.0}"
COMFYUI_BASE_URL="${COMFYUI_BASE_URL:-http://127.0.0.1:8188}"
COMFYUI_MODELS_DIR="${COMFYUI_MODELS_DIR:-/workspace/ComfyUI/models}"
COMFYUI_VIDEO_WORKFLOW_PATH="${COMFYUI_VIDEO_WORKFLOW_PATH:-workflows/ltx23-10eros-t2v-api.json}"
COMFYUI_TIMEOUT_MS="${COMFYUI_TIMEOUT_MS:-1800000}"

echo "========================================="
echo "  Image Gen — RunPod 배포 스크립트"
echo "========================================="
echo ""
echo "ROOT_DIR:                $ROOT_DIR"
echo "IMAGE_GEN_HOST:          $IMAGE_GEN_HOST"
echo "IMAGE_GEN_PORT:          $IMAGE_GEN_PORT"
echo "COMFYUI_BASE_URL:        $COMFYUI_BASE_URL"
echo "COMFYUI_MODELS_DIR:      $COMFYUI_MODELS_DIR"
echo "COMFYUI_VIDEO_WORKFLOW:  $COMFYUI_VIDEO_WORKFLOW_PATH"
echo ""

# --- 1. Node.js 확인 / 설치 ---
echo "[1/5] Node.js 확인 중..."
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js가 없습니다. 설치합니다..."
  # NodeSource를 통해 Node.js 22 LTS 설치
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

NODE_VERSION="$(node --version)"
NPM_VERSION="$(npm --version)"
echo "  Node.js: $NODE_VERSION"
echo "  npm:     $NPM_VERSION"

if ! command -v git >/dev/null 2>&1; then
  echo "  git가 없습니다. 설치합니다..."
  apt-get update && apt-get install -y git
fi

# --- 2. 의존성 설치 ---
echo ""
echo "[2/5] npm 의존성 설치 중..."
npm install

# --- 3. .env.local 생성 ---
echo ""
echo "[3/5] .env.local 생성 중..."
cat > "$ROOT_DIR/.env.local" <<EOF
COMFYUI_BASE_URL=$COMFYUI_BASE_URL
COMFYUI_MODELS_DIR=$COMFYUI_MODELS_DIR
COMFYUI_TIMEOUT_MS=$COMFYUI_TIMEOUT_MS
COMFYUI_VIDEO_WORKFLOW_PATH=$COMFYUI_VIDEO_WORKFLOW_PATH
EOF

echo "  .env.local 내용:"
cat "$ROOT_DIR/.env.local"

# --- 4. ComfyUI 연결 확인 ---
echo ""
echo "[4/5] ComfyUI 연결 확인 중..."
if curl -fsS --max-time 5 "$COMFYUI_BASE_URL/system_stats" >/dev/null 2>&1; then
  echo "  ✓ ComfyUI가 응답합니다: $COMFYUI_BASE_URL"
else
  echo "  ⚠ ComfyUI에 연결할 수 없습니다: $COMFYUI_BASE_URL"
  echo "    ComfyUI가 실행 중인지 확인하세요."
  echo "    계속 진행합니다 — ComfyUI가 나중에 시작될 수 있습니다."
fi

# --- 5. 빌드 및 시작 ---
echo ""
echo "[5/5] Next.js 빌드 중..."
npm run build

echo ""
echo "========================================="
echo "  빌드 완료! Image Gen을 시작합니다."
echo "========================================="
echo ""
echo "  접속 URL:"
echo "    - RunPod Proxy:  https://<pod-id>-3000.proxy.runpod.net"
echo "    - Pod 내부:      http://$IMAGE_GEN_HOST:$IMAGE_GEN_PORT"
echo ""
echo "  ComfyUI 직접 접속:"
echo "    - RunPod Proxy:  https://<pod-id>-8188.proxy.runpod.net"
echo "    - Pod 내부:      http://127.0.0.1:8188"
echo ""
echo "  중지하려면 Ctrl+C"
echo ""

exec npm run start -- --hostname "$IMAGE_GEN_HOST" --port "$IMAGE_GEN_PORT"
