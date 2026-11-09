<#
  Installs the local model set (models, LoRAs, ComfyUI custom nodes) used by the
  image-gen app's local stack on another Windows PC.

  Prerequisite: ComfyUI is already installed (scripts/setup-comfyui.ps1), which
  creates ComfyUI/ and ComfyUI/venv.

  Usage (from the repo root):
    install-local-models.bat                     (double-click: image + krea2, about 28 GB)
    install-local-models.bat -Groups image,krea2,h3
    install-local-models.bat -List
    install-local-models.bat -Only identity_edit

  Groups (default: image, krea2):
    image  Hassaku XL (Illustrious) + Detailer IL / Eye Enhancer / HandPatch LoRA,
           PuLID (face identity) + InsightFace antelopev2, ADetailer face bbox
    krea2  Krea2 Turbo + Qwen3-VL 4B encoder + Krea2 Identity Edit LoRA +
           Refusal-Reduction LoRA, More Dynamic Poses LoRA, Qwen-Image VAE,
           node comfyui-krea2edit
    anima  One obsession (Anima) checkpoint + Anima LoRAs, Qwen3 0.6B encoder
    h3     MiniMax H3 (DaSiWa REF2VA hybrid) video + encoder/VAE + turbo LoRAs,
           nodes ComfyUI-DaSiWa-Nodes + ComfyUI-KJNodes
    wan    Wan 2.2 i2v 14B (high/low) + UMT5 encoder + Wan 2.1 VAE

  Civitai files need CIVITAI_API_TOKEN (read from .env.local or the environment).
  Downloads resume after a drop and files that already have the right size are
  skipped, so the script can simply be run again.
#>
param(
  [string]$ComfyUIDir = "",
  [string]$ModelsDir = "",
  # Default: image generation only (about 28 GB). Add anima / h3 / wan for more.
  [string[]]$Groups = @("image", "krea2"),
  # Only files whose path contains this text, e.g. -Only identity_edit
  [string]$Only = "",
  [switch]$List,
  # Corporate TLS inspection breaks certificate revocation checks; on by default.
  [bool]$NoRevokeCheck = $true
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ComfyUIDir) { $ComfyUIDir = Join-Path $RepoRoot "ComfyUI" }
if (-not $ModelsDir) { $ModelsDir = Join-Path $ComfyUIDir "models" }

$HF = "https://huggingface.co"
$CIVITAI = "https://civitai.com/api/download/models"

