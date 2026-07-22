#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBUI_DIR="${A1111_DIR:-$ROOT_DIR/stable-diffusion-webui}"
HOST="${A1111_HOST:-127.0.0.1}"
PORT="${A1111_PORT:-7860}"
MODEL_ROOT="${COMFYUI_MODELS_DIR:-$ROOT_DIR/ComfyUI/models}"

if [ ! -f "$WEBUI_DIR/launch.py" ]; then
  echo "A1111 is not installed at $WEBUI_DIR. Run: npm run setup:a1111" >&2
  exit 1
fi

PYTHON="$WEBUI_DIR/venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  echo "A1111 virtualenv is missing at $WEBUI_DIR/venv. Run: npm run setup:a1111" >&2
  exit 1
fi

# The upstream Stability-AI/stablediffusion repo is gone; use the maintained fork
# (matches the Windows launcher).
export STABLE_DIFFUSION_REPO="${STABLE_DIFFUSION_REPO:-https://github.com/w-e-w/stablediffusion.git}"

# Apple Silicon (MPS) needs a CPU/MPS torch build and the fallback flag; the mac
# args mirror AUTOMATIC1111's own webui-macos-env.sh defaults.
export PYTORCH_ENABLE_MPS_FALLBACK=1
MAC_ARGS=""
if [ "$(uname)" = "Darwin" ]; then
  export TORCH_COMMAND="${TORCH_COMMAND:-pip install torch==2.1.2 torchvision==0.16.2}"
  MAC_ARGS="--skip-torch-cuda-test --upcast-sampling --no-half-vae"
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
  $MAC_ARGS ${A1111_EXTRA_ARGS:-} "$@"
