---
name: ltx-subgraph-workflow-conversion
description: "How to add official LTX-2.x/2.5 ComfyUI workflows to this repo's video pipeline engine"
metadata:
  type: project
---

Official Lightricks `ComfyUI-LTXVideo` example workflows (e.g. `example_workflows/2.5/LTX-2.5_T2V_I2V_Two_Stage_Distilled.json`) ship as **ComfyUI UI-format graphs built from nested subgraphs** (`nodes`/`links`/`definitions.subgraphs`). This repo's video engine (`src/lib/comfyui.ts`, `video-pipelines.ts`) needs the **flat API-format** `prompt` dict with colon-namespaced ids like `5575:5569` (subgraph-expanded).

**Do NOT hand-convert.** Load the UI graph in a live ComfyUI and let it expand subgraphs:
1. Open ComfyUI in the browser (`COMFYUI_BASE_URL`, in `.env.local`).
2. `await window.app.loadGraphData(json, true, true, "name")` then `const p = await window.app.graphToPrompt(); p.output` is the flat API prompt.

**Gotchas seen with the LTX-2.5 two-stage template:**
- Official template ships **placeholder model widgets** (video-VAE slot held the audio-VAE name; CLIPLoader held `ViT-B-32.pt`). Must set correct bf16 files.
- Uses a cloud **Gemma API Text Encode** + local prompt-enhancer branch gated by ComfySwitchNode; nodes are `undefined` class if not installed → /prompt rejects. Prune those branches and wire the positive/negative `PrimitiveStringMultiline` straight to the `CLIPTextEncode` nodes.
- Defaults to **T2V**: a `PrimitiveBoolean` "use image" feeds a `ComfyNotNode` → `LTXVImgToVideoInplace.bypass`. For i2v set bypass literal `false` (bypass is a BOOLEAN input, default false).
- `LTXFloatToInt` is not installed on our pod → replace with `ComfyMathExpression {expression:"floor(a)"}` and read its INT output (slot 1).

Validate with no side effects: POST to `<base>/prompt`; "Value not in list" errors for model files are expected locally (models live on the RunPod 80GB pod), zero **structural** node_errors means the graph is sound.

Engine injection contract: prompt/negative come from `PrimitiveStringMultiline` title match in `applyVideoParamsToWorkflow` (title `/negative/i` → negative, else `/prompt/i` → positive); `LoadImage` gets the start image; **pipeline `controls[].patches` run last and override generic width/height**, so expose resolution via controls patching `EmptyLTXVLatentVideo`. See [[ltx25-i2v-pipeline]].