# group, destination (relative to models/), url, expected bytes
$Models = @(
  # ---- image: Hassaku XL + consistency LoRAs + PuLID ----
  @("image", "checkpoints/hassakuXLIllustrious_v22.safetensors", "$CIVITAI/1697082", 6938040456),
  @("image", "loras/DetailerILv2-000008.safetensors", "$CIVITAI/1736373", 228465628),
  @("image", "loras/Eye_Enhancer.safetensors", "$CIVITAI/1959770", 57426116),
  @("image", "loras/handPatchUnet4Merge.safetensors", "$CIVITAI/1358586", 681230068),
  @("image", "pulid/ip-adapter_pulid_sdxl_fp16.safetensors", "$HF/huchenlei/ipadapter_pulid/resolve/main/ip-adapter_pulid_sdxl_fp16.safetensors", 791372856),
  @("image", "insightface/models/antelopev2/1k3d68.onnx", "$HF/DIAMONIK7777/antelopev2/resolve/main/1k3d68.onnx", 143607619),
  @("image", "insightface/models/antelopev2/2d106det.onnx", "$HF/DIAMONIK7777/antelopev2/resolve/main/2d106det.onnx", 5030888),
  @("image", "insightface/models/antelopev2/genderage.onnx", "$HF/DIAMONIK7777/antelopev2/resolve/main/genderage.onnx", 1322532),
  @("image", "insightface/models/antelopev2/glintr100.onnx", "$HF/DIAMONIK7777/antelopev2/resolve/main/glintr100.onnx", 260665334),
  @("image", "insightface/models/antelopev2/scrfd_10g_bnkps.onnx", "$HF/DIAMONIK7777/antelopev2/resolve/main/scrfd_10g_bnkps.onnx", 16923827),
  @("image", "ultralytics/bbox/face_yolov8n_v2.pt", "$HF/Bingsu/adetailer/resolve/main/face_yolov8n_v2.pt", 6239036),

  # ---- krea2: Krea2 Turbo + Identity Edit ----
  @("krea2", "diffusion_models/krea2_turbo_fp8_scaled.safetensors", "$HF/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors", 13141730784),
  @("krea2", "text_encoders/qwen3vl_4b_fp8_scaled.safetensors", "$HF/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors", 5242467968),
  @("krea2", "vae/qwen_image_vae.safetensors", "$HF/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors", 253806246),
  @("krea2", "loras/krea2_identity_edit_v1_2.safetensors", "$CIVITAI/3139172", 1828256432),
  @("krea2", "loras/Capitan01R_Krea2_TextFusion_Refusal_Reduction_v2_updated.safetensors", "$CIVITAI/3416236", 30354320),
  @("krea2", "loras/More_Dynamic_Poses_Krea2_000002500.safetensors", "$CIVITAI/3296632", 228587800),

  # ---- anima ----
  @("anima", "checkpoints/One obsession_animaV5turbo.safetensors", "$CIVITAI/3443487", 4182229969),
  @("anima", "text_encoders/qwen_3_06b_base.safetensors", "$HF/circlestone-labs/Anima/resolve/main/split_files/text_encoders/qwen_3_06b_base.safetensors", 1192135096),
  @("anima", "vae/qwen_image_vae.safetensors", "$HF/circlestone-labs/Anima/resolve/main/split_files/vae/qwen_image_vae.safetensors", 253806246),
  @("anima", "loras/anima-base-1-masterpiece-v51.safetensors", "$CIVITAI/2961717", 138662176),
  @("anima", "loras/anima-base-1-light-concepts-v31.safetensors", "$CIVITAI/2952873", 148902616),
  @("anima", "loras/nyanyastylev1.5.safetensors", "$CIVITAI/3342463", 46003600),

  # ---- h3: MiniMax H3 video ----
  @("h3", "diffusion_models/DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors", "$HF/frauleinpiss/DasiwaH3mirror/resolve/main/DasiwaMinimaxH3_dasiwaREF2VAHybridV1.safetensors", 34038897474),
  @("h3", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "$HF/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 15687142551),
  @("h3", "vae/MiniMaxH3/minimax_h3_video_vae_fp16.safetensors", "$HF/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors", 5207808496),
  @("h3", "vae/MiniMaxH3/minimax_h3_audio_vae_fp32.safetensors", "$HF/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors", 605254808),
  @("h3", "vae_approx/taeh3.safetensors", "$HF/Kijai/MiniMax-H3-TAE/resolve/main/vae_approx/taeh3.safetensors", 9791388),
  @("h3", "loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors", "$HF/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_4step_v0.1_comfy_resized_avg_rank_21_bf16.safetensors", 314878200),
  @("h3", "loras/minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors", "$HF/Kijai/MiniMax-H3_comfy/resolve/main/loras/minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors", 364638304),
  @("h3", "loras/MysticXXX_MMH3-V3.safetensors", "$HF/Kutches/minmax/resolve/main/MysticXXX_MMH3-V3.safetensors", 298259688),

  # ---- wan: Wan 2.2 i2v ----
  @("wan", "diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors", 14294742832),
  @("wan", "diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", "$HF/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors", 14294742832),
  @("wan", "text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", "$HF/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", 6735906897),
  @("wan", "vae/wan_2.1_vae.safetensors", "$HF/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors", 253815318)
)

# group, name, repo, pinned commit (the versions tested on the original PC).
# A node is installed together with the model group that needs it.
$AllNodes = @(
  @("krea2", "comfyui-krea2edit", "https://github.com/lbouaraba/comfyui-krea2edit.git", "13ef60f"),
  @("h3", "ComfyUI-DaSiWa-Nodes", "https://github.com/darksidewalker/ComfyUI-DaSiWa-Nodes.git", "c52b170"),
  @("h3", "ComfyUI-KJNodes", "https://github.com/kijai/ComfyUI-KJNodes.git", "ab72eda")
)

function Format-Size([double]$bytes) {
  if ($bytes -ge 1GB) { return "{0:N1} GB" -f ($bytes / 1GB) }
  return "{0:N0} MB" -f ($bytes / 1MB)
}

# "-File ... -Groups image,krea2" arrives as one string; accept commas and spaces.
$Groups = @($Groups | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ } | ForEach-Object { $_.ToLower() })

# Same file can belong to two groups (qwen_image_vae); keep one entry per path.
$selected = @{}
foreach ($m in $Models) {
  if ($Only -and $m[1] -notlike "*$Only*") { continue }
  if ($Groups -contains $m[0] -and -not $selected.ContainsKey($m[1])) { $selected[$m[1]] = $m }
}
$selectedList = @($selected.Values | Sort-Object { $_[1] })
$Nodes = @($AllNodes | Where-Object { $Groups -contains $_[0] -and (-not $Only -or $_[1] -like "*$Only*") } | ForEach-Object { , @($_[1], $_[2], $_[3]) })
[int64]$total = 0
foreach ($m in $selectedList) { $total += [int64]$m[3] }

if ($List) {
  foreach ($m in $selectedList) { "{0,-6} {1,10}  {2}" -f $m[0], (Format-Size $m[3]), $m[1] }
  foreach ($n in $Nodes) { "node   {0,10}  custom_nodes/{1}" -f "", $n[0] }
  "Total: $(Format-Size $total)"
  exit 0
}

if (-not (Test-Path (Join-Path $ComfyUIDir "main.py"))) {
  throw "ComfyUI not found at $ComfyUIDir. Run scripts\setup-comfyui.ps1 first (or pass -ComfyUIDir)."
}

