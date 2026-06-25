#!/usr/bin/env bash
set -euo pipefail

git config merge.model-catalog-json.name "Merge model catalog JSON with local entries preferred"
git config merge.model-catalog-json.driver "node scripts/merge-model-catalog.mjs %O %A %B %P"

echo "Configured git merge driver: model-catalog-json"
