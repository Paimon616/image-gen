#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
COMFYUI_REPO="${COMFYUI_REPO:-https://github.com/comfyanonymous/ComfyUI.git}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

# Pin ComfyUI to a known-good commit for reproducibility. Precedence:
# COMFYUI_REF env var > comfyui-config/comfyui-version.txt > latest master.
VERSION_FILE="$ROOT_DIR/comfyui-config/comfyui-version.txt"
COMFYUI_REF="${COMFYUI_REF:-}"
if [ -z "$COMFYUI_REF" ] && [ -f "$VERSION_FILE" ]; then
  COMFYUI_REF="$(tr -d '[:space:]' < "$VERSION_FILE")"
fi

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
  git -C "$COMFYUI_DIR" fetch --quiet origin
elif [ -e "$COMFYUI_DIR" ]; then
  echo "$COMFYUI_DIR already exists but is not a git checkout." >&2
  echo "Move it aside or set COMFYUI_DIR to another path." >&2
  exit 1
else
  echo "Cloning ComfyUI into $COMFYUI_DIR..."
  git clone "$COMFYUI_REPO" "$COMFYUI_DIR"
fi

if [ -n "$COMFYUI_REF" ]; then
  echo "Checking out pinned ComfyUI ref: $COMFYUI_REF"
  git -C "$COMFYUI_DIR" fetch --quiet origin "$COMFYUI_REF" 2>/dev/null || git -C "$COMFYUI_DIR" fetch --quiet --all
  git -C "$COMFYUI_DIR" checkout "$COMFYUI_REF"
else
  echo "No pinned ref set; using latest master."
  git -C "$COMFYUI_DIR" checkout master >/dev/null 2>&1 || true
  git -C "$COMFYUI_DIR" pull --ff-only
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
  "$COMFYUI_DIR/models/diffusion_models" \
  "$COMFYUI_DIR/models/text_encoders" \
  "$COMFYUI_DIR/models/loras" \
  "$COMFYUI_DIR/models/embeddings" \
  "$COMFYUI_DIR/models/vae" \
  "$COMFYUI_DIR/models/upscale_models" \
  "$COMFYUI_DIR/models/controlnet" \
  "$COMFYUI_DIR/input" \
  "$COMFYUI_DIR/output" \
  "$COMFYUI_DIR/temp"

# Provision version-controlled ComfyUI config (custom nodes, workflows, settings).
if [ -x "$ROOT_DIR/scripts/setup-comfyui-config.sh" ]; then
  echo "Provisioning ComfyUI config (custom nodes, workflows, settings)..."
  COMFYUI_DIR="$COMFYUI_DIR" bash "$ROOT_DIR/scripts/setup-comfyui-config.sh" || \
    echo "ComfyUI config provisioning skipped/failed; run 'npm run setup:comfyui-config' manually." >&2
fi

cat <<EOF

ComfyUI is ready.

Next steps:
  1. Put model files under:
     $COMFYUI_DIR/models/checkpoints
     $COMFYUI_DIR/models/loras
     $COMFYUI_DIR/models/embeddings
     $COMFYUI_DIR/models/vae
     $COMFYUI_DIR/models/upscale_models
     $COMFYUI_DIR/models/controlnet
  2. Optional image-to-prompt nodes:
     npm run setup:itp-nodes
  3. Start ComfyUI:
     npm run comfyui
  4. Start this app in another terminal:
     npm run dev

Model weights such as .safetensors are intentionally not committed.
EOF
