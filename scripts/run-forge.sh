#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORGE_DIR="${FORGE_DIR:-$ROOT_DIR/stable-diffusion-webui-forge}"
HOST="${FORGE_HOST:-127.0.0.1}"
PORT="${FORGE_PORT:-7861}"
MODEL_ROOT="${COMFYUI_MODELS_DIR:-$ROOT_DIR/ComfyUI/models}"
# COMFYUI_MODELS_DIR may be relative (e.g. from .env.local). The WebUI cd's into
# its own directory before launch, so relative paths would resolve there and hide
# the models. Anchor a relative value to the project root.
case "$MODEL_ROOT" in
  /*) : ;;
  *) MODEL_ROOT="$ROOT_DIR/$MODEL_ROOT" ;;
esac

if [ ! -f "$FORGE_DIR/launch.py" ]; then
  echo "Forge is not installed at $FORGE_DIR. Run: npm run setup:forge" >&2
  exit 1
fi

PYTHON="$FORGE_DIR/venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  echo "Forge virtualenv is missing at $FORGE_DIR/venv. Run: npm run setup:forge" >&2
  exit 1
fi

export STABLE_DIFFUSION_REPO="${STABLE_DIFFUSION_REPO:-https://github.com/w-e-w/stablediffusion.git}"
export PYTORCH_ENABLE_MPS_FALLBACK=1
MAC_ARGS=""
if [ "$(uname)" = "Darwin" ]; then
  export TORCH_COMMAND="${TORCH_COMMAND:-pip install torch==2.1.2 torchvision==0.16.2}"
  MAC_ARGS="--skip-torch-cuda-test --upcast-sampling --no-half-vae"
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
  $MAC_ARGS ${FORGE_EXTRA_ARGS:-} "$@"
