# Agent memory (portable)

Claude Code's auto-memory lives in `~/.claude/projects/<path>/memory/`, which is
per-machine and per-account. This folder is the **checked-in copy** so the
project context survives a new account, a new PC, or a fresh clone.

**Rule for agents:** when you learn something non-obvious about this project
(pipeline contracts, pod quirks, model-file gotchas, user decisions), write or
update a file here — one fact per file, same frontmatter as below — and add a
line to the index. Keep secrets out: this repo is **public**. Reference env var
names, never values.

```markdown
---
name: <kebab-case-slug>
description: <one line, used to judge relevance>
metadata:
  type: project | feedback | user | reference
---
<the fact; link related notes with [[slug]]>
```

## Index

- [LTX subgraph→API workflow conversion](ltx-subgraph-workflow-conversion.md) — how to add official subgraph-based LTX ComfyUI workflows to the video engine (graphToPrompt in a live ComfyUI, never hand-convert)
- [LTX-2.5 i2v/t2v pipeline](ltx25-i2v-pipeline.md) — `ltx25-i2v-two-stage` / `ltx25-t2v-two-stage`: distilled transformer, VAE choice, duration ≤10s, gated HF repo
- [MiniMax H3 DaSiWa pipeline](minimax-h3-dasiwa-pipeline.md) — `dasiwa-minimax-h3-i2va`, Director injection contract, pod setup script, RunPod proxy 524 handling
- [MiniMax H3 multi-ref pipeline](minimax-h3-multiref-pipeline.md) — `minimax-h3-native-multiref-i2va` (clean hands), `extra_ref_images` contract, fixed-24fps guard
- [Z-Image pipeline](zimage-pipeline.md) — Z-Image loaders, support files, turbo recipe
- [Character reference sheet (BETA)](character-reference-sheet.md) — sheet confirmed per character; generate route injects `character_sheet_image`; IP-Adapter pins live in 3 places
- [ComfyUI blueprints as recipe source](comfyui-blueprints-recipe-source.md) — `ComfyUI/blueprints/*.json` are the official per-family recipes; validate via local `/prompt`

## New machine / new account checklist

Things git does **not** carry — move them by hand:

| What | Where | Notes |
| --- | --- | --- |
| Secrets | `.env.local` | Keys beyond `.env.example`: `RUNPOD_API_KEY`, `OPENROUTER_API_KEY`, `SEEDANCE_API_KEY` (plus `CIVITAI_API_TOKEN`, HF token in app Settings for gated `Lightricks/LTX-2.5`) |
| Gallery workspaces | `data/workspaces.json` | gitignored |
| Generation history | `data/history/` (~600MB) | gitignored |
| Outputs / uploads | `output/` (~7GB), `uploads/` | gitignored; only needed if you want old gallery items |
| Local ComfyUI clone | `ComfyUI/` | gitignored; re-run `npm run setup:comfyui` (see [docs/comfyui-setup.md](../comfyui-setup.md)). Needed for `blueprints/` and graphToPrompt conversions |
| RunPod pods | RunPod account | Pods `onechat_ltx25_h100_001/002` belong to the RunPod account tied to `RUNPOD_API_KEY`, not to the Claude account. Pod 002 has no network volume — after restart run `scripts/setup-minimax-h3-pod.sh` |

Optional: the old machine's global Claude rules (`~/.claude/rules/intent-router.md`
for the davinci `da:*` plugin, `semble-routing.md` for the semble MCP) are user
config, not project config — reinstall the davinci plugin on the new account if
you want them.
- [krea2-on-3060.md](krea2-on-3060.md) — Krea 2 files, nodes, fp8 vs GGUF speed, identity-edit pitfalls on the 3060 worker
