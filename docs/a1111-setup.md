# AUTOMATIC1111 v1.10.0

Start with [Local image backends](image-backends-setup.md) for the full installation order. For imported-image caveats and presets, see [Civitai metadata reproduction](civitai-metadata-reproduction.md).

Install A1111, its Python environment, and the verified 4x-UltraSharp upscaler on Windows:

    npm run setup:a1111:win

A1111 is installed locally under `stable-diffusion-webui/` with its own `venv/`.
The setup uses `.python310/python.exe` when present, otherwise the system Python
3.10 installed through `winget`. Runtime directories are git-ignored.

It shares model files with ComfyUI:

- Checkpoints: ComfyUI/models/checkpoints
- LoRAs: ComfyUI/models/loras
- Embeddings: ComfyUI/models/embeddings
- VAEs: ComfyUI/models/vae
- ESRGAN models: ComfyUI/models/upscale_models

The setup pins A1111 to v1.10.0 and verifies 4x-UltraSharp with SHA-256 before installation.

Start the API/UI on Windows:

    npm run a1111:win

The server listens at http://127.0.0.1:7860. The image-gen app uses
A1111_BASE_URL from .env.local, defaulting to that address.

In image-gen, select AUTOMATIC1111 v1.10.0 under Generation backend.
Civitai metadata produced by A1111 automatically recommends this backend.
Krea 2, Wan, and ComfyUI-native workflows should continue using ComfyUI.

If A1111 reports `could not find upscaler named 4x-UltraSharp`, verify
`ComfyUI/models/upscale_models/4x-UltraSharp.pth` exists and restart A1111.

If generation reports `Expected all tensors to be on the same device` with CPU
and CUDA, image-gen now unloads/reloads the active WebUI checkpoint and retries
once. Restart A1111 if the retry also fails; then check whether a newly added
LoRA or VAE is compatible with the checkpoint.
