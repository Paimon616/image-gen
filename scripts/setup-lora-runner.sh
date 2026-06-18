#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER_DIR="${LORA_RUNNER_DIR:-$ROOT_DIR/runners/sd-scripts}"
SD_SCRIPTS_REPO="${SD_SCRIPTS_REPO:-https://github.com/kohya-ss/sd-scripts.git}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required to install the LoRA runner." >&2
  exit 1
fi

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "$PYTHON_BIN is required. Set PYTHON_BIN=/path/to/python if needed." >&2
  exit 1
fi

if [ -d "$RUNNER_DIR/.git" ]; then
  echo "Updating existing sd-scripts checkout..."
  git -C "$RUNNER_DIR" pull --ff-only
elif [ -e "$RUNNER_DIR" ]; then
  echo "$RUNNER_DIR already exists but is not a git checkout." >&2
  echo "Move it aside or set LORA_RUNNER_DIR to another path." >&2
  exit 1
else
  echo "Cloning sd-scripts into $RUNNER_DIR..."
  mkdir -p "$(dirname "$RUNNER_DIR")"
  git clone "$SD_SCRIPTS_REPO" "$RUNNER_DIR"
fi

if [ ! -d "$RUNNER_DIR/.venv" ]; then
  echo "Creating Python virtual environment..."
  "$PYTHON_BIN" -m venv "$RUNNER_DIR/.venv"
fi

# shellcheck source=/dev/null
source "$RUNNER_DIR/.venv/bin/activate"

python -m pip install --upgrade pip setuptools wheel
(cd "$RUNNER_DIR" && python -m pip install -r requirements.txt)
python -m pip install accelerate

mkdir -p "$ROOT_DIR/training/runs" "$ROOT_DIR/ComfyUI/models/loras"

cat <<EOF

LoRA runner is ready.

Runner:
  $RUNNER_DIR

Next steps:
  1. Restart the Next.js dev server if it is already running.
  2. Open /lora-training.
  3. The button should change from "Runner 연결 필요" to "LoRA 파일 생성 시작".

Optional environment overrides:
  LORA_RUNNER_DIR=$RUNNER_DIR
  LORA_RUNNER_PYTHON=$RUNNER_DIR/.venv/bin/python
EOF
