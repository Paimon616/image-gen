#!/bin/bash
# Double-click in Finder to install ComfyUI on an Apple Silicon Mac.
# Then double-click install-local-models-mac.command.
cd "$(dirname "$0")" || exit 1
bash scripts/setup-comfyui-mac.sh "$@"
echo
read -r -p "Press Enter to close..." _
