---
name: character-reference-sheet
description: BETA character reference sheet — where the IP-Adapter conditioning is injected and which pins must stay in sync
metadata:
  type: project
---
- Only `api/generate/stream` sets `character_sheet_image` (client value is dropped). Conditions: settings `betaCharacterSheet`, character `referenceSheet.confirmed && enabled`, backend comfyui, `situationId !== "__sheet__"` (sheet candidates stay unconditioned).
- Workflow: `addIpAdapterSheetNodes` in `src/lib/comfyui.ts`, node ids 210–214 (PuLID uses 200–204). Uses explicit loaders, not `IPAdapterUnifiedLoader`, so missing files are caught from `/object_info` before queueing.
- IP-Adapter pins in 3 places: `src/lib/character-sheet.ts`, `comfyui-config/custom-nodes.json`, `worker-kit/windows/custom-nodes.json`.
- CLIP Vision file is h94 `models/image_encoder/model.safetensors` saved as `CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`.
- Human doc: `docs/character-reference-sheet.md`.
