# ForgeUI

Start with [Local image backends](image-backends-setup.md) for the full installation order. For metadata completeness and recommendation behavior, see [Civitai metadata reproduction](civitai-metadata-reproduction.md).

Install the official Stable Diffusion WebUI Forge checkout on Windows:

    npm run setup:forge:win

Start Forge on `http://127.0.0.1:7861`:

    npm run forge:win

Forge shares the existing ComfyUI model directories for checkpoints, LoRAs,
embeddings, VAEs, and ESRGAN upscalers. Set `FORGE_BASE_URL` when using another address.

The app can keep ComfyUI, A1111, and Forge APIs running together. Before a
request, it unloads models from the two inactive backends so only the selected
backend retains model VRAM. Select `ForgeUI` for Forge/Illustrious compatibility.

Unlike pinned A1111 and ComfyUI revisions, the default Forge setup follows its
`main` branch. Rerunning setup may therefore change Forge behavior. The setup
also installs the required OpenAI CLIP package; rerun it if `clip` is missing.

Forge exposes pixel upscalers through `/sdapi/v1/upscalers` and Latent modes
through `/sdapi/v1/latent-upscale-modes`. Image-gen handles both lists.
