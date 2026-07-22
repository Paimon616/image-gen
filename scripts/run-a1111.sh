#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBUI_DIR="${A1111_DIR:-$ROOT_DIR/stable-diffusion-webui}"
HOST="${A1111_HOST:-127.0.0.1}"
PORT="${A1111_PORT:-7860}"
MODEL_ROOT="${COMFYUI_MODELS_DIR:-$ROOT_DIR/ComfyUI/models}"

if [ ! -f "$WEBUI_DIR/launch.py" ]; then
  echo "A1111 is not installed at $WEBUI_DIR." >&2
  echo "Clone AUTOMATIC1111/stable-diffusion-webui there or set A1111_DIR." >&2
  exit 1
fi

PYTHON="$WEBUI_DIR/venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

cd "$WEBUI_DIR"
# shellcheck disable=SC2086
exec "$PYTHON" launch.py \
  --api --listen --server-name "$HOST" --port "$PORT" \
  --skip-version-check --no-download-sd-model \
  --ckpt-dir "$MODEL_ROOT/checkpoints" \
  --lora-dir "$MODEL_ROOT/loras" \
  --embeddings-dir "$MODEL_ROOT/embeddings" \
  --vae-dir "$MODEL_ROOT/vae" \
  --esrgan-models-path "$MODEL_ROOT/upscale_models" \
  ${A1111_EXTRA_ARGS:-} "$@"
