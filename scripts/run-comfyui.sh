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
exec "$COMFYUI_DIR/venv/bin/python" main.py --listen "$COMFYUI_HOST" --port "$COMFYUI_PORT" "$@"
