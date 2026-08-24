import { appendFile } from "fs/promises";
import {
  patchLoraJobStatus,
  readLoraJobStatus,
  registerRunpodLoraAbort,
  unregisterRunpodLoraAbort,
} from "@/lib/lora-job-runner";
import {
  streamRunpodLoraTraining,
  type RunpodTrainingEvent,
  type RunpodTrainingOptions,
} from "@/lib/runpod-training";
import {
  firstImageInDir,
  registerSelfTrainedLora,
  trainingDatasetPath,
} from "@/lib/lora-training";

// Runs a RunPod LoRA training as a server-side background job, detached from any
// HTTP request. Progress lands in the same file-backed status.json the local
// runner uses, so the UI can navigate away and re-attach via the jobs API.
export function startRunpodLoraJob({
  runId,
  podId,
  runDir,
  logPath,
  opts,
}: {
  runId: string;
  podId: string;
  runDir: string;
  logPath: string;
  opts: RunpodTrainingOptions;
}) {
  const abort = new AbortController();
  registerRunpodLoraAbort(runId, abort);

  const appendLog = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void appendFile(logPath, `${trimmed}\n`).catch(() => {});
  };

  const handleEvent = (event: RunpodTrainingEvent) => {
    if (event.message) appendLog(event.message);

    if (event.type === "progress" && event.step != null && event.total) {
      const progress = Math.max(1, Math.min(99, Math.round((event.step / event.total) * 100)));
      void patchLoraJobStatus(runDir, {
        progress,
        ...(event.message ? { message: event.message } : {}),
      }).catch(() => {});
      return;
    }

    if ((event.type === "status" || event.type === "log") && event.message) {
      void patchLoraJobStatus(runDir, { message: event.message }).catch(() => {});
    }
  };

  void (async () => {
    let completed = false;
    let completeMessage = "";
    try {
      await patchLoraJobStatus(runDir, {
        state: "running",
        progress: 3,
        message: "RunPod 학습을 준비하는 중...",
      });

      await streamRunpodLoraTraining(
        podId,
        opts,
        (event) => {
          if (event.type === "complete") {
            completed = true;
            completeMessage = event.message ?? "";
          }
          handleEvent(event);
        },
        abort.signal
      );

      if (!completed) {
        throw new Error("RunPod 학습이 완료 이벤트 없이 종료되었습니다.");
      }

      await patchLoraJobStatus(runDir, {
        state: "completed",
        progress: 100,
        message: completeMessage || "LoRA file created.",
        error: "",
        completedAt: new Date().toISOString(),
      });

      // Register the retrieved LoRA in the model catalog — best-effort: metadata
      // failure must not fail the completed training run.
      try {
        const status = await readLoraJobStatus(runId);
        await registerSelfTrainedLora({
          outputName: opts.outputName,
          loraName: status?.loraName || opts.outputName,
          triggerWords: status?.triggerWords ?? opts.triggerWords,
          category: status?.category ?? opts.category,
          baseModelLabel: status?.baseModelLabel || opts.baseModelFile,
          baseModelFile: opts.baseModelFile,
          previewImagePath: await firstImageInDir(trainingDatasetPath(opts.datasetName)),
        });
      } catch {
        // Metadata is best-effort — the training result itself already succeeded.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "RunPod training failed.";
      appendLog(message);
      const current = await readLoraJobStatus(runId).catch(() => null);
      if (current?.state === "cancelled") return;
      if (abort.signal.aborted) {
        await patchLoraJobStatus(runDir, {
          state: "cancelled",
          message: "LoRA training cancelled.",
          error: "",
          completedAt: new Date().toISOString(),
        }).catch(() => {});
        return;
      }
      await patchLoraJobStatus(runDir, {
        state: "failed",
        message,
        error: message,
        completedAt: new Date().toISOString(),
      }).catch(() => {});
    } finally {
      unregisterRunpodLoraAbort(runId);
    }
  })();
}
