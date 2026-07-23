# Local image backends

This project uses three local generation servers. Their runtime directories and
model weights are git-ignored, so every new machine must run the setup commands.

## Documentation map

- [ComfyUI setup](comfyui-setup.md): pinned runtime, custom nodes, Krea 2, model folders, and hardware notes.
- [A1111 setup](a1111-setup.md): A1111 v1.10.0, shared models, and UltraSharp.
- [Forge setup](forge-setup.md): Forge installation, shared paths, API port, and VRAM behavior.
- [Civitai metadata reproduction](civitai-metadata-reproduction.md): missing-field diagnostics and recommendation presets.
- [Image-to-prompt setup](comfyui-image-to-prompt-setup.md): WD14 and Florence node setup.
- [RunPod deployment](RUNPOD-image-gen-deploy.md): remote ComfyUI deployment.

| Backend | Default URL | Recommended use |
| --- | --- | --- |
| ComfyUI | `http://127.0.0.1:8188` | Krea 2, Wan/LTX, video, ComfyUI workflows |
| AUTOMATIC1111 v1.10.0 | `http://127.0.0.1:7860` | Civitai images made with A1111 |
| ForgeUI | `http://127.0.0.1:7861` | Illustrious/SDXL models needing Forge compatibility |

## Fresh Windows setup

Install Git, Node.js/npm, Windows `winget`, and an NVIDIA driver first. The
scripts install Python 3.10 when it is missing.

```powershell
git clone <repository-url> image-gen
cd image-gen
npm install
npm run setup:git-merge:win
npm run setup:comfyui:win
npm run setup:a1111:win
npm run setup:forge:win
Copy-Item .env.example .env.local
```

The A1111 and Forge setup commands install the official ADetailer extension and
its compatible detector dependencies automatically. Rerunning a setup command
installs a missing extension; an incomplete checkout fails setup visibly. The
local launcher also checks ADetailer before starting managed WebUI backends and
invokes setup when it is absent.

Run each API in a separate terminal, then start the app:

```powershell
npm run comfyui:win
npm run a1111:win
npm run forge:win
npm run dev
```

All three servers may remain running. Before generation, image-gen asks the two
inactive backends to unload their checkpoints. An idle process still uses some
VRAM for CUDA/runtime state; closing unused servers gives the lowest usage.

## Shared models

Weights are not committed. Store them under `ComfyUI/models/`:

```text
checkpoints/       # SD 1.5, SDXL, Illustrious checkpoints
diffusion_models/  # Krea 2, Wan, LTX diffusion/UNET weights
text_encoders/     # Krea 2 and other text encoders
loras/             # shared LoRAs
embeddings/        # textual-inversion/negative embeddings
vae/               # VAEs
upscale_models/    # ESRGAN/UltraSharp upscalers
latent_upscale_models/ # LTX latent upscalers
```

A1111 and Forge receive these paths through launch arguments. Do not duplicate
checkpoints in each runtime. Restart a backend after adding a model if refresh
does not discover it.

The A1111 setup installs and verifies `4x-UltraSharp.pth`. Civitai's
`4x-UltraSharp` and the filename refer to the same model; image-gen resolves the
backend-specific name automatically.

Prompt embeddings must exist locally. Names such as `EasyNegative`, `badhandv4`,
and `ng_deepnegative_v1_75t` are dependencies, not built-in keywords. Download
the exact resources used by the source image into `embeddings/`.

## Environment

Copy `.env.example` to `.env.local`. These defaults work locally:

```dotenv
COMFYUI_BASE_URL=http://127.0.0.1:8188
COMFYUI_MODELS_DIR=ComfyUI/models
A1111_BASE_URL=http://127.0.0.1:7860
FORGE_BASE_URL=http://127.0.0.1:7861
A1111_TIMEOUT_MS=3600000
```

Never commit tokens from `.env.local`.

Optional WebUI process settings:

```dotenv
WEBUI_BOOT_TIMEOUT_MS=300000
# A1111_LAUNCH_CMD=powershell ...
# FORGE_LAUNCH_CMD=powershell ...
```

