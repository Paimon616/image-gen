// Shared, dependency-free ComfyUI version helpers. Imported by both server code
// (workflow guards, RunPod status) and client UI (the RunPod card), so it must
// stay free of any Node/`server-only` imports.

export type ComfyVersion = [number, number, number];

// int8_tensorwise-quantized checkpoints (e.g. pornmasterKrea2_v2TurboInt8) only
// load on ComfyUI >= 0.27.0, where UNETLoader gained int8 support (PR #14636).
// Older builds throw a bare `KeyError: 'int8_tensorwise'` from the loader.
export const MIN_COMFY_VERSION_FOR_INT8: ComfyVersion = [0, 27, 0];

export function parseComfyVersion(raw: unknown): ComfyVersion | null {
  if (typeof raw !== "string") return null;
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareComfyVersions(a: ComfyVersion, b: ComfyVersion): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function formatComfyVersion(v: ComfyVersion): string {
  return v.join(".");
}

export function isInt8CheckpointName(name: string): boolean {
  return /int8/i.test(name || "");
}

// The minimum ComfyUI version a given checkpoint needs, or null when the model
// has no special requirement beyond whatever the pod already runs.
export function requiredComfyVersionForCheckpoint(name: string): ComfyVersion | null {
  if (isInt8CheckpointName(name)) return MIN_COMFY_VERSION_FOR_INT8;
  return null;
}
