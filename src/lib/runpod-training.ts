import { readdir, readFile, mkdir, open, stat } from "fs/promises";
import { join } from "path";
import {
  runPythonOnPod,
  execOnPodViaJupyter,
  downloadPodFileViaContents,
  getRunpodComfyModelsDir,
} from "@/lib/runpod";
import { trainingDatasetPath, buildSdxlTrainingConfig, loraOutputDir } from "@/lib/lora-training";
import { getRunpodPod, type RunpodPodSettings } from "@/lib/settings";

// Everything for a run lives under this pod dir (sibling of the sd-scripts install).
const POD_ROOT = "/workspace/lora-train";
const POD_SDSCRIPTS = `${POD_ROOT}/sd-scripts`;
const POD_VENV_ACC = `${POD_ROOT}/venv/bin/accelerate`;

export interface RunpodTrainingEvent {
  type: "status" | "progress" | "log" | "complete" | "error";
  message?: string;
  step?: number;
  total?: number;
  loraFile?: string;
}

export interface RunpodTrainingOptions {
  datasetName: string;
  baseModelFile: string; // checkpoint filename as known to ComfyUI (e.g. aMixIllustrious_aMix.safetensors)
  triggerWords: string;
  category?: string;
  outputName: string;
  resolution?: number;
  networkDim?: number;
  networkAlpha?: number;
  learningRate?: number;
  maxTrainSteps?: number; // when set, caps steps (handy for a quick smoke run)
  maxTrainEpochs?: number;
  batchSize?: number; // pod GPUs (H100) default to 4; local runner stays at 1
}

function pyStr(value: string) {
  return JSON.stringify(value);
}

// Push a local dataset (images + .txt captions) to the pod in size-bounded batches
// of base64 blobs written through a Jupyter python kernel (proxy-stable, no scp).
async function pushDatasetToPod(
  pod: RunpodPodSettings,
  datasetName: string,
  remoteDir: string,
  onEvent: (e: RunpodTrainingEvent) => void
) {
  const localDir = trainingDatasetPath(datasetName);
  const isImage = (name: string) => /\.(png|jpe?g|webp)$/i.test(name);
  const entries = (await readdir(localDir)).filter((f) =>
    /\.(png|jpe?g|webp|txt)$/i.test(f)
  );
  const imageTotal = entries.filter(isImage).length;
  if (imageTotal === 0) throw new Error("Dataset is empty.");

  await runPythonOnPod(
    pod,
    ["import os", `os.makedirs(${pyStr(remoteDir)}, exist_ok=True)`, "print('mkdir ok')"].join("\n")
  );

  const MAX_BATCH_BYTES = 6 * 1024 * 1024; // ~6MB raw per kernel message
  let batch: { name: string; b64: string }[] = [];
  let batchBytes = 0;
  let pushedImages = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const dictLiteral = batch
      .map((f) => `  ${pyStr(f.name)}: ${pyStr(f.b64)}`)
      .join(",\n");
    const code = [
      "import base64, os",
      `__d = ${remoteDir ? pyStr(remoteDir) : '"."'}`,
      "__files = {",
      dictLiteral,
      "}",
      "for __n, __b in __files.items():",
      "    open(os.path.join(__d, __n), 'wb').write(base64.b64decode(__b))",
      `print('wrote', len(__files))`,
    ].join("\n");
    await runPythonOnPod(pod, code, 120_000);
    pushedImages += batch.filter((f) => isImage(f.name)).length;
    onEvent({
      type: "status",
      message: `데이터셋 업로드 중... 이미지 ${pushedImages}/${imageTotal}장 (+캡션)`,
    });
    batch = [];
    batchBytes = 0;
  };

  for (const name of entries) {
    const buf = await readFile(join(localDir, name));
    if (batchBytes + buf.length > MAX_BATCH_BYTES && batch.length > 0) await flush();
    batch.push({ name, b64: buf.toString("base64") });
    batchBytes += buf.length;
  }
  await flush();

  const countOut = await runPythonOnPod(
    pod,
    [
      "import os",
      `print(len([f for f in os.listdir(${pyStr(remoteDir)}) if f.lower().endswith(('.png','.jpg','.jpeg','.webp'))]))`,
    ].join("\n")
  );
  const count = Number(countOut.trim()) || 0;
  // Hard guarantee: never train on a dataset that differs from what was sent.
  if (count !== imageTotal) {
    throw new Error(
      `팟 데이터셋 이미지 수가 일치하지 않습니다 (업로드 ${imageTotal}장, 팟 ${count}장).`
    );
  }
  return count;
}

