import type { NextConfig } from "next";

const comfyUiTraceExcludes = [
  "./ComfyUI/**/*",
  "ComfyUI/**/*",
  "./ComfyUI/**",
  "ComfyUI/**",
];

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": comfyUiTraceExcludes,
    "/page": comfyUiTraceExcludes,
    "/api/*": comfyUiTraceExcludes,
    "/api/models": comfyUiTraceExcludes,
    "/api/models/thumbnail": comfyUiTraceExcludes,
  },
};

export default nextConfig;
