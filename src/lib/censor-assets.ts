// Single source of truth for the assets the video "Censor (auto-mosaic)" feature
// needs on whichever ComfyUI runs the job. Kept in sync with
// comfyui-config/custom-nodes.json (the nodes) and scripts/setup-comfyui-censor.sh
// (the detector model). Mirrors pulid-assets.ts.

export const CENSOR_NODE_REPOS = [
  {
    name: "ComfyUI-Nudenet",
    url: "https://github.com/phuvinh010701/ComfyUI-Nudenet.git",
    ref: "61a3272e4615272f05cef7e4b5e7acb60c13c646",
  },
  {
    name: "ComfyUI-segment-anything-2",
    url: "https://github.com/kijai/ComfyUI-segment-anything-2.git",
    ref: "0c35fff5f382803e2310103357b5e985f5437f32",
  },
] as const;

// Node class_types that prove ComfyUI-Nudenet is installed. These are the classes
// injectCensorNodes() splices into the graph, so if all three resolve the shipped
// censor path can run. (segment-anything-2 is installed for a future SAM2 mask pass
// but is not required by the current censor path, so it is not gated here.)
export const CENSOR_REQUIRED_NODE_TYPES = [
  "NudenetModelLoader",
  "ApplyNudenet",
  "FilterdLabel",
] as const;

// The detector filename injectCensorNodes() references (must match the same env
// resolution used there). Downloaded into ComfyUI/models/Nudenet/.
export function censorModelFile() {
  return process.env.COMFYUI_NUDENET_MODEL?.trim() || "nudenet.onnx";
}

// Path relative to the ComfyUI models dir (the pod helper resolves it under models/,
// and NudenetModelLoader lists files from the "Nudenet" folder).
export function censorModelTargetFile() {
  return `Nudenet/${censorModelFile()}`;
}

// Canonical NudeNet ONNX detector (~25 MB), same source as setup-comfyui-censor.sh.
export const CENSOR_MODEL_DOWNLOAD_URL =
  "https://d2xl8ijk56kv4u.cloudfront.net/models/nudenet.onnx";
export const CENSOR_MODEL_APPROX_BYTES = 25_000_000;

export interface CensorSetupStatus {
  // Whether ComfyUI/helper was reachable to answer the check at all.
  reachable: boolean;
  nodesInstalled: boolean;
  modelPresent: boolean;
  // Local-only: the configured ComfyUI is a remote/override URL we cannot set up
  // in place (use the RunPod install path instead).
  notLocal?: boolean;
  // Local-only: ComfyUI is not installed yet (run `npm run setup:comfyui` first).
  notInstalled?: boolean;
  message?: string;
}

// Convenience: the prerequisites are satisfied only when both the nodes and the
// detector model are present.
export function censorSetupReady(status: CensorSetupStatus | null | undefined) {
  return Boolean(status && status.nodesInstalled && status.modelPresent);
}
