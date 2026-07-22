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
