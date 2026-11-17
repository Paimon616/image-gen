---
name: local-launcher
description: How Launch Image Gen.bat / start-local.ps1 and the Local-tab "실행 관리" panel share control of ComfyUI/A1111/Forge; Windows detached-spawn gotcha
metadata:
  type: project
---
- `scripts/start-local.ps1` starts Image Gen + auto-start engines **in parallel** and opens the
  browser as soon as port 5353 listens (it no longer waits for ComfyUI/A1111). It stays alive
  while Image Gen runs; closing the window kills everything via the Job object.
- Auto-start choice lives in `.local/launcher-config.json` (`autoStart.comfyui|a1111|forge`,
  default ComfyUI only), edited from the image page's Local tab panel
  (`src/components/launcher-panel.tsx` → `/api/launcher` → `src/lib/local-services.ts`).
- The launcher writes `.local/launcher-state.json` (PIDs + startedAt) so the panel can show
  "시작 중 m:ss" for engines it did not spawn itself, and stop them (taskkill /T by port + PID).
- **Gotcha:** on Windows, Node `spawn("powershell.exe", …, { detached: true })` exits
  immediately with code 0 and no output. Use `detached: process.platform !== "win32"` +
  `windowsHide: true` (comfyui-process.ts, a1111.ts).
- Boot progress bar: `src/lib/boot-progress.ts` matches stage markers in the engine's startup log
  (launcher: `.local/logs/<id>.err|out.log`, app spawn: `comfyui.log` / `webui-<id>.log`) and
  blends in elapsed time vs. the last boot (`.local/launcher-boot-times.json`). Needs
  `PYTHONUNBUFFERED=1` (set by launcher and spawns) or stdout lines arrive late.
