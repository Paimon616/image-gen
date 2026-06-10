import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingExcludes: {
    "/*": ["./ComfyUI/**/*"],
    "/api/models": ["./ComfyUI/**/*"],
    "/api/models/thumbnail": ["./ComfyUI/**/*"],
  },
};

export default nextConfig;
