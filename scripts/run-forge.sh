#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGE_DIR="${FORGE_DIR:-$ROOT_DIR/stable-diffusion-webui-forge}"
HOST="${FORGE_HOST:-127.0.0.1}"
PORT="${FORGE_PORT:-7861}"
MODEL_ROOT="${COMFYUI_MODELS_DIR:-$ROOT_DIR/ComfyUI/models}"

if [ ! -f "$FORGE_DIR/launch.py" ]; then
  echo "Forge is not installed at $FORGE_DIR." >&2
  echo "Clone lllyasviel/stable-diffusion-webui-forge there or set FORGE_DIR." >&2
  exit 1
fi

PYTHON="$FORGE_DIR/venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  PYTHON="python3"
fi

cd "$FORGE_DIR"
# shellcheck disable=SC2086
exec "$PYTHON" launch.py \
  --api --listen --server-name "$HOST" --port "$PORT" \
  --skip-version-check --no-download-sd-model \
  --ckpt-dir "$MODEL_ROOT/checkpoints" \
  --lora-dir "$MODEL_ROOT/loras" \
  --embeddings-dir "$MODEL_ROOT/embeddings" \
  --vae-dir "$MODEL_ROOT/vae" \
  --esrgan-models-path "$MODEL_ROOT/upscale_models" \
  ${FORGE_EXTRA_ARGS:-} "$@"
