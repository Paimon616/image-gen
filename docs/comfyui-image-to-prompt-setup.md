# ComfyUI Image-to-Prompt Setup

This project does not commit the `ComfyUI/` directory, custom nodes, Python virtualenvs, or model weights. The app code is shared through Git; each developer recreates the ComfyUI runtime locally with the setup scripts below.

## What Git Shares

- Next.js app code for `/api/interrogate` and the `/interrogate` Image to Prompt page.
- ComfyUI custom-node setup scripts.
- Environment variable examples.
- Optional ComfyUI API workflow hooks through env vars.

## What Git Does Not Share

- `ComfyUI/`
- `ComfyUI/custom_nodes/`
- `ComfyUI/venv/`
- downloaded WD14, Florence, checkpoint, LoRA, VAE, or `.safetensors` files

These are machine-local runtime dependencies and are intentionally ignored.

## Windows Setup

```powershell
npm run setup:comfyui:win
npm run setup:itp-nodes:win
npm run comfyui:win
```

Start the app in another terminal:

```powershell
npm run dev
```

## macOS/Linux Setup

```bash
npm run setup:comfyui
npm run setup:itp-nodes
npm run comfyui
```

Start the app in another terminal:

```bash
npm run dev
```

## Installed Custom Nodes

`setup:itp-nodes` installs or updates these ComfyUI custom nodes under `ComfyUI/custom_nodes/`:

- `pythongosssss/ComfyUI-WD14-Tagger`
- `pythongosssss/ComfyUI-Custom-Scripts`
- `kijai/ComfyUI-Florence2`

ComfyUI must be restarted after installation.

## App Behavior

The `/interrogate` Image to Prompt page sends uploaded images to local ComfyUI through `/api/interrogate`.

- `auto`: uses WD14 for Illustrious, Pony, NoobAI, and Anima base models. For other base models it uses Florence only when `COMFYUI_ITP_FLORENCE_WORKFLOW_PATH` is configured; otherwise it falls back to WD14.
- `wd14`: uses the built-in WD14 workflow.
- `florence`: requires a ComfyUI API workflow JSON path in `COMFYUI_ITP_FLORENCE_WORKFLOW_PATH`.

## Environment Variables

```env
COMFYUI_ITP_WD14_MODEL=wd-swinv2-tagger-v3
COMFYUI_ITP_WD14_THRESHOLD=0.35
COMFYUI_ITP_WD14_CHARACTER_THRESHOLD=0.85
COMFYUI_ITP_WD14_EXCLUDE_TAGS=
COMFYUI_ITP_WD14_WORKFLOW_PATH=
COMFYUI_ITP_FLORENCE_WORKFLOW_PATH=
```

Use `COMFYUI_ITP_WD14_WORKFLOW_PATH` if your WD14 node fields differ from the built-in workflow. Use `{{image}}` in that workflow JSON where the uploaded ComfyUI input filename should be inserted.

Use `COMFYUI_ITP_FLORENCE_WORKFLOW_PATH` for Florence because Florence custom-node API workflows vary by node version. The workflow must end in a node that exposes text in `/history`, such as `ShowText|pysssss`, and should use `{{image}}` for the uploaded image filename.

## Troubleshooting

- `Cannot execute because node class does not exist`: run `npm run setup:itp-nodes:win` or `npm run setup:itp-nodes`, then restart ComfyUI.
- `ComfyUI image-to-prompt timed out`: confirm the workflow ends with a text display/save node whose output appears in `/history`.
- `Florence mode requires COMFYUI_ITP_FLORENCE_WORKFLOW_PATH`: either select `WD14 tags` in the UI or export a Florence API workflow JSON and set the env var.
- First WD14 run may download tagger weights into the ComfyUI environment. Those files are not committed.
