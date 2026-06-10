# Image Gen

Local image generation UI built with Next.js and ComfyUI.

![Image Gen screenshot](public/screenshot.png)

## Requirements

- Node.js
- npm
- Python 3
- git

## Setup

Install app dependencies:

```bash
npm install
```

Install ComfyUI into the project root on macOS/Linux:

```bash
npm run setup:comfyui
```

On Windows PowerShell:

```powershell
npm run setup:comfyui:win
```

The setup script clones ComfyUI into `ComfyUI/`, creates `ComfyUI/venv`, installs ComfyUI Python dependencies, and creates the expected model directories.

## Models

Model weights are not committed to git. Put local files in the matching ComfyUI folders:

```text
ComfyUI/models/checkpoints/
ComfyUI/models/loras/
ComfyUI/models/embeddings/
ComfyUI/models/vae/
ComfyUI/models/controlnet/
```

Files such as `.safetensors` stay local. Model metadata can be committed through `data/model-catalog.json`.

## Run

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
npm run dev
```

Open `http://localhost:3000`.

By default the app connects to `http://127.0.0.1:8188` and reads models from `ComfyUI/models`. Copy `.env.example` to `.env.local` if you need to override those paths.
