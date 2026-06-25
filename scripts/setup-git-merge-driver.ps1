$ErrorActionPreference = "Stop"

git config merge.model-catalog-json.name "Merge model catalog JSON with local entries preferred"
git config merge.model-catalog-json.driver "node scripts/merge-model-catalog.mjs %O %A %B %P"

Write-Host "Configured git merge driver: model-catalog-json"
