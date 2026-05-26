import { fal } from "@fal-ai/client";

fal.config({
  credentials: process.env.FAL_KEY || process.env.FALAI_API_KEY || "",
});

export { fal };
