# ForgeUI

Start with [Local image backends](image-backends-setup.md) for the full installation order. For metadata completeness and recommendation behavior, see [Civitai metadata reproduction](civitai-metadata-reproduction.md).

Install the official Stable Diffusion WebUI Forge checkout and ADetailer on Windows:

    npm run setup:forge:win

On macOS/Linux, use:

    npm run setup:forge

Start Forge on `http://127.0.0.1:7861`:

    npm run forge:win

Forge shares the existing ComfyUI model directories for checkpoints, LoRAs,
embeddings, VAEs, and ESRGAN upscalers. Set `FORGE_BASE_URL` when using another address.

The app can keep ComfyUI, A1111, and Forge APIs running together. Before a
request, it unloads models from the two inactive backends so only the selected
backend retains model VRAM. Select `ForgeUI` for Forge/Illustrious compatibility.

Unlike pinned A1111 and ComfyUI revisions, the default Forge setup follows its
`main` branch. Rerunning setup may therefore change Forge behavior. The setup
also installs the required OpenAI CLIP package, the official ADetailer extension,
and NumPy 1.x-compatible ADetailer dependencies. Rerun it if `clip` or
`stable-diffusion-webui-forge/extensions/adetailer` is missing.

Forge exposes pixel upscalers through `/sdapi/v1/upscalers` and Latent modes
through `/sdapi/v1/latent-upscale-modes`. Image-gen handles both lists.