When A1111 or Forge is selected but its API is not running, image-gen starts the
platform-appropriate script automatically (`.ps1` on Windows, `.sh` elsewhere).
Set a launch command only for a custom installation. It runs through PowerShell
on Windows and through `bash -lc` on macOS/Linux.

## Hires and ADetailer backend behavior

The editor's width and height are final output dimensions. With Hires enabled,
image-gen divides them by the upscale factor for the first pass (rounded to a
multiple of 8), then refines at the requested final size. Older gallery metadata
that stored first-pass dimensions is normalized when loaded into the editor.

- A1111/Forge use the WebUI ADetailer extension installed by their setup
  scripts and pass its detector, detail
  checkpoint, detail-only LoRAs, prompts, steps, confidence, mask, noise, and
  denoise settings.
- ComfyUI builds an Impact Pack `FaceDetailer` workflow with an Ultralytics face
  detector. The running ComfyUI must provide `UltralyticsDetectorProvider` and
  `FaceDetailer` plus their detector models. On **Apple Silicon (MPS)** the face
  crop must stay small enough to fit unified memory (env
  `COMFYUI_ADETAILER_CROP_FACTOR`, default 1) and ComfyUI needs
  `--use-split-cross-attention` to avoid a Metal deadlock — see
  [ComfyUI setup › ADetailer on Apple Silicon](comfyui-setup.md#adetailer-on-apple-silicon-mps).

See [Image generation UI](image-generation-ui.md) for the controls and metadata
semantics.

## Video generation: Wan 2.2 and LTX 2.3

The `/video` page has three presets. The selected preset chooses an allowlisted
workflow; the environment variable is only the default/fallback.

| UI preset | Workflow | Input |
| --- | --- | --- |
| Wan 2.2 SmoothMix | `workflows/wan22-i2v-smoothmix-api.json` | image required |
| Wan 2.2 Base | `workflows/wan22-i2v-base-api.json` | image required |
| LTX 2.3 10Eros | `workflows/ltx23-10eros-t2v-api.json` | text prompt |

Set the fallback in `.env.local`:

```dotenv
COMFYUI_VIDEO_WORKFLOW_PATH=workflows/wan22-i2v-smoothmix-api.json
```

Place the following Wan files under `ComfyUI/models/`. Keep the filenames
exactly as shown because the committed workflow refers to them by name.

| Folder | Filename | SHA-256 / source |
| --- | --- | --- |
| `diffusion_models` | `smoothMixWan2214BI2V_i2vV20High.safetensors` | `1F40184EBD858B179D71FDCFA9C1EBC5CB79FA7AE90474C5BA44CE8ABE5E9BC3`; [Smooth Mix version 2513182](https://civitai.red/models/1995784?modelVersionId=2513182) |
| `diffusion_models` | `wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors` | Wan 2.2 I2V low-noise base model |
| `text_encoders` | `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | Wan UMT5 encoder |
| `vae` | `wan_2.1_vae.safetensors` | Wan 2.1 VAE; do not substitute `wan2.2_vae` |
| `loras` | `SmoothXXXAnimation_High.safetensors` | SmoothMix high-noise LoRA |
| `loras` | `SmoothXXXAnimation_Low.safetensors` | `AD50DFC46C765A6CCC36D40E8A5F77AC2DB041F68266593ADD12AC5F5EAC2D76` |
| `loras` | `matingPressHigh.safetensors` | Optional high-noise motion LoRA |
| `loras` | `matingPressLow.safetensors` | `C076FC7A1E61D7F1AAA7B426C2F95BDEC54833F3EB746C16DF561BFB97DD39A0` |
| `loras` | `lightx2v_I2V_14B_480p_cfg_step_distill_rank128_bf16.safetensors` | `5C324ADA09CFA447844F5D9A57240463A515DE38270EF40C7513D74BE3E64E72`; [LightX2V](https://huggingface.co/Kijai/WanVideo_comfy/tree/main/Lightx2v) |

LTX 2.3 uses these files:

| Folder | Filename | SHA-256 / source |
| --- | --- | --- |
| `checkpoints` | `ltx2310eros_v1.safetensors` | LTX 2.3 10Eros checkpoint from the model catalog |
| `text_encoders` | `gemma_3_12B_it_fp4_mixed.safetensors` | `AACA463D11E6D8D2A4BDB0D6299214C15EF78A3F73E0EF8113D5A9D0219B3F6D`; [Comfy-Org Gemma](https://huggingface.co/Comfy-Org/ltx-2/blob/main/split_files/text_encoders/gemma_3_12B_it_fp4_mixed.safetensors) |
| `latent_upscale_models` | `ltx-2.3-spatial-upscaler-x2-1.1.safetensors` | `5F416311FA8172B65AF67530758964708D29A317B830D689A51143B7F91913ED`; [official LTX upscaler](https://huggingface.co/Lightricks/LTX-2.3/blob/main/ltx-2.3-spatial-upscaler-x2-1.1.safetensors) |
| `loras` | `DR34ML4Y_LTXXX_V2.safetensors` | LTX LoRA from the model catalog |
| `loras` | `DaSiWa*.safetensors` | LTX LoRA from the model catalog; retain the downloaded catalog filename |

After copying weights, restart ComfyUI. Open `/video`, select a model, and set
any unwanted LoRA strength to `0` to disable it. For Wan on a 12 GB GPU, a good
13:19 starting point is `416x608`, 81 frames, 16 fps, 6 steps, and CFG 1. Use
VAE tile `256`, tile overlap `64`, temporal tile `64`, and temporal overlap
`16`. Increasing temporal tile size reduces periodic brightness seams but uses
more VRAM. The LTX checkpoint and encoder together are very large, so generation
on 12 GB VRAM can be substantially slower and needs ample system RAM.

Common video failures:

- `expected ... 36 channels, but got 64` means the Wan VAE is incompatible.
  Select `wan_2.1_vae.safetensors`, restart ComfyUI, and queue again.
- Regular flashes usually come from temporal VAE tile boundaries. Increase the
  temporal tile from 16/32 to 64 while keeping overlap at 16.
- A soft or washed-out source can come from generating at an imported final
  upscale size. The Civitai importer clamps video dimensions; for a 4992x7296
  (13:19) source, use `416x608` rather than the original pixel dimensions.
- If a model is missing after download, restart ComfyUI and confirm the exact
  folder and filename. The UI model list comes from the running ComfyUI API.

Finally, verify that `http://127.0.0.1:8188/object_info` responds, then open
`http://127.0.0.1:3000/video` (or the port printed by `npm run dev`). Model
weights and `.env.local` remain local and must never be added to Git.

## Civitai reproduction notes

Civitai metadata is not always a complete recipe. Exact reproduction also needs
the same checkpoint hash, VAE, LoRAs, embeddings, backend/version, sampler
implementation, and post-processing pipeline. Omitted values cannot be inferred
with certainty.

For A1111-style metadata, image-gen applies these absent-value defaults:

- missing `Clip skip`: `1`
- missing `Hires steps`: `0`
- prompt LoRA weights override resource-card weights

Civitai may report final upscaled dimensions instead of the first pass. The
importer reports confirmed, inferred, missing, and conflicting fields, then
offers separate closest, literal, stable, and quality presets. Recommendations
are not presented as source metadata. See
[Civitai metadata reproduction](civitai-metadata-reproduction.md).

## Troubleshooting

1. Confirm the selected backend URL responds and check its terminal output.
2. Confirm the checkpoint hash and every LoRA, embedding, and VAE dependency.
3. Restart the backend after adding models.
4. For Illustrious metadata with no published Hires recipe, start with Hires
   disabled (`upscale: 1`). Upscale the finished image separately if needed.
   image-gen blocks ComfyUI jobs above roughly 4.2 MP final output.
5. If an upscaler is rejected, verify its actual file under `upscale_models/`,
   then restart the backend. Names with and without a model extension are
   normalized where supported.
6. Pure noise usually indicates an incompatible checkpoint, VAE, backend, or
   Hires/sampler configuration rather than merely a different seed.

See [ComfyUI](comfyui-setup.md), [A1111](a1111-setup.md), and
[Forge](forge-setup.md) for backend-specific details.
