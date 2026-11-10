---
name: zimage-pipeline
description: "How Z-Image checkpoints are wired in this image generator (families, folders, support files)"
metadata:
  type: project
---

Z-Image (Tongyi-MAI) is a **Lumina2-architecture DiT with no bundled CLIP/VAE**, so it needs a dedicated pipeline like Krea 2 and Anima: `buildZImageWorkflow` in `src/lib/comfyui.ts`, routed from `buildDefaultWorkflow` before the diffusion-only guard whenever `isZImageCheckpointName(name)` and the checkpoint does not bundle CLIP.

Non-obvious details:
- Support files are `text_encoders/qwen_3_4b.safetensors` + `vae/ae.safetensors` (Flux 16ch VAE), both from `huggingface.co/Comfy-Org/z_image_turbo/split_files/...` and registered in `RUNPOD_BASE_ASSETS`.
- `CLIPLoader` type is **`lumina2`** — there is no `z_image` CLIPType; ComfyUI routes a Qwen3-4B state dict to its z_image text encoder for any type except FLUX/FLUX2.
- Latent must be `EmptySD3LatentImage` (16ch), plus `ModelSamplingAuraFlow` shift 3.
- Turbo recipe: 8 steps / cfg 1 / `res_multistep` + `simple` / `ConditioningZeroOut` negative. Base: cfg ~4 with a real negative.
- The weights work from **either** `models/checkpoints` (CheckpointLoaderSimple falls back to a diffusion-only load, null CLIP) **or** `models/diffusion_models` (UNETLoader); `resolveZImageModelLoader` picks by asking the target backend's `/object_info`.

Recipes came from [[comfyui-blueprints-recipe-source]].
