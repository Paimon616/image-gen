# Krea 2 on the RTX 3060 GPU worker

- Files on the worker: `diffusion_models/krea2_turbo_fp8_scaled.safetensors`, `text_encoders/qwen3vl_4b_fp8_scaled.safetensors`, `vae/qwen_image_vae.safetensors`, `loras/krea2_identity_edit_v1_2.safetensors`, plus `diffusion_models/krea2_turbo-Q5_K_M.gguf`. Nodes `comfyui-krea2edit` and `ComfyUI-GGUF` are pinned in `worker-kit/windows/custom-nodes.json` (installed via the update button).
- fp8 beats GGUF Q5 on a 12 GB Ampere card (51.8 s vs 60.8 s per 832×1216 image, 8 steps; 98 s vs 111 s with the character reference). Ampere has no fp8 math, but ComfyUI's async offload hides the partial load; GGUF pays per-layer dequant. Keep fp8 as the default there.
- The GPU-worker dispatcher must look for `checkpoints/<name>` in `diffusion_models`, `unet` and `unet_gguf` too, or Krea 2 is rejected as missing (`CHECKPOINT_FOLDERS`).
- Krea 2 character reference (Identity Edit) copies hard: `ref_position` defaults to `aligned`, and strength 0.7 becomes `ref_boost` 2.1 (1.0 = neutral). The old instruction "keep ... the illustration style" turns semi-real scenes into illustration when the layout pin is removed. See `docs/character-reference-sheet.md` R23–R25.
- Use semi-real sheets made with Krea 2 itself as references; an anime SDXL sheet bleeds its white background and flat colour into Krea 2 scenes.
- The worker's Wi-Fi capped each HTTPS download at ~2.5 MB/s; on wired it reached ~65 MB/s. The worker IP changed with the switch (now 10.202.66.127).
