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
  outputFileTracingExcludes: {
    "/*": comfyUiTraceExcludes,
    "/page": comfyUiTraceExcludes,
    "/api/*": comfyUiTraceExcludes,
    "/api/lora-training/*": comfyUiTraceExcludes,
    "/api/lora-training/status": comfyUiTraceExcludes,
    "/api/lora-training/generate/stream": comfyUiTraceExcludes,
    "/api/models": comfyUiTraceExcludes,
    "/api/models/thumbnail": comfyUiTraceExcludes,
  },
};

export default nextConfig;
