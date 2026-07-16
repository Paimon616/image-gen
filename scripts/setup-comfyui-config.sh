#!/usr/bin/env bash
set -euo pipefail

# Provisions the version-controlled ComfyUI config from comfyui-config/:
#   - custom nodes pinned to the commits in custom-nodes.json
#   - GUI workflows copied into ComfyUI/user/default/workflows
#   - baseline UI settings seeded if absent
# Idempotent: safe to re-run. Pass --force to overwrite existing workflows/settings.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMFYUI_DIR="${COMFYUI_DIR:-$ROOT_DIR/ComfyUI}"
CONFIG_DIR="${COMFYUI_CONFIG_DIR:-$ROOT_DIR/comfyui-config}"
CUSTOM_NODES_DIR="$COMFYUI_DIR/custom_nodes"
USER_DIR="$COMFYUI_DIR/user/default"
PYTHON="$COMFYUI_DIR/venv/bin/python"
FORCE=0

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$COMFYUI_DIR/main.py" ]; then
  echo "ComfyUI is not installed at $COMFYUI_DIR." >&2
  echo "Run: npm run setup:comfyui" >&2
  exit 1
fi

if [ ! -x "$PYTHON" ]; then
  echo "ComfyUI virtual environment is missing. Run: npm run setup:comfyui" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install ComfyUI custom nodes." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Custom nodes (pinned)
# ---------------------------------------------------------------------------
MANIFEST="$CONFIG_DIR/custom-nodes.json"

install_pinned_node() {
  local name="$1" repo="$2" ref="$3"
  local node_dir="$CUSTOM_NODES_DIR/$name"

  if [ -e "$node_dir" ] && [ ! -d "$node_dir/.git" ]; then
    echo "$node_dir exists but is not a git checkout. Move it aside and rerun." >&2
    exit 1
  fi

  if [ ! -d "$node_dir/.git" ]; then
    echo "Cloning $name..."
    git clone "$repo" "$node_dir"
  fi

  echo "Pinning $name -> $ref"
  git -C "$node_dir" fetch --quiet origin "$ref" 2>/dev/null || git -C "$node_dir" fetch --quiet --all
  git -C "$node_dir" checkout --quiet "$ref"

  if [ -f "$node_dir/requirements.txt" ]; then
    echo "Installing Python requirements for $name..."
    "$PYTHON" -m pip install -r "$node_dir/requirements.txt"
  fi
}

if [ -f "$MANIFEST" ]; then
  mkdir -p "$CUSTOM_NODES_DIR"
  # Emit "name<TAB>repo<TAB>ref" lines from the JSON manifest.
  while IFS=$'\t' read -r name repo ref; do
    [ -z "$name" ] && continue
    install_pinned_node "$name" "$repo" "$ref"
  done < <("$PYTHON" - "$MANIFEST" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
for node in data.get("custom_nodes", []):
    print("\t".join([node["name"], node["repo"], node["ref"]]))
PY
)
else
  echo "No custom-nodes.json manifest found at $MANIFEST (skipping custom nodes)."
fi

# ---------------------------------------------------------------------------
# 2. GUI workflows
# ---------------------------------------------------------------------------
if [ -d "$CONFIG_DIR/workflows" ]; then
  mkdir -p "$USER_DIR/workflows"
  shopt -s nullglob
  for wf in "$CONFIG_DIR/workflows"/*.json; do
    dest="$USER_DIR/workflows/$(basename "$wf")"
    if [ -e "$dest" ] && [ "$FORCE" -ne 1 ]; then
      echo "Skipping existing workflow $(basename "$wf") (use --force to overwrite)."
    else
      cp "$wf" "$dest"
      echo "Installed workflow $(basename "$wf")."
    fi
  done
  shopt -u nullglob
fi

# ---------------------------------------------------------------------------
# 3. Baseline UI settings (seed only if absent)
# ---------------------------------------------------------------------------
SETTINGS_SRC="$CONFIG_DIR/settings/comfy.settings.json"
SETTINGS_DEST="$USER_DIR/comfy.settings.json"
if [ -f "$SETTINGS_SRC" ]; then
  if [ -e "$SETTINGS_DEST" ] && [ "$FORCE" -ne 1 ]; then
    echo "Skipping existing comfy.settings.json (use --force to overwrite)."
  else
    mkdir -p "$USER_DIR"
    cp "$SETTINGS_SRC" "$SETTINGS_DEST"
    echo "Installed comfy.settings.json."
  fi
fi

echo
echo "ComfyUI config provisioned. Restart ComfyUI to load newly installed custom nodes."
