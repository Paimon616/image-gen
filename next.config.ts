import type { NextConfig } from "next";

const comfyUiTraceExcludes = [
  "./ComfyUI/**/*",
  "ComfyUI/**/*",
  "./ComfyUI/**",
  "ComfyUI/**",
  "./runners/**/*",
  "runners/**/*",
  "./runners/**",
  "runners/**",
  "./training/**/*",
  "training/**/*",
  "./training/**",
  "training/**",
];

const nextConfig: NextConfig = {
  // Native .node addon — must stay a runtime require, not be bundled.
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingExcludes: {
    "/*": comfyUiTraceExcludes,
    "/page": comfyUiTraceExcludes,
    "/api/*": comfyUiTraceExcludes,
    "/api/lora-training/*": comfyUiTraceExcludes,
    "/api/lora-training/status": comfyUiTraceExcludes,
    "/api/lora-training/generate/stream": comfyUiTraceExcludes,
    "/api/lora-training/jobs": comfyUiTraceExcludes,
    "/api/lora-training/jobs/*": comfyUiTraceExcludes,
    "/api/lora-training/jobs/*/cancel": comfyUiTraceExcludes,
    "/api/models": comfyUiTraceExcludes,
    "/api/models/thumbnail": comfyUiTraceExcludes,
    "/api/video/config": comfyUiTraceExcludes,
    "/api/video/generate/stream": comfyUiTraceExcludes,
  },
};

export default nextConfig;
