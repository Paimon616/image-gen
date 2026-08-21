# Image generation UI

The image page uses a resizable editor on the left and the gallery on the right.
The editor can be collapsed, and gallery thumbnail width is adjustable.

## Editor sections

- **Import** loads a Civitai URL or image metadata and reports confirmed,
  inferred, missing, and conflicting recipe fields.
- **Models** selects the checkpoint, LoRAs, and embeddings.
- **Composition** contains text-to-image, image-to-image, pose reference,
  prompts, source images, ControlNet, style, and character references.
- **Output** selects the backend, final width/height, and image count.
- **Advanced** contains sampling, seed, VAE, prompt weighting, and ControlNet.
- **Upscaler** enables the Hires/refinement pass.
- **ADetailer** enables a separate face-detection and detail pass.

Field labels include contextual help in Korean and English.

## Final-size semantics

Output width and height are always the desired final image size. With a `2×`
factor, for example, `1024 × 1536` begins near `512 × 768` and finishes at the
requested size. Dimensions are normalized to backend-safe multiples of 8. This
avoids multiplying an already-final Civitai size a second time.

New gallery metadata records `size_semantics: final`. Older saved recipes that
used base-size semantics are converted to their final-size equivalent when
loaded into the editor.

## Krea 2 workflows

Krea 2 checkpoints route to a dedicated pipeline, and the Output section picks which
variant runs:

- **Generic** — the official ComfyUI Krea 2 Turbo recipe: one KSampler pass
  (euler/simple), cfg 1, the negative zeroed out.
- **Generic Refined** — Generic plus a low-denoise second pass (dpmpp_2m/karras) to
  clean up turbo grain. Stock nodes only.
- **Custom Krea PornMaster** — the original RES4LYF two-stage ClownsharKSampler
  recipe. Needs the RES4LYF node pack plus its own text encoder and VAE.
- **Moody photo finish** — the Moody-family author's published recipe, reconstructed
  from the generation metadata embedded in that model's Civitai gallery: one
  `euler_ancestral`/`beta` pass at 10 steps, then **no second diffusion pass at all**.
  The decoded image is enlarged twice — once with lanczos, once with the
  `4xNomosWebPhoto_RealPLKSR` photo-restoration upscaler — and the two are mixed with
  `ImageBlend` (default `0.6` toward the upscaler, exposed as *Upscale blend*). Krea 2
  is trained on deliberately raw photography, so its grain resolves in image space;
  re-diffusing it at full size only puts the grain back.

Because the base pass samples at *final size ÷ hires factor*, `2048 × 3072` at `2×`
reproduces the author's `1024 × 1536` base. Krea 2 and Z-Image also floor that base at
768 px on the short side — a distilled DiT collapses below it, and no low-denoise pass
recovers the detail.

Selecting a workflow checks whether the active target actually has what it needs. Any
missing text encoder, VAE, upscale model, or catalog-known checkpoint is listed with a
one-click install that downloads all of them — into `ComfyUI/models/...` for local, or
onto the pod's disk for RunPod. Sources live in one table, `src/lib/support-assets.ts`,
so both installers fetch the same file.

## ADetailer

ADetailer can configure a face detector, optional detail checkpoint, detail-only
LoRAs, separate prompts, inherited or custom steps, confidence, mask blur,
masked-only inpainting, noise multiplier, and denoise. Blank detail prompts
inherit the main prompts; a blank checkpoint uses the main checkpoint. See
[Local image backends](image-backends-setup.md#hires-and-adetailer-backend-behavior)
for backend prerequisites.

## Gallery and image viewer

Pending jobs show live status. Failed jobs can reload their settings, copy the
error, or remove the card. Generated images can be viewed fitted or at original
size, downloaded, copied, deleted, or used to restore generation settings.

The viewer distinguishes first-pass size from actual final size and shows Hires
settings. Prompts and metadata can be copied. Checkpoint, LoRA, embedding, and
upscaler rows open catalog details and can be applied back to the editor.
