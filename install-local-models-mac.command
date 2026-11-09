#!/bin/bash
# Double-click in Finder to install the image-generation models on a Mac
# (image + krea2, about 43 GB). See scripts/install-local-models-mac.sh.
cd "$(dirname "$0")" || exit 1
bash scripts/install-local-models-mac.sh "$@"
echo
read -r -p "Press Enter to close..." _
