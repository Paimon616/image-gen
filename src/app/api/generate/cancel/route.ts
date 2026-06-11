import { NextRequest } from "next/server";
import { cancelComfyPrompt } from "@/lib/comfyui";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      prompt_id?: unknown;
    };
    const promptId =
      typeof body.prompt_id === "string" ? body.prompt_id.trim() : "";

    if (!promptId) {
      return Response.json({ error: "prompt_id is required" }, { status: 400 });
    }

    await cancelComfyPrompt(promptId);

    return Response.json({ canceled: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Cancel failed" },
      { status: 500 }
    );
  }
}
