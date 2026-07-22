# AUTOMATIC1111 v1.10.0

Start with [Local image backends](image-backends-setup.md) for the full installation order. For imported-image caveats and presets, see [Civitai metadata reproduction](civitai-metadata-reproduction.md).

Install A1111, its Python environment, ADetailer, and the verified
4x-UltraSharp upscaler on Windows:

    npm run setup:a1111:win

On macOS/Linux, use:

    npm run setup:a1111

A1111 is installed locally under `stable-diffusion-webui/` with its own `venv/`.
The setup uses `.python310/python.exe` when present, otherwise the system Python
3.10 installed through `winget`. Runtime directories are git-ignored.

It shares model files with ComfyUI:

- Checkpoints: ComfyUI/models/checkpoints
- LoRAs: ComfyUI/models/loras
- Embeddings: ComfyUI/models/embeddings
- VAEs: ComfyUI/models/vae
- ESRGAN models: ComfyUI/models/upscale_models

The setup pins A1111 to v1.10.0, installs the official ADetailer extension and
its NumPy 1.x-compatible dependencies, and verifies 4x-UltraSharp with SHA-256.
It is safe to rerun the setup to install a missing ADetailer checkout. An
incomplete or non-git extension directory stops setup with its exact path
instead of silently continuing.

Start the API/UI on Windows:

    npm run a1111:win

`npm run local:win` also installs A1111 when its checkout or virtualenv is
missing, then starts it alongside ComfyUI and image-gen. It clears an existing
listener on port 7860 first and writes logs to `.local/logs/`.

The server listens at http://127.0.0.1:7860. The image-gen app uses
A1111_BASE_URL from .env.local, defaulting to that address.

In image-gen, select AUTOMATIC1111 v1.10.0 under Generation backend.
Civitai metadata produced by A1111 automatically recommends this backend.
Krea 2, Wan, and ComfyUI-native workflows should continue using ComfyUI.

When the API is offline and A1111 is selected, image-gen can start it on demand
using `scripts/run-a1111.ps1` (Windows) or `scripts/run-a1111.sh`. For a custom
installation set `A1111_LAUNCH_CMD`; adjust `WEBUI_BOOT_TIMEOUT_MS` if startup
takes longer than five minutes.

## Hires and ADetailer

The editor's width and height are final dimensions. With Hires enabled, the
request derives a smaller first pass and sets `hr_resize_x`/`hr_resize_y` to the
exact requested output size.

ADetailer is a WebUI extension rather than an A1111 core feature. The Windows
setup installs it automatically under
`stable-diffusion-webui/extensions/adetailer`; `npm run local:win` detects and
repairs a missing extension before starting A1111. Image-gen sends
the selected detector plus optional detail checkpoint, detail-only LoRAs,
separate prompts, steps, confidence, mask blur, noise multiplier, masked-inpaint
mode, and denoise strength. If the API reports `Script 'ADetailer' not found`,
rerun `npm run setup:a1111:win` and restart A1111.

If A1111 reports `could not find upscaler named 4x-UltraSharp`, verify
`ComfyUI/models/upscale_models/4x-UltraSharp.pth` exists and restart A1111.

If generation reports `Expected all tensors to be on the same device` with CPU
and CUDA, image-gen now unloads/reloads the active WebUI checkpoint and retries
once. Restart A1111 if the retry also fails; then check whether a newly added
LoRA or VAE is compatible with the checkpoint.
