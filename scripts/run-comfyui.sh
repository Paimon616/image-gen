#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
COMFYUI_HOST="${COMFYUI_HOST:-127.0.0.1}"
COMFYUI_PORT="${COMFYUI_PORT:-8188}"

if [ ! -f "$COMFYUI_DIR/main.py" ]; then
  echo "ComfyUI is not installed at $COMFYUI_DIR." >&2
  echo "Run: npm run setup:comfyui" >&2
  exit 1
fi

if [ ! -x "$COMFYUI_DIR/venv/bin/python" ]; then
  echo "ComfyUI virtual environment is missing." >&2
  echo "Run: npm run setup:comfyui" >&2
  exit 1
fi

cd "$COMFYUI_DIR"

EXTRA_ARGS=()
# On Apple Silicon (MPS), PyTorch's default attention can deadlock in a single large
# `bmm` when sampling big regions (e.g. ADetailer face crops on hires images). Split
# cross-attention chunks that matmul so it completes instead of hanging the GPU stream.
# Override with COMFYUI_CROSS_ATTENTION=none to disable, or pass your own flag.
if [ "$(uname -s)" = "Darwin" ]; then
  case "${COMFYUI_CROSS_ATTENTION:-split}" in
    none) ;;
    split) EXTRA_ARGS+=("--use-split-cross-attention") ;;
    quad) EXTRA_ARGS+=("--use-quad-cross-attention") ;;
    *) EXTRA_ARGS+=("${COMFYUI_CROSS_ATTENTION}") ;;
  esac
fi

exec "$COMFYUI_DIR/venv/bin/python" main.py --listen "$COMFYUI_HOST" --port "$COMFYUI_PORT" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} "$@"
