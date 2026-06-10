#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
COMFYUI_REPO="${COMFYUI_REPO:-https://github.com/comfyanonymous/ComfyUI.git}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install ComfyUI." >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "$PYTHON_BIN is required. Set PYTHON_BIN=/path/to/python if needed." >&2
  exit 1
fi

if [ -d "$COMFYUI_DIR/.git" ]; then
  echo "Updating existing ComfyUI checkout..."
  git -C "$COMFYUI_DIR" pull --ff-only
elif [ -e "$COMFYUI_DIR" ]; then
  echo "$COMFYUI_DIR already exists but is not a git checkout." >&2
  echo "Move it aside or set COMFYUI_DIR to another path." >&2
  exit 1
else
  echo "Cloning ComfyUI into $COMFYUI_DIR..."
  git clone "$COMFYUI_REPO" "$COMFYUI_DIR"
fi

if [ ! -d "$COMFYUI_DIR/venv" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON_BIN" -m venv "$COMFYUI_DIR/venv"
fi

# shellcheck source=/dev/null
source "$COMFYUI_DIR/venv/bin/activate"

python -m pip install --upgrade pip setuptools wheel
python -m pip install -r "$COMFYUI_DIR/requirements.txt"

mkdir -p \
  "$COMFYUI_DIR/models/checkpoints" \
  "$COMFYUI_DIR/models/loras" \
  "$COMFYUI_DIR/models/embeddings" \
  "$COMFYUI_DIR/models/vae" \
  "$COMFYUI_DIR/models/controlnet" \
  "$COMFYUI_DIR/input" \
  "$COMFYUI_DIR/output" \
  "$COMFYUI_DIR/temp"

cat <<EOF

ComfyUI is ready.

Next steps:
  1. Put model files under:
     $COMFYUI_DIR/models/checkpoints
     $COMFYUI_DIR/models/loras
     $COMFYUI_DIR/models/embeddings
     $COMFYUI_DIR/models/vae
     $COMFYUI_DIR/models/controlnet
  2. Start ComfyUI:
     npm run comfyui
  3. Start this app in another terminal:
     npm run dev

Model weights such as .safetensors are intentionally not committed.
EOF
