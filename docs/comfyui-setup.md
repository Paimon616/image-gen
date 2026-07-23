# ComfyUI Setup

For the complete three-backend installation order, start with [Local image backends](image-backends-setup.md). For Civitai import diagnostics and recommendations, see [Civitai metadata reproduction](civitai-metadata-reproduction.md).

This app renders images/videos by talking to a local ComfyUI server. The `ComfyUI/`
runtime, its Python virtualenv, custom nodes, and model weights are **not** committed
to Git — each machine recreates them with the setup scripts below. Small,
version-controlled config (pinned ComfyUI commit, pinned custom nodes, GUI
workflows, baseline settings) lives under `comfyui-config/` so a fresh clone
reproduces the same runtime.

## What Git shares vs. does not share

| Shared through Git | Recreated locally (git-ignored) |
| --- | --- |
| App code, `data/model-catalog.json` | `ComfyUI/` (source + `venv/`) |
| API workflows in `workflows/` | `ComfyUI/custom_nodes/*` (installed from manifest) |
| `comfyui-config/` (version pin, node manifest, GUI workflows, settings) | `ComfyUI/models/**` (`.safetensors`, etc.) |
| Setup scripts, `.env.example` | `.env.local` |

## Prerequisites

- Node.js (for the Next.js app) and `npm`
- Python 3.10+ (`PYTHON_BIN` env var overrides the interpreter)
- `git`
- A GPU is recommended. See [Hardware notes](#hardware-notes) — fp8/fp4 models require an NVIDIA/CUDA GPU and do **not** run on Apple Silicon (MPS).

## Quick start (fresh clone)

macOS/Linux:

```bash
npm install
npm run setup:comfyui        # clone+pin ComfyUI, create venv, install deps, provision config
npm run comfyui              # start ComfyUI (http://127.0.0.1:8188)
npm run dev                  # start the app in another terminal
```

Windows PowerShell:

```powershell
npm install
npm run setup:comfyui:win
npm run comfyui:win
npm run dev
```

Then place model weights (see [Models](#models)) and copy `.env.example` to
`.env.local` if you need to override defaults.

## What `setup:comfyui` does

`scripts/setup-comfyui.sh` (and `.ps1`):

1. Clones ComfyUI (or fetches an existing checkout) and **checks out the pinned
   commit** from `comfyui-config/comfyui-version.txt`. This guarantees features
   like Krea 2 / fp8 quantization support match what the app expects. Override
   with `COMFYUI_REF=<sha>` (bash) or `-ComfyUIRef <sha>` (PowerShell). If no pin
   is set, it uses latest `master`.
2. Creates `ComfyUI/venv` and installs `ComfyUI/requirements.txt` (this includes
   `comfy_kitchen`, the fp8/fp4 quantization backend).
3. Creates the model directories, including `models/diffusion_models` and
   `models/text_encoders` (needed by Krea 2, Wan, LTX, etc.).
4. Runs the config provisioner (below).

## `comfyui-config/` — version-controlled ComfyUI config

Small assets that should travel with the repo:

```text
comfyui-config/
  custom-nodes.json          # custom node repos pinned to commits
  comfyui-version.txt        # pinned ComfyUI commit
  workflows/                 # GUI workflow JSONs (copied into ComfyUI/user/default/workflows)
  settings/comfy.settings.json  # baseline UI settings (seeded only if absent)
```

Provision (idempotent) on its own:

```bash
npm run setup:comfyui-config          # macOS/Linux
npm run setup:comfyui-config:win      # Windows
```

Behavior:

- **Custom nodes** are cloned into `ComfyUI/custom_nodes/<name>` and checked out
  at the pinned `ref`; each node's `requirements.txt` is installed into the venv.
- **Workflows** are copied into `ComfyUI/user/default/workflows/`. Existing files
  are left untouched unless you pass `--force` (bash) / `-Force` (PowerShell).
- **Settings** are seeded only if `comfy.settings.json` is missing.

### Add or update a custom node

Edit `comfyui-config/custom-nodes.json`:

```json
{
  "custom_nodes": [
    { "name": "ComfyUI-Florence2", "repo": "https://github.com/kijai/ComfyUI-Florence2.git", "ref": "<commit-sha>" }
  ]
}
```

To bump a node, change its `ref` to a new commit and rerun
`npm run setup:comfyui-config`. Restart ComfyUI afterward to load new nodes.
Find a commit SHA with `git ls-remote <repo> HEAD` or from the repo's history.

> The image-to-prompt nodes (WD14-Tagger, Custom-Scripts, Florence2) are managed
> here. `npm run setup:itp-nodes` now delegates to this provisioner.

### Bump the pinned ComfyUI version

Put the new commit SHA in `comfyui-config/comfyui-version.txt` and rerun
`npm run setup:comfyui`. Verify the app's features still work before committing.

### Share a GUI workflow

Save it in ComfyUI, then copy the JSON from
`ComfyUI/user/default/workflows/<name>.json` into `comfyui-config/workflows/`
and commit it. New machines get it via `setup:comfyui-config`.

## Models

Model weights are **not** committed (`*.safetensors` is git-ignored). Put local
files in the matching folders:

```text
ComfyUI/models/checkpoints/        # SD/SDXL/Illustrious full checkpoints
ComfyUI/models/diffusion_models/   # diffusion-only models loaded via UNETLoader (Krea 2, Wan, LTX)
ComfyUI/models/text_encoders/      # CLIP/text encoders (e.g. qwen3vl for Krea 2)
ComfyUI/models/loras/
ComfyUI/models/embeddings/
ComfyUI/models/vae/
ComfyUI/models/upscale_models/
ComfyUI/models/controlnet/
```

Model metadata is shared via `data/model-catalog.json` (a custom git merge driver
keeps your local entries during `git pull` — run `npm run setup:git-merge` once
per clone). The connection URL and models directory are configured through
`.env.local` (`COMFYUI_BASE_URL`, `COMFYUI_MODELS_DIR`); defaults are
`http://127.0.0.1:8188` and `ComfyUI/models`.

## Running

```bash
npm run comfyui      # or comfyui:win  — starts ComfyUI on port 8188
npm run dev          # starts the Next.js app
```

On macOS you can also double-click `Launch Image Gen.command`, which starts both
and opens the app.

## Hardware notes

- **NVIDIA / CUDA:** full support, including fp8/fp4/mxfp8 quantized models
  (fastest, smallest). This is the intended target for quantized weights. The
  repo also has RunPod scripts (`npm run runpod:deploy` / `runpod:start`) for a
  remote CUDA host — see `docs/RUNPOD-image-gen-deploy.md`.
- **Apple Silicon (MPS):** MPS does **not** support the `Float8_e4m3fn` dtype, so
  **fp8/fp4/mxfp8 models cannot run locally** — they error at sampling with
  `RuntimeError: Undefined type Float8_e4m3fn`. Use **bf16** (or fp16/full
  precision) variants instead. For Krea 2, use `krea2_turbo_bf16.safetensors`
  + `qwen3vl_4b_bf16.safetensors` rather than the `*_fp8_scaled` files.
  - **Attention:** `scripts/run-comfyui.sh` launches ComfyUI with
    `--use-split-cross-attention` on macOS. Without it, sampling a large region
    (e.g. an ADetailer face crop on a hires image) can deadlock PyTorch inside a
    single Metal `bmm` — the job sticks in `queue_running` and the app freezes on
    "Waiting for ComfyUI...". Override with `COMFYUI_CROSS_ATTENTION`
    (`split` default, `quad`, `none`, or a custom flag).
  - **ADetailer memory:** attention memory scales ~O(crop_px²), so face detailing
    on large hires images is memory-bound on unified memory — see
    [Hires and face detailing](#hires-and-face-detailing).

## Troubleshooting

- **`RuntimeError: Undefined type Float8_e4m3fn` at KSampler/CLIPLoader** — an
  fp8/fp4 model on Apple Silicon. Switch to a bf16 variant, or run on CUDA. See
  [Hardware notes](#hardware-notes).
- **`'NoneType' object has no attribute 'Params'` when loading an fp8 model** —
  ComfyUI was started before `comfy_kitchen` was installed, so the fp8 layout
  registry is empty in the running process. **Restart ComfyUI** (the venv already
  has `comfy_kitchen` after `setup:comfyui`).
- **Custom node changes not visible** — restart ComfyUI after running
  `setup:comfyui-config`; nodes load at startup.
- **Stuck on "Waiting for ComfyUI..." with ADetailer (Apple Silicon)** — a large
  face crop deadlocked or OOMed MPS (check the ComfyUI log for `Invalid buffer
  size` or a frozen `metal gpu stream` thread via `sample <pid>`). ComfyUI
  `/interrupt` cannot preempt a native MPS op, so **restart ComfyUI** to clear the
  stuck job. Ensure it launches with `--use-split-cross-attention` and lower
  `COMFYUI_ADETAILER_CROP_FACTOR` (default 1). See
  [ADetailer on Apple Silicon](#adetailer-on-apple-silicon-mps).
- **ADetailer leaves the face unchanged** — the detail pass skipped an
  already-large face. Fixed by `force_inpaint` (on by default); if you still see
  no change, confirm the app was rebuilt/restarted after updating.
- **Output is much larger than the requested width/height** (e.g. a 4x image with
  no Hires) — the upscaler was applied with Hires off. The upscaler is a Hires-fix
  stage only; leave `hires_upscale` at 1 to keep the requested size, or enable
  Hires to use the upscaler intentionally. See
  [Hires and face detailing](#hires-and-face-detailing). Fixed in current builds —
  rebuild/restart the app if you still see it.
- **`... exists but is not a git checkout`** — a custom node or the ComfyUI dir
  was created without `.git`. Move it aside and rerun the setup script.

- **Imported Civitai image differs from the source** — a `Version: ComfyUI` label
  does not include the original node graph, VAE, RNG, Hires stages, or custom
  node versions. Review the import completeness report and the
  [Civitai reproduction guide](civitai-metadata-reproduction.md).
- **Resolution guard** — image-gen rejects ComfyUI output above roughly 4.2 MP
  to prevent accidental 4K-to-8K jobs.

## Hires and face detailing

The image editor treats width and height as final output dimensions. Enabling
Hires creates a smaller first pass based on the selected factor, upscales to the
requested dimensions, and performs a second sampling pass.

The **Upscaler** model belongs to the Hires-fix pass — it enlarges the first pass
before ComfyUI scales back to the requested width/height. It is **only applied
when Hires is enabled** (`hires_upscale > 1`). With Hires off, the base render is
kept as-is at the requested size; the selected upscaler is just remembered for the
next time Hires is turned on. (Earlier builds ran the upscaler even with Hires off,
so a 4x model like Remacri silently produced a 4x-larger image, e.g. 832×1216 →
3328×4864. On Apple Silicon that oversized image is also what pushed ADetailer face
crops into the MPS OOM range below — keep the app rebuilt/restarted to get the fix.)

Enabling ADetailer adds an Impact Pack `FaceDetailer` pass with an Ultralytics
face detector. It can use a different checkpoint, detail-only LoRAs, separate
prompts, custom steps, confidence, mask blur, and denoise. ComfyUI must expose
`UltralyticsDetectorProvider` and `FaceDetailer` and have the selected detector
model. If missing, install ComfyUI Impact Pack, restart ComfyUI, and verify the
nodes appear in `/object_info`.

### ADetailer on Apple Silicon (MPS)

`FaceDetailer` runs with `force_inpaint` on, so it re-samples the whole face crop
at full resolution rather than skipping already-large faces (skipping is why a
detail pass can leave the face **unchanged**). The crop size is
`detected bbox × crop factor`; the crop is sampled and composited back through a
feathered mask, so **too small a crop leaves a visible seam** (the detailed face
has little surrounding context to blend into).

- **`COMFYUI_ADETAILER_CROP_FACTOR`** controls that multiplier. Default is **3**
  (Impact Pack's standard) for clean blending. Now that output is no longer
  silently 4x-upscaled (see above), a normal 832×1216 render has a ~260px face →
  ~800px crop that samples in ~1 min and fits MPS memory. Attention memory scales
  ~O(crop_px²), so **lower it toward 1 only when detailing very large (multi-MP
  hires) images** — measured on an M-series Mac with a 3328×4864 image (large face),
  crop factor 3.0 OOMs (~45 GiB), 1.5 thrashes, and 1.0 ≈ 108 s.
- If a seam is still visible, it is usually a **style mismatch from a different
  ADetailer checkpoint** (e.g. a realistic face model over an anime base) or too
  small a **mask blur / denoise**. Match the detail checkpoint to the base style,
  raise mask blur, or lower ADetailer denoise.
- Expect roughly **~100 s per detected face** on MPS for large hires images; this
  is inherent to unified-memory attention, not a hang.
- Impact Pack does not downscale-and-inpaint, so the crop factor is the only knob
  for sampling resolution. For faster results, generate at a smaller base size or
  run ADetailer without Hires fix (small faces are cheaply upscaled to
  `guide_size`).
