---
name: minimax-h3-multiref-pipeline
description: "The native multi-ref MiniMax H3 pipeline (minimax-h3-native-multiref-i2va), its mp4-extraction origin, and the extra_ref_images injection contract"
metadata:
  type: project
---

Pipeline id `minimax-h3-native-multiref-i2va` ("MiniMax H3 (native) - Multi-Ref I2VA"), workflow `workflows/minimax-h3-native-multiref-i2va.json` (23 nodes). Added 2026-08-29, extracted from the embedded ComfyUI prompt inside a downloaded mp4 whose hands rendered cleanly — mp4s carry the flat prompt + UI graph as JSON blobs findable by scanning for balanced `{"` … `"class_type"` spans (no ffprobe needed).

Why hands survive here vs [[minimax-h3-dasiwa-pipeline]]: native `MiniMaxH3ReferenceToVideo` with up to 4 keyframe images pinned to timestamps in the prompt header, NO MiniMaxH3Cache, NO style LoRA, and core `ExtendIntermediateSigmas` adding low-sigma detail steps (default 2 below σ0.65). Same REF2VA Hybrid checkpoint + qwen3vl nvfp4 encoder, so the existing pod setup works — only KJNodes needed beyond ComfyUI ≥0.30.

Transform decisions (captured graph → repo workflow): ComfyMathExpression/PrimitiveFloat length math replaced by server-side calc in `applyVideoPipelineSettingsToWorkflow` (frames = max(5, round(duration*24)) snapped up to ≡5 mod 17; fps fixed 24); `easy int` width/height inlined as literals on node 136; rgthree Power Lora Loader stripped (was off); SageAttention defaulted to disabled (source used auto+compile) with controls to re-enable.

Injection contract: `params.extra_ref_images?: string[]` (2nd–4th keyframes; UI shows Keyframe 2–4 ImageUploads when pipeline `maxRefImages` > 1). `applyMinimaxMultiRefToWorkflow` (comfyui.ts) assigns [source_image, ...extra] to `ref_images.ref_image_N` LoadImages in order and DELETES unused ref entries + LoadImage nodes (leftover placeholders fail validation); it also owns the prompt node (title "Reference Alignment Script" deliberately avoids the generic /prompt/i patcher) and prepends a "Picture N aligns with the X-second mark" header from `refN_seconds` settings unless the prompt already contains "aligns with the". Gaps in extra refs collapse (arrays are Boolean-filtered at every layer).

Pipeline `traits` (bestFor/strengths/weaknesses) were added to VideoPipelineDefinition for ALL video pipelines and render as a card under the pipeline picker on /video.

Gotcha (fixed 2026-08-31): the generic `CreateVideo` patch in `applyVideoParamsToWorkflow` sets `inputs.fps = params.fps`, and params.fps sits at its 16 default whenever the canvas panel is hidden — the first multi-ref clips muxed 24fps motion at 16fps (22.6s slow motion, audio desynced). The patch is now skipped when `multiRefHandled` (this pipeline is fixed-24fps by design). Any future fixed-fps pipeline muxing through CreateVideo needs the same guard or a control that pins fps. Existing broken mp4s were repaired in place by rewriting the video trak's mdhd timescale (16384→24576 keeps delta 1024 at exactly 24fps) + tkhd/mvhd/elst durations — no re-encode needed.
