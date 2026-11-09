#!/usr/bin/env bash
# One-click ComfyUI setup for an Apple Silicon Mac (used by setup-comfyui-mac.command).
#  - Installs Python 3.12 and git with Homebrew when they are missing.
#  - Installs ComfyUI pinned to the version the local stack was tested on (v0.34.0).
#  - torch on macOS comes with Metal (MPS) GPU support; this checks that it is active.
# Then run install-local-models-mac.command for the models and LoRAs.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_REF="${COMFYUI_REF:-12d5279438bfefc058a269eae805ceab6047777f}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS. On Windows use setup-comfyui.bat." >&2
  exit 1
fi
if [ "$(uname -m)" != "arm64" ]; then
  echo "Warning: this Mac is not Apple Silicon (M1 or newer). ComfyUI will run on the CPU only and be very slow." >&2
fi

# Homebrew lives in different places on Apple Silicon and Intel.
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -x "$b" ]; then eval "$("$b" shellenv)"; break; fi
done

find_python() {
  for p in python3.12 /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.11; do
    if command -v "$p" >/dev/null 2>&1; then command -v "$p"; return 0; fi
  done
  return 1
}

PYTHON_BIN="$(find_python || true)"
if [ -z "$PYTHON_BIN" ] || ! command -v git >/dev/null 2>&1; then
  if ! command -v brew >/dev/null 2>&1; then
    cat >&2 <<'EOF'
Python 3.12 and git are needed. Install Homebrew first (https://brew.sh):
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
then double-click setup-comfyui-mac.command again.
EOF
    exit 1
  fi
  echo "==> Installing Python 3.12 and git with Homebrew..."
  brew install python@3.12 git
  PYTHON_BIN="$(find_python)"
fi
echo "==> Python: $PYTHON_BIN"

echo "==> Installing ComfyUI ($COMFYUI_REF)..."
COMFYUI_REF="$COMFYUI_REF" PYTHON_BIN="$PYTHON_BIN" bash "$ROOT_DIR/scripts/setup-comfyui.sh"

echo "==> Checking..."
"$ROOT_DIR/ComfyUI/venv/bin/python" -c "import torch; print('torch', torch.__version__, '| Metal (MPS):', 'available' if torch.backends.mps.is_available() else 'NOT AVAILABLE')"

cat <<'EOF'

ComfyUI is ready.
Next: put CIVITAI_API_TOKEN in .env.local, then double-click install-local-models-mac.command.
Start ComfyUI with:  npm run comfyui
EOF