// Locate the checkpoint file inside the pod's ComfyUI models tree.
async function resolveCheckpointOnPod(pod: RunpodPodSettings, filename: string) {
  const out = await execOnPodViaJupyter(
    pod,
    `find /workspace -maxdepth 6 -type f -name ${JSON.stringify(filename)} 2>/dev/null | head -1`
  );
  const path = out.trim().split("\n")[0]?.trim();
  if (!path) throw new Error(`Checkpoint ${filename} was not found on the pod.`);
  return path;
}

export async function streamRunpodLoraTraining(
  podId: string,
  opts: RunpodTrainingOptions,
  onEvent: (e: RunpodTrainingEvent) => void,
  signal?: AbortSignal
) {
  const pod = await getRunpodPod(podId);
  if (!pod) throw new Error("RunPod target was not found.");

  const runDir = `${POD_ROOT}/runs/${opts.outputName}`;
  const datasetDir = `${runDir}/images`;
  const outputDir = `${runDir}/output`;
  const logPath = `${runDir}/train.log`;
  const statusPath = `${runDir}/train.status`;
  const configPath = `${runDir}/dataset.toml`;

  onEvent({ type: "status", message: "실행 디렉토리 준비 중..." });
  // The run dir is keyed by output name and reused across runs — wipe it first
  // so stale images/outputs from a previous run never leak into this one.
  await runPythonOnPod(
    pod,
    [
      "import os, shutil",
      `shutil.rmtree(${pyStr(runDir)}, ignore_errors=True)`,
      `[os.makedirs(p, exist_ok=True) for p in [${[datasetDir, outputDir].map(pyStr).join(", ")}]]`,
      "print('ok')",
    ].join("\n")
  );

  // 1) dataset → pod
  const pushed = await pushDatasetToPod(pod, opts.datasetName, datasetDir, onEvent);
  if (pushed === 0) throw new Error("No dataset images landed on the pod.");
  onEvent({ type: "status", message: `데이터셋 ${pushed}장 업로드 완료.` });

  // 2) dataset.toml (reuse the local config builder; point image_dir at the pod)
  const toml = buildSdxlTrainingConfig({
    runId: opts.outputName,
    loraName: opts.outputName,
    triggerWords: opts.triggerWords,
    baseModel: opts.baseModelFile,
    category: opts.category ?? "",
    imageDir: datasetDir,
    outputName: opts.outputName,
    resolution: opts.resolution ?? 1024,
    batchSize: opts.batchSize ?? 4,
  });
  await runPythonOnPod(
    pod,
    ["import base64", `open(${pyStr(configPath)}, 'wb').write(base64.b64decode(${pyStr(Buffer.from(toml, "utf8").toString("base64"))}))`, "print('config ok')"].join("\n")
  );

  // 3) resolve checkpoint + build the launch command
  const ckpt = await resolveCheckpointOnPod(pod, opts.baseModelFile);
  onEvent({ type: "status", message: `체크포인트 확인: ${ckpt.split("/").pop()}` });

  const dim = opts.networkDim ?? 16;
  const alpha = opts.networkAlpha ?? Math.max(1, Math.floor(dim / 2));
  const lr = opts.learningRate ?? 1e-4;
  const stepArg = opts.maxTrainSteps
    ? `--max_train_steps ${opts.maxTrainSteps}`
    : `--max_train_epochs ${opts.maxTrainEpochs ?? 10}`;

  const trainCmd = [
    POD_VENV_ACC,
    "launch --num_processes 1 --num_machines 1 --mixed_precision bf16 --dynamo_backend no",
    "sdxl_train_network.py",
    `--pretrained_model_name_or_path ${JSON.stringify(ckpt)}`,
    `--dataset_config ${JSON.stringify(configPath)}`,
    `--output_dir ${JSON.stringify(outputDir)}`,
    `--output_name ${JSON.stringify(opts.outputName)}`,
    "--save_model_as safetensors",
    "--network_module networks.lora",
    `--network_dim ${dim} --network_alpha ${alpha}`,
    `--learning_rate ${lr}`,
    "--optimizer_type AdamW8bit",
    "--lr_scheduler cosine --lr_warmup_steps 0",
    "--mixed_precision bf16 --save_precision bf16",
    // No gradient checkpointing: it trades ~30-40% speed for VRAM the H100
    // does not need at this batch size.
    "--cache_latents --sdpa",
    "--seed 42",
    stepArg,
  ].join(" ");

  // 4) launch as a detached background job on the pod (survives kernel teardown)
  const launch = [
    "import base64, os, subprocess",
    `os.makedirs(${pyStr(runDir)}, exist_ok=True)`,
    `__sh = base64.b64decode(${pyStr(
      Buffer.from(
        [
          "#!/usr/bin/env bash",
          `cd ${POD_SDSCRIPTS}`,
          `${trainCmd} > ${logPath} 2>&1`,
          `echo $? > ${statusPath}`,
        ].join("\n"),
        "utf8"
      ).toString("base64")
    )}).decode()`,
    `open(${pyStr(`${runDir}/train.sh`)}, 'w').write(__sh)`,
    `try:\n    os.remove(${pyStr(statusPath)})\nexcept Exception:\n    pass`,
    `subprocess.Popen(['bash', ${pyStr(`${runDir}/train.sh`)}], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)`,
    "print('LAUNCHED')",
  ].join("\n");
  const launchOut = await runPythonOnPod(pod, launch);
  if (!launchOut.includes("LAUNCHED")) {
    throw new Error(`Failed to launch training. ${launchOut.slice(0, 300)}`);
  }
  onEvent({ type: "status", message: "학습 시작됨. 진행 상황을 폴링합니다..." });

  // 5) poll log + status until the job writes its exit code
  let lastStep = -1;
  for (let i = 0; i < 100000; i += 1) {
    if (signal?.aborted) {
      await execOnPodViaJupyter(pod, `pkill -f ${JSON.stringify(opts.outputName)} 2>/dev/null; echo aborted`).catch(() => {});
      throw new Error("Training was canceled.");
    }
    const probe = await runPythonOnPod(
      pod,
      [
        "import os",
        `__s = open(${pyStr(statusPath)}).read().strip() if os.path.exists(${pyStr(statusPath)}) else ''`,
        `__log = open(${pyStr(logPath)}).read()[-4000:] if os.path.exists(${pyStr(logPath)}) else ''`,
        "print('STATUS='+__s)",
        "print('---LOG---')",
        "print(__log)",
      ].join("\n"),
      60_000
    );
    const status = (probe.match(/STATUS=(\d*)/)?.[1] ?? "").trim();
    const logPart = probe.split("---LOG---")[1] ?? "";

    // kohya prints "steps:  N%|...| cur/total"
    const m = logPart.match(/(\d+)\/(\d+)\s*\[/g);
    const last = m?.[m.length - 1]?.match(/(\d+)\/(\d+)/);
    if (last) {
      const step = Number(last[1]);
      const total = Number(last[2]);
      if (step !== lastStep) {
        lastStep = step;
        onEvent({ type: "progress", step, total, message: `학습 중... ${step}/${total}` });
      }
    }

    if (status !== "") {
      if (status !== "0") {
        onEvent({ type: "log", message: logPart.slice(-1500) });
        throw new Error(`Training exited with code ${status}. See log above.`);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 8000));
  }

  // 6) retrieve the .safetensors. Kernel stdout truncates large output, so split
  // the file on the pod and pull each part over the Jupyter Contents API (HTTP).
  onEvent({ type: "status", message: "LoRA 파일 회수 중..." });
  const remoteLora = `${outputDir}/${opts.outputName}.safetensors`;
  const localLoraDir = loraOutputDir();
  await mkdir(localLoraDir, { recursive: true });
  const localLoraPath = join(localLoraDir, `${opts.outputName}.safetensors`);

  const sizeOut = await runPythonOnPod(
    pod,
    ["import os", `print(os.path.getsize(${pyStr(remoteLora)}) if os.path.exists(${pyStr(remoteLora)}) else -1)`].join("\n")
  );
  const size = Number(sizeOut.trim());
  if (!(size > 0)) throw new Error("Trained LoRA file was not found on the pod.");

  // Make the LoRA usable on this pod right away: copy it into the pod's REAL
  // ComfyUI loras dir (resolved via the helper — not always /workspace/ComfyUI)
  // so RunPod generation can load it without a local→pod re-upload.
  // Best-effort — the local copy below is the source of truth, so a failed pod
  // install must not fail the run.
  try {
    onEvent({ type: "status", message: "팟 ComfyUI에 LoRA 설치 중..." });
    const podLorasDir = `${await getRunpodComfyModelsDir(pod)}/loras`;
    const podComfyLora = `${podLorasDir}/${opts.outputName}.safetensors`;
    await execOnPodViaJupyter(
      pod,
      `mkdir -p ${JSON.stringify(podLorasDir)} && cp -f ${JSON.stringify(remoteLora)} ${JSON.stringify(podComfyLora)} && echo installed`
    );
    onEvent({ type: "status", message: `팟 ComfyUI에 LoRA 설치 완료: ${podComfyLora}` });
  } catch {
    onEvent({
      type: "log",
      message: "팟 ComfyUI 설치 실패 — 생성 시 로컬에서 자동 업로드할 수 있습니다.",
    });
  }

  const partsDir = `${runDir}/parts`;
  await execOnPodViaJupyter(
    pod,
    `rm -rf ${JSON.stringify(partsDir)} && mkdir -p ${JSON.stringify(partsDir)} && split -b 30m -a 3 -d ${JSON.stringify(remoteLora)} ${JSON.stringify(`${partsDir}/p_`)} && ls ${JSON.stringify(partsDir)} | wc -l`
  );
  const partsRaw = await execOnPodViaJupyter(pod, `ls ${JSON.stringify(partsDir)} | sort`);
  const parts = partsRaw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error("Failed to split the LoRA for retrieval.");

  const handle = await open(localLoraPath, "w");
  try {
    let done = 0;
    for (const part of parts) {
      const rel = `${partsDir}/${part}`.replace(/^\/workspace\//, "");
      const buf = await downloadPodFileViaContents(pod, rel);
      await handle.write(buf);
      done += 1;
      onEvent({ type: "status", message: `LoRA 회수 중... ${Math.round((done / parts.length) * 100)}%` });
    }
  } finally {
    await handle.close();
  }
  await execOnPodViaJupyter(pod, `rm -rf ${JSON.stringify(partsDir)}`).catch(() => {});

  const localSize = (await stat(localLoraPath)).size;
  if (localSize !== size) {
    throw new Error(`Retrieved LoRA size mismatch: local ${localSize} vs pod ${size}.`);
  }

  onEvent({
    type: "complete",
    loraFile: `${opts.outputName}.safetensors`,
    message: `학습 완료. LoRA 저장: ${localLoraPath} (${localSize} bytes)`,
  });
}
