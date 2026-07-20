# AUTOMATIC1111 v1.10.0

Install A1111, its Python environment, and the verified 4x-UltraSharp upscaler on Windows:

    npm run setup:a1111:win

A1111 is installed locally under stable-diffusion-webui/ and uses the dedicated
Python 3.10 runtime in .python310/. Both directories are git-ignored.

It shares model files with ComfyUI:

- Checkpoints: ComfyUI/models/checkpoints
- LoRAs: ComfyUI/models/loras
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