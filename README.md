# Image Gen

Local image generation UI built with Next.js and ComfyUI.

![Image Gen screenshot 1](public/image_1.png)

![Image Gen screenshot 2](public/image_2.png)

## Requirements

- Node.js
- npm
- Python 3
- git

## Setup

Start with [Local image backends](docs/image-backends-setup.md) for the complete
Windows setup order, shared model layout, ports, and backend selection. Related
guides: [ComfyUI](docs/comfyui-setup.md), [A1111](docs/a1111-setup.md),
[Forge](docs/forge-setup.md), and
[Civitai metadata reproduction](docs/civitai-metadata-reproduction.md).

Install app dependencies:

```bash
npm install
```

Configure the local git merge driver once after cloning:

```bash
npm run setup:git-merge
```

On Windows PowerShell:

```powershell
npm run setup:git-merge:win
```

Install ComfyUI into the project root on macOS/Linux:

```bash
npm run setup:comfyui
```

On Windows PowerShell:

```powershell
npm run setup:comfyui:win
```

The setup script clones ComfyUI into `ComfyUI/`, creates `ComfyUI/venv`, installs ComfyUI Python dependencies, and creates the expected model directories. It pins ComfyUI to the commit in `comfyui-config/comfyui-version.txt` for reproducibility, and then provisions the version-controlled ComfyUI config (see below).

## ComfyUI config (custom nodes, workflows, settings)

Unlike model weights, small ComfyUI assets are version-controlled under `comfyui-config/` so a fresh clone can reproduce the same setup:

```text
comfyui-config/custom-nodes.json      # custom node repos pinned to commits
comfyui-config/comfyui-version.txt    # pinned ComfyUI commit
comfyui-config/workflows/             # GUI workflow JSONs
comfyui-config/settings/              # baseline comfy.settings.json
```

`npm run setup:comfyui` provisions these automatically. To (re)provision on its own:

```bash
npm run setup:comfyui-config          # macOS/Linux
npm run setup:comfyui-config:win      # Windows
```

The provisioning is idempotent: it installs/pins custom nodes into `ComfyUI/custom_nodes/`, copies workflows into `ComfyUI/user/default/workflows/`, and seeds settings only if missing. Pass `--force` (or `-Force` on Windows) to overwrite existing workflows/settings. To add a node or bump a version, edit `comfyui-config/custom-nodes.json` and rerun. Restart ComfyUI afterward to load new nodes.

## Models

Model weights are not committed to git. Put local files in the matching ComfyUI folders:

```text
ComfyUI/models/checkpoints/
ComfyUI/models/loras/
ComfyUI/models/embeddings/
ComfyUI/models/vae/
ComfyUI/models/upscale_models/
ComfyUI/models/controlnet/
```

Files such as `.safetensors` stay local. Model metadata can be committed through `data/model-catalog.json`.

`data/model-catalog.json` is shared, but every user may have different local
models. The repo includes a custom git merge driver for that file. During
`git pull`, it keeps your local catalog values for matching model paths and
adds new catalog entries from the pulled branch when they do not exist locally.
Run `npm run setup:git-merge` once per clone so git can use that merge driver.

## Run

On macOS, double-click `Launch Image Gen.command` from Finder. It starts ComfyUI and the Next.js app, then opens `http://localhost:5353`.

On Windows, double-click `Launch Image Gen.bat`. It runs the same local launcher through PowerShell.

You can also run the same launcher from a terminal:

```bash
npm run local
```

On Windows PowerShell:

```powershell
npm run local:win
```

Start ComfyUI on macOS/Linux:

```bash
npm run comfyui
```

On Windows PowerShell:

```powershell
npm run comfyui:win
```

Start the Next.js app in another terminal:

```bash
npm run dev -- --port 5353
```

Open `http://localhost:5353`.

By default the app connects to `http://127.0.0.1:8188` and reads models from `ComfyUI/models`. Copy `.env.example` to `.env.local` if you need to override those paths.

## Video generation

The Video Generation page queues a ComfyUI API workflow from `COMFYUI_VIDEO_WORKFLOW_PATH`.
Export an API-format workflow JSON from ComfyUI and use placeholders such as
`{{prompt}}`, `{{negative_prompt}}`, `{{width}}`, `{{height}}`, `{{num_frames}}`,
`{{fps}}`, `{{steps}}`, `{{cfg}}`, `{{seed}}`, and `{{source_image}}` in node inputs
that should be filled from the UI.

This repo includes two Wan 2.2 I2V API workflows:

```text
workflows/wan22-i2v-base-api.json
workflows/wan22-i2v-civitai-133468541-api.json
```

The base workflow uses native ComfyUI Wan 2.2 image-to-video nodes and expects
these files:

```text
ComfyUI/models/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors
ComfyUI/models/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors
ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors
ComfyUI/models/vae/wan_2.1_vae.safetensors
```

The Civitai workflow additionally expects these LoRA files in
`ComfyUI/models/loras/`:

```text
doggyPOV_v1_1.safetensors
DR34ML4Y_I2V_14B_LOW_V2.safetensors
```

Civitai requires an API token for those LoRA downloads. On Windows PowerShell:

```powershell
$env:CIVITAI_API_TOKEN="your-token"
powershell -ExecutionPolicy Bypass -File scripts/download-civitai-video-loras.ps1
```

Then set `COMFYUI_VIDEO_WORKFLOW_PATH` to
`workflows/wan22-i2v-civitai-133468541-api.json` and restart the app.
