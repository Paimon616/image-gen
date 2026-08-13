// Single source of truth for the PuLID (SDXL identity reference) assets the
// "Character Reference" feature needs on whichever ComfyUI runs the job. Kept in
// sync with comfyui-config/custom-nodes.json (the node) and
// scripts/setup-comfyui-pulid.sh (the weight).

export const PULID_NODE_REPO = {
  name: "PuLID_ComfyUI",
  url: "https://github.com/cubiq/PuLID_ComfyUI.git",
  ref: "93e0c4c226b87b23c0009d671978bad0e77289ff",
} as const;

// Placed in ComfyUI/models/pulid/. This MUST be the image_proj/ip_adapter-structured
// SDXL weight that cubiq PuLID_ComfyUI's IDEncoder loads. The similarly named
// guozinan/PuLID "pulid_v1.1.safetensors" uses a different (id_adapter) layout and
// fails with "Missing key(s) in state_dict for IDEncoder", so do NOT use it here.
export const PULID_WEIGHT = {
  // Relative to the ComfyUI models dir (the pod helper resolves it under models/).
  targetFile: "pulid/ip-adapter_pulid_sdxl_fp16.safetensors",
  fileName: "ip-adapter_pulid_sdxl_fp16.safetensors",
  downloadUrl:
    "https://huggingface.co/huchenlei/ipadapter_pulid/resolve/main/ip-adapter_pulid_sdxl_fp16.safetensors?download=true",
  approxBytes: 791372856,
} as const;

// PulidInsightFaceLoader runs InsightFace with FaceAnalysis(name="antelopev2"),
// which looks under <models>/insightface/models/antelopev2/. InsightFace's own
// auto-download of this bundle is unreliable, so we place the five ONNX models
// explicitly. Paths are relative to the ComfyUI models dir.
export const PULID_INSIGHTFACE = {
  dir: "insightface/models/antelopev2",
  baseUrl: "https://huggingface.co/DIAMONIK7777/antelopev2/resolve/main",
  files: [
    "1k3d68.onnx",
    "2d106det.onnx",
    "genderage.onnx",
    "glintr100.onnx",
    "scrfd_10g_bnkps.onnx",
  ],
} as const;

// True only for the two *installable* PuLID errors thrown while building the
// workflow (missing custom node, missing weight). The "SDXL/Illustrious only"
// guard also mentions PuLID but is a wrong-model error that installing cannot
// fix, so it is deliberately excluded (it has neither marker phrase).
export function isPulidInstallableError(message: string): boolean {
  if (!message || !/PuLID/i.test(message)) return false;
  return /(커스텀 노드|custom nodes|가중치|weights)/i.test(message);
}
