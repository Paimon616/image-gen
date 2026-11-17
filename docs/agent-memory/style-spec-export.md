---
name: style-spec-export
description: "Style export" — image-gen tunes a look, exports a portable ComfyUI style JSON that ONEchat runs on RunPod without image-gen code
metadata:
  type: project
---
Decision (2026-11-16): image-gen is the style lab for ONEchat's planned image feature.
Styles are tuned here and handed over as data, not code.

- Contract: `src/lib/style-spec.ts` (`image-gen.style/v1`). A spec = ComfyUI API-format
  `workflow` + `inputs` bindings (prompt/seed/width/height → node+input) + `requiredFiles`.
  A consumer only clones the workflow, fills bindings (`applyStyle`), POSTs `/prompt`.
- Export: generated image detail view → "스타일로 내보내기" → `POST /api/styles/export`
  with `imageFilename`; params come from the image metadata, the image becomes a 512px
  webp `thumbnail` (data URL). It builds
  the graph with sentinel prompt/seed (`buildComfyWorkflow`, nothing queued) and maps
  where they landed. Reference images are stripped (text-to-image only for v1).
- Size is bound only when an input named width/height equals the requested size; graphs
  that derive sizes (Hires fix) export with `sizeAdjustable: false`.
- Verify a spec independently: `npm run style:run -- <file> --prompt "..." --comfy <url>`.
- Product-facing styles must not carry refusal-reduction / adult LoRAs; check licenses.
