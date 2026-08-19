import { existsSync } from "fs";
import { join } from "path";
import { isComfyInstalled, isLocalComfy } from "@/lib/comfyui-process";
import {
  CENSOR_NODE_REPOS,
  censorModelFile,
  type CensorSetupStatus,
} from "@/lib/censor-assets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reports whether the LOCAL ComfyUI already has the video-censor prerequisites (the
// custom-node clones + the NudeNet detector file on disk), so the video page can
// show an install prompt only when needed. Presence is a filesystem check — it does
// not require ComfyUI to be running.
export async function GET() {
  const comfyDir = process.env.COMFYUI_DIR || join(process.cwd(), "ComfyUI");
  const modelsDir = process.env.COMFYUI_MODELS_DIR || join(comfyDir, "models");

  const base: CensorSetupStatus = {
    reachable: true,
    nodesInstalled: false,
    modelPresent: false,
  };

  if (!isLocalComfy()) {
    return Response.json({
      ...base,
      reachable: false,
      notLocal: true,
      message:
        "로컬 ComfyUI가 아닙니다. RunPod 대상을 선택하세요. (Not a local ComfyUI — select a RunPod target.)",
    } satisfies CensorSetupStatus);
  }
  if (!isComfyInstalled()) {
    return Response.json({
      ...base,
      reachable: false,
      notInstalled: true,
      message:
        "로컬 ComfyUI가 설치되어 있지 않습니다. (Local ComfyUI is not installed — run `npm run setup:comfyui`.)",
    } satisfies CensorSetupStatus);
  }

  const nodesInstalled = CENSOR_NODE_REPOS.every((repo) =>
    existsSync(join(comfyDir, "custom_nodes", repo.name))
  );
  const modelPresent = existsSync(join(modelsDir, "Nudenet", censorModelFile()));

  return Response.json({
    reachable: true,
    nodesInstalled,
    modelPresent,
  } satisfies CensorSetupStatus);
}
