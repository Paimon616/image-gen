#!/usr/bin/env bash
set -euo pipefail

#
# RunPod Pod에서 ComfyUI + image-gen을 함께 시작하는 스크립트.
#
# 사용법:
#   cd /workspace/image-gen
#   bash scripts/runpod-start.sh
#
# 이 스크립트는:
#   1. ComfyUI가 실행 중이 아니면 백그라운드에서 시작
#   2. image-gen(Next.js)을 포어그라운드에서 시작
#   3. Ctrl-C로 두 프로세스를 함께 종료
#

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

IMAGE_GEN_HOST="${IMAGE_GEN_HOST:-0.0.0.0}"
IMAGE_GEN_PORT="${IMAGE_GEN_PORT:-3000}"
COMFYUI_HOST="${COMFYUI_HOST:-127.0.0.1}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"
COMFYUI_DIR="${COMFYUI_DIR:-/workspace/ComfyUI}"
COMFYUI_BASE_URL="${COMFYUI_BASE_URL:-http://127.0.0.1:$COMFYUI_PORT}"
COMFYUI_MODELS_DIR="${COMFYUI_MODELS_DIR:-$COMFYUI_DIR/models}"
COMFYUI_VIDEO_WORKFLOW_PATH="${COMFYUI_VIDEO_WORKFLOW_PATH:-workflows/ltx23-10eros-t2v-api.json}"
COMFYUI_TIMEOUT_MS="${COMFYUI_TIMEOUT_MS:-1800000}"

STARTED_PIDS=()
CLEANED_UP=0

cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then return; fi
  CLEANED_UP=1
  echo ""
  echo "서버를 종료합니다..."
  for pid in "${STARTED_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  for pid in "${STARTED_PIDS[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      sleep 1
      kill -KILL "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

port_listening() {
  curl -fsS --max-time 2 "http://127.0.0.1:$1" >/dev/null 2>&1 || \
  curl -fsS --max-time 2 "http://127.0.0.1:$1/system_stats" >/dev/null 2>&1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local pid="$3"
  for _ in $(seq 1 120); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
      echo "$name 준비됨: $url"
      return 0
    fi
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      echo "$name 프로세스가 종료되었습니다." >&2
      return 1
    fi
    sleep 1
  done
  echo "$name 대기 시간 초과: $url" >&2
  return 1
}

# --- .env.local 생성 ---
cat > "$ROOT_DIR/.env.local" <<EOF
COMFYUI_BASE_URL=$COMFYUI_BASE_URL
COMFYUI_MODELS_DIR=$COMFYUI_MODELS_DIR
COMFYUI_TIMEOUT_MS=$COMFYUI_TIMEOUT_MS
COMFYUI_VIDEO_WORKFLOW_PATH=$COMFYUI_VIDEO_WORKFLOW_PATH
EOF

echo "========================================="
echo "  RunPod 시작: ComfyUI + Image Gen"
echo "========================================="
echo ""

# --- Node.js 확인 / 설치 ---
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js/npm이 없습니다. 설치합니다..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    echo "ERROR: Node.js/npm을 찾을 수 없고 자동 설치를 지원하지 않는 환경입니다." >&2
    exit 1
  fi
fi

# --- ComfyUI 확인 및 시작 ---
if port_listening "$COMFYUI_PORT"; then
  echo "✓ ComfyUI가 이미 실행 중입니다 (port $COMFYUI_PORT)."
else
  echo "ComfyUI를 시작합니다..."
  if [ ! -f "$COMFYUI_DIR/main.py" ]; then
    echo "ERROR: ComfyUI main.py를 찾을 수 없습니다: $COMFYUI_DIR" >&2
    exit 1
  fi

  # ComfyUI venv 또는 시스템 Python 확인
  COMFYUI_PYTHON=""
  if [ -x "$COMFYUI_DIR/venv/bin/python" ]; then
    COMFYUI_PYTHON="$COMFYUI_DIR/venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    COMFYUI_PYTHON="python3"
  else
    echo "ERROR: Python을 찾을 수 없습니다." >&2
    exit 1
  fi

  (
    cd "$COMFYUI_DIR"
    exec "$COMFYUI_PYTHON" main.py \
      --listen "$COMFYUI_HOST" \
      --port "$COMFYUI_PORT" \
      --enable-cors-header
  ) &
  COMFYUI_PID=$!
  STARTED_PIDS+=("$COMFYUI_PID")
  echo "  ComfyUI PID: $COMFYUI_PID"

  echo "ComfyUI 응답 대기 중..."
  wait_for_http "ComfyUI" "$COMFYUI_BASE_URL/system_stats" "$COMFYUI_PID" || exit 1
fi

echo ""

# --- image-gen 의존성 / 빌드 확인 ---
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "node_modules가 없습니다. npm install을 실행합니다..."
  (cd "$ROOT_DIR" && npm install)
fi

if [ ! -d "$ROOT_DIR/.next" ]; then
  echo "Next.js 빌드가 없습니다. 빌드를 실행합니다..."
  (cd "$ROOT_DIR" && npm run build)
fi

# --- image-gen 시작 ---
echo "Image Gen을 시작합니다..."
(
  cd "$ROOT_DIR"
  exec npm run start -- --hostname "$IMAGE_GEN_HOST" --port "$IMAGE_GEN_PORT"
) &
IMAGE_GEN_PID=$!
STARTED_PIDS+=("$IMAGE_GEN_PID")
echo "  Image Gen PID: $IMAGE_GEN_PID"

echo "Image Gen 응답 대기 중..."
wait_for_http "Image Gen" "http://127.0.0.1:$IMAGE_GEN_PORT" "$IMAGE_GEN_PID" || exit 1

echo ""
echo "========================================="
echo "  모든 서버가 실행 중입니다!"
echo "========================================="
echo ""
echo "  Image Gen:"
echo "    RunPod Proxy: https://<pod-id>-$IMAGE_GEN_PORT.proxy.runpod.net"
echo "    Pod 내부:     http://$IMAGE_GEN_HOST:$IMAGE_GEN_PORT"
echo ""
echo "  ComfyUI:"
echo "    RunPod Proxy: https://<pod-id>-$COMFYUI_PORT.proxy.runpod.net"
echo "    Pod 내부:     http://127.0.0.1:$COMFYUI_PORT"
echo ""
echo "  종료하려면 Ctrl-C"
echo ""

wait "${STARTED_PIDS[@]}"
