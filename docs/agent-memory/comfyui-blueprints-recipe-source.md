---
name: comfyui-blueprints-recipe-source
description: "The local ComfyUI/blueprints/*.json files are the authoritative source for official model recipes in this repo"
metadata:
  type: project
---

`ComfyUI/blueprints/*.json` (checked into the local ComfyUI clone at the repo root) holds ComfyUI's **official templates** for every supported model family — e.g. `Text to Image (Z-Image-Turbo).json`, `Text to Image (Z-Image-Base).json`, `Image Upscale(Z-image-Turbo).json`. Read these instead of guessing when adding a family to `buildDefaultWorkflow` in [[zimage-pipeline]] style: they carry exact loader class names, `CLIPLoader` type strings, support-file filenames, sampler/scheduler/steps/cfg and shift values.

They ship as **UI graphs wrapped in a single subgraph** (`definitions.subgraphs[0].nodes/links`, top-level `nodes` holds one opaque node) — dump the subgraph, not the root. Same format caveat as [[ltx-subgraph-workflow-conversion]].

Validate any hand-built API graph against the running local ComfyUI (`http://127.0.0.1:8188/prompt`): `value_not_in_list` errors for model files are expected locally (weights live on the RunPod pod); **zero other error types means the graph is structurally sound**.
