import {
  ANIMA_CLIP_NAME,
  KREA2_CLIP_NAME,
  KREA2_VAE_NAME,
  NOMOS_WEBPHOTO_UPSCALER_NAME,
  PORNMASTER_CLIP_NAME,
  PORNMASTER_VAE_NAME,
  REAL_ESRGAN_X4PLUS_ANIME_NAME,
  REAL_ESRGAN_X4PLUS_NAME,
  ZIMAGE_CLIP_NAME,
  ZIMAGE_VAE_NAME,
} from "./comfyui-model-files";

// Every support file this app knows how to fetch on its own: the external text
// encoders / VAEs the diffusion-only pipelines need, the upscalers our workflows and
// Civitai metadata reference by name, and the ADetailer face detectors. None of them
// are Civitai resources, so without a canonical URL here nothing could install them.
//
// Both installers read this one table — the local one-click setup (which writes into
// COMFYUI_MODELS_DIR) and the RunPod asset list (which maps every entry to
// /workspace/ComfyUI/models/...) — so a pod and a workstation always end up with the
// same file from the same source.
export interface SupportAsset {
  folder: string;
  name: string;
  url: string;
}

export const SUPPORT_ASSETS: readonly SupportAsset[] = [
  {
    folder: "upscale_models",
    name: "4x-UltraSharp.pth",
    url: "https://huggingface.co/shiertier/upscale_models/resolve/b73626f248084e9af7108621ace5651e1447af44/4x-UltraSharp.pth",
  },
  {
    folder: "upscale_models",
    name: "remacri_original.safetensors",
    url: "https://civitai.com/api/download/models/164821",
  },
  {
    // Real-ESRGAN ships its weights on its own GitHub releases, not Civitai, so these
    // two only become downloadable through this list. A1111 metadata names them
    // "R-ESRGAN 4x+" / "R-ESRGAN 4x+ Anime6B" (see resolveUpscalerFileName).
    folder: "upscale_models",
    name: REAL_ESRGAN_X4PLUS_NAME,
    url: `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/${REAL_ESRGAN_X4PLUS_NAME}`,
  },
  {
    folder: "upscale_models",
    name: REAL_ESRGAN_X4PLUS_ANIME_NAME,
    url: `https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/${REAL_ESRGAN_X4PLUS_ANIME_NAME}`,
  },
  {
    // The Moody photo-finish workflow ends on this photo-restoration upscaler instead
    // of a diffusion refine pass. Pinned to the repo commit so a later re-download
    // cannot silently swap the weights under a workflow tuned around them.
    folder: "upscale_models",
    name: NOMOS_WEBPHOTO_UPSCALER_NAME,
    url: `https://huggingface.co/Phips/4xNomosWebPhoto_RealPLKSR/resolve/49d5da19489e645e870eb076ea84815471f27ef4/${NOMOS_WEBPHOTO_UPSCALER_NAME}`,
  },
  {
    folder: "text_encoders",
    name: KREA2_CLIP_NAME,
    url: `https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/${KREA2_CLIP_NAME}`,
  },
  {
    folder: "vae",
    name: KREA2_VAE_NAME,
    url: `https://huggingface.co/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/${KREA2_VAE_NAME}`,
  },
  {
    // Anima's external text encoder (Qwen3-0.6B base). ANIMA_VAE_NAME is the same file
    // as KREA2_VAE_NAME above, so no separate VAE entry is needed.
    folder: "text_encoders",
    name: ANIMA_CLIP_NAME,
    url: `https://huggingface.co/circlestone-labs/Anima/resolve/main/split_files/text_encoders/${ANIMA_CLIP_NAME}`,
  },
  {
    // PornMaster Krea2 workflow stack (abliterated int8 Qwen3-VL + Wan 2.1 VAE).
    folder: "text_encoders",
    name: PORNMASTER_CLIP_NAME,
    url: `https://huggingface.co/DreamFast/Qwen3-VL-4b-Heretic-ComfyUI/resolve/main/${PORNMASTER_CLIP_NAME}`,
  },
  {
    folder: "vae",
    name: PORNMASTER_VAE_NAME,
    url: `https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/${PORNMASTER_VAE_NAME}`,
  },
  {
    // Z-Image's external stack: Qwen3-4B text encoder + the Flux-style 16ch VAE.
    folder: "text_encoders",
    name: ZIMAGE_CLIP_NAME,
    url: `https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/${ZIMAGE_CLIP_NAME}`,
  },
  {
    folder: "vae",
    name: ZIMAGE_VAE_NAME,
    url: `https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/${ZIMAGE_VAE_NAME}`,
  },
  {
    folder: "ultralytics/bbox",
    name: "face_yolov8n_v2.pt",
    url: "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8n_v2.pt",
  },
  {
    folder: "ultralytics/bbox",
    name: "face_yolov8m.pt",
    url: "https://huggingface.co/Bingsu/adetailer/resolve/main/face_yolov8m.pt",
  },
] as const;

export function supportAsset(folder: string, name: string) {
  return SUPPORT_ASSETS.find(
    (asset) => asset.folder === folder && asset.name === name
  );
}