# Civitai token: environment first, then .env.local.
$token = $env:CIVITAI_API_TOKEN
$envFile = Join-Path $RepoRoot ".env.local"
if (-not $token -and (Test-Path $envFile)) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^\s*CIVITAI_API_TOKEN\s*=' } | Select-Object -First 1
  if ($line) { $token = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'") }
}
$needsCivitai = $selectedList | Where-Object { $_[2] -like "$CIVITAI*" }
if ($needsCivitai -and -not $token) {
  Write-Warning "CIVITAI_API_TOKEN is not set (.env.local or environment). Civitai files will be skipped."
}

Write-Host "Models dir: $ModelsDir"
Write-Host "Groups: $($Groups -join ', ')  |  $($selectedList.Count) files, $(Format-Size $total) total"

$failed = @()
$i = 0
foreach ($m in $selectedList) {
  $i++
  $dest = Join-Path $ModelsDir $m[1]
  $url = $m[2]
  $expected = [int64]$m[3]
  $label = "[$i/$($selectedList.Count)] $($m[1]) ($(Format-Size $expected))"

  if ((Test-Path -LiteralPath $dest) -and ((Get-Item -LiteralPath $dest).Length -eq $expected)) {
    Write-Host "$label - already installed" -ForegroundColor DarkGray
    continue
  }
  $isCivitai = $url -like "$CIVITAI*"
  if ($isCivitai -and -not $token) {
    Write-Warning "$label - skipped (no Civitai token)"
    $failed += $m[1]
    continue
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
  $part = "$dest.part"
  Write-Host $label -ForegroundColor Cyan

  $curlArgs = @("-L", "--fail", "--retry", "5", "--retry-delay", "5", "--connect-timeout", "30", "-C", "-", "-o", $part)
  if ($NoRevokeCheck) { $curlArgs += "--ssl-no-revoke" }
  if ($isCivitai) { $curlArgs += @("-H", "Authorization: Bearer $token") }
  $curlArgs += $url

  # Large downloads drop on some networks; resume from the partial file until done.
  $ok = $false
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    & curl.exe @curlArgs
    if ((Test-Path -LiteralPath $part) -and ((Get-Item -LiteralPath $part).Length -ge $expected)) { $ok = $true; break }
    if ($LASTEXITCODE -eq 22) { break } # HTTP error (bad token / missing file) - retrying will not help
    Write-Host "  retrying ($attempt)..." -ForegroundColor Yellow
    Start-Sleep -Seconds 3
  }

  if ($ok) {
    $size = (Get-Item -LiteralPath $part).Length
    if ($size -ne $expected) { Write-Warning "  size $size differs from expected $expected (the file may have been updated upstream)" }
    Move-Item -LiteralPath $part -Destination $dest -Force
    Write-Host "  done" -ForegroundColor Green
  } else {
    Write-Warning "  failed: $url"
    $failed += $m[1]
  }
}

if ($Nodes.Count -gt 0) {
  $nodesDir = Join-Path $ComfyUIDir "custom_nodes"
  $python = Join-Path $ComfyUIDir "venv\Scripts\python.exe"
  if (-not (Test-Path $python)) { throw "ComfyUI venv not found at $python. Run scripts\setup-comfyui.ps1 first." }
  $env:PYTHONUTF8 = "1"

  foreach ($n in $Nodes) {
    $dir = Join-Path $nodesDir $n[0]
    Write-Host "Node: $($n[0])" -ForegroundColor Cyan
    if (-not (Test-Path (Join-Path $dir ".git"))) {
      git clone $n[1] $dir
      if ($LASTEXITCODE -ne 0) { $failed += "custom_nodes/$($n[0])"; continue }
    }
    git -C $dir fetch --quiet origin
    git -C $dir checkout --quiet $n[2]
    if ($LASTEXITCODE -ne 0) { Write-Warning "  could not check out $($n[2]); keeping the current version" }

    $req = Join-Path $dir "requirements.txt"
    if (Test-Path $req) {
      # DaSiWa lists llama-cpp-python (only for its optional prompt LLM) which
      # needs a C++ toolchain on Windows; install everything else.
      $filtered = Join-Path $env:TEMP "$($n[0])-requirements.txt"
      Get-Content $req | Where-Object { $_ -notmatch '^\s*llama-cpp-python' } | Set-Content -Encoding utf8 $filtered
      & $python -m pip install -r $filtered
      if ($LASTEXITCODE -ne 0) { Write-Warning "  pip install failed for $($n[0])"; $failed += "custom_nodes/$($n[0])" }
    }
  }
}

Write-Host ""
if ($failed.Count -gt 0) {
  Write-Warning "Not installed ($($failed.Count)):"
  $failed | ForEach-Object { Write-Host "  $_" }
  Write-Host "Run the script again to resume."
  exit 1
}
Write-Host "All done. Restart ComfyUI so it picks up the new models and nodes." -ForegroundColor Green
Write-Host "PuLID also downloads EVA02-CLIP (about 800 MB) to the Hugging Face cache the first time it runs."
