# Civitai metadata reproduction

Importing a Civitai image does not guarantee pixel-identical reproduction.
Civitai may publish the prompt and basic sampler values while omitting the
first-pass size, VAE, Hires workflow, RNG implementation, ComfyUI node graph,
and post-processing steps.

Start with [Local image backends](image-backends-setup.md) to install and run
ComfyUI, A1111, and Forge. Backend-specific setup is documented in
[ComfyUI](comfyui-setup.md), [A1111](a1111-setup.md), and
[Forge](forge-setup.md).

## Import diagnostics

After an image URL is imported, image-gen classifies every relevant field as:

- **Confirmed**: explicitly published by the source metadata.
- **Inferred**: derived from the model family, backend label, or final size.
- **Missing**: not recoverable from the published data.
- **Conflict**: source metadata and the local environment disagree.

The reproducibility score is a warning, not a quality score. A low score means
that identical seed and prompt values can still produce a substantially
different image.

Hover or focus the `?` icon beside a field to see why it matters. The UI uses
the selected application language for field explanations and recommendations.

## Recommendations are not source metadata

The importer presents separate presets:

1. **Closest reconstruction estimate** preserves confirmed values. When a large
   published final size implies an omitted upscale stage, it automatically uses
   the imported upscaler or `4x-UltraSharp` to reach that final size.
2. **Literal metadata** applies published values without inventing a Hires pass.
3. **Stable generation** favors a native first pass and lower failure risk.
4. **Quality priority** may change the sampler recipe and therefore is not meant
   for seed-for-seed reproduction.

Applying a recommendation does not replace matched local checkpoint, VAE, LoRA,
or embedding paths.

When the source metadata explicitly names ComfyUI, Forge, or A1111, that backend
is selected. Model-family guesses and generic version strings are not considered
proof of Forge; when the backend is uncertain, recommendations default to A1111.

## Illustrious and Forge guidance

Local controlled comparisons with WAI Illustrious v17 showed that changing
`Hires upscale` from `1` to `1.5` introduced visible noise, while changing CLIP
Skip between `1` and `2` did not change the output in the tested Forge setup.
Accordingly:

- When Hires metadata is missing, Stable and Quality recommendations use
  `Hires upscale: 1`, `Hires steps: 0`, and no Hires upscaler.
- The imported CLIP Skip value is preserved; image-gen does not force it to `1`.
- If the source explicitly publishes a Hires recipe, the literal/closest preset
  may preserve it, but it should still be treated as model-specific.
- For a larger final file, prefer generating a clean native-resolution image
  and upscaling the finished image separately instead of adding a denoising
  Hires pass.

These observations are defaults for this local stack, not universal claims
about every Illustrious checkpoint or Forge version.

## Comparing two settings correctly

Keep all of the following fixed before attributing a difference to one option:

- checkpoint file and hash;
- prompt and negative prompt;
- seed, sampler, scheduler, steps, and CFG;
- every LoRA/embedding and its weight;
- base dimensions, backend, and VAE.

Then change only one value. For example, compare `Hires 1 / CLIP Skip 2` against
`Hires 1.5 / CLIP Skip 2` before testing CLIP Skip separately.

## Common symptoms

- **Noise after Hires**: disable Hires (`upscale: 1`) first. A second denoising
  pass changes the latent and can amplify artifacts.
- **Blue or strongly shifted colors**: verify the VAE and avoid assuming that a
  published final size was the original single-pass size.
- **Same seed, different composition**: verify backend/version, RNG behavior,
  first-pass dimensions, sampler implementation, and workflow.
- **Forge `NoneType is not iterable` during Hires**: image-gen sends
  `hr_additional_modules: []`; restart the app after updating the code.
- **`Latent` missing from `/sdapi/v1/upscalers`**: Forge exposes latent modes
  through `/sdapi/v1/latent-upscale-modes`; this is expected.

## Information needed for the closest result

Ask the image author for the original PNG/JPEG with embedded generation data or
the exported ComfyUI API workflow. The most useful missing fields are first-pass
size, exact VAE, Hires scale/steps/upscaler/denoise, scheduler, custom nodes,
RNG/noise source, and post-processing settings.
