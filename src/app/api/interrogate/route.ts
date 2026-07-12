import { NextRequest, NextResponse } from "next/server";
import {
  interrogateImageWithComfyUI,
  type InterrogateMode,
} from "@/lib/comfyui";

export const dynamic = "force-dynamic";

function normalizeMode(value: unknown): InterrogateMode {
  return value === "wd14" || value === "florence" ? value : "auto";
}

function friendlyInterrogateError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : "";

  if (
    rawMessage.includes("missing_node_type") ||
    rawMessage.includes("WD14Tagger|pysssss") ||
    rawMessage.includes("ShowText|pysssss")
  ) {
    return {
      status: 424,
      message:
        "ComfyUI image-to-prompt nodes are not installed or ComfyUI was not restarted after installation.\n\nRun `npm run setup:itp-nodes:win`, restart ComfyUI, then try Extract Prompt again.",
    };
  }

  if (rawMessage.includes("COMFYUI_ITP_FLORENCE_WORKFLOW_PATH")) {
    return {
      status: 400,
      message:
        "Florence mode needs a ComfyUI API workflow path. Set COMFYUI_ITP_FLORENCE_WORKFLOW_PATH or switch to WD14.",
    };
  }

  return {
    status: 500,
    message: rawMessage || "Failed to extract prompt from image",
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      image_url?: string;
      imageUrl?: string;
      base_model?: string;
      baseModel?: string;
      mode?: string;
    };
    const imageUrl = (body.image_url ?? body.imageUrl ?? "").trim();

    if (!imageUrl) {
      return NextResponse.json(
        { error: "image_url is required" },
        { status: 400 }
      );
    }

    const result = await interrogateImageWithComfyUI({
      imageUrl,
      baseModel: (body.base_model ?? body.baseModel ?? "").trim(),
      mode: normalizeMode(body.mode),
    });

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const friendlyError = friendlyInterrogateError(error);

    return NextResponse.json(
      { error: friendlyError.message },
      { status: friendlyError.status }
    );
  }
}
