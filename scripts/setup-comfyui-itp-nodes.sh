#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
CUSTOM_NODES_DIR="$COMFYUI_DIR/custom_nodes"
PYTHON="$COMFYUI_DIR/venv/bin/python"

if [ ! -f "$COMFYUI_DIR/main.py" ]; then
  echo "ComfyUI is not installed at $COMFYUI_DIR." >&2
  echo "Run: npm run setup:comfyui" >&2
  exit 1
fi

if [ ! -x "$PYTHON" ]; then
  echo "ComfyUI virtual environment is missing." >&2
  echo "Run: npm run setup:comfyui" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install ComfyUI custom nodes." >&2
  exit 1
fi

mkdir -p "$CUSTOM_NODES_DIR"

install_or_update_node() {
  local name="$1"
  local repo="$2"
  local node_dir="$CUSTOM_NODES_DIR/$name"

  if [ -d "$node_dir/.git" ]; then
    echo "Updating $name..."
    git -C "$node_dir" pull --ff-only
  elif [ -e "$node_dir" ]; then
    echo "$node_dir already exists but is not a git checkout. Move it aside and rerun this script." >&2
    exit 1
  else
    echo "Installing $name..."
    git clone "$repo" "$node_dir"
  fi

  if [ -f "$node_dir/requirements.txt" ]; then
    echo "Installing Python requirements for $name..."
    "$PYTHON" -m pip install -r "$node_dir/requirements.txt"
  fi
}

install_or_update_node "ComfyUI-WD14-Tagger" "https://github.com/pythongosssss/ComfyUI-WD14-Tagger.git"
install_or_update_node "ComfyUI-Custom-Scripts" "https://github.com/pythongosssss/ComfyUI-Custom-Scripts.git"
install_or_update_node "ComfyUI-Florence2" "https://github.com/kijai/ComfyUI-Florence2.git"

cat <<EOF

Image-to-prompt ComfyUI nodes are ready. Restart ComfyUI before using the feature.
WD14 works with the built-in workflow. Florence requires COMFYUI_ITP_FLORENCE_WORKFLOW_PATH unless your workflow is customized.
EOF
