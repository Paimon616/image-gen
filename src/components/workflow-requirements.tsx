"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, DownloadCloud, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { useGenerationQueueStore } from "@/lib/generation-queue-store";
import { useRunpodDownloadStore } from "@/lib/runpod-download-store";
import type { RunpodMissingFile } from "@/lib/generation-queue-store";
import type { GenerationParams } from "@/lib/types";

interface WorkflowRequirement {
  folder: string;
  filename: string;
  label: string;
  exists: boolean;
  /** Download source. "" when nothing can fetch it; "runpod" for pod-side sources. */
  url: string;
  kind: "checkpoint" | "support";
}

async function fetchRunpodMissing(podId: string, params: GenerationParams) {
  const response = await fetch(
    `/api/runpod/pods/${encodeURIComponent(podId)}/check`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params }),
    }
  );
  const data = (await response.json()) as {
    missing?: RunpodMissingFile[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "RunPod file check failed");
  return data.missing ?? [];
}

// The pod check only reports what is absent, so anything it does not name is already
// there — unlike the local check, which returns every requirement with its state.
function requirementsFromRunpodMissing(
  missing: RunpodMissingFile[]
): WorkflowRequirement[] {
  return missing.map((item) => ({
    folder: item.folder,
    filename: item.path.replace(/^.*\//, ""),
    label: item.path,
    exists: false,
    // Eligibility is decided server-side (canDownloadRunpodResource in runpod.ts);
    // this only carries that verdict into the shared shape.
    url: item.downloadable === true ? "runpod" : "",
    kind: item.resource?.type === "checkpoint" ? "checkpoint" : "support",
  }));
}

async function fetchLocalRequirements(params: GenerationParams) {
  const response = await fetch("/api/comfyui/workflow-requirements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model_name: params.model_name,
      krea2_workflow: params.krea2_workflow,
      upscale_model_name: params.upscale_model_name,
    }),
  });
  const data = (await response.json()) as {
    requirements?: WorkflowRequirement[];
    error?: string;
  };
  if (!response.ok) throw new Error(data.error || "Requirement check failed");
  return data.requirements ?? [];
}

/**
 * Whether the selected checkpoint + workflow can actually run on the active target,
 * and a one-click install for whatever it is missing. Local checks the app's own
 * ComfyUI models tree and downloads into it; RunPod asks the pod's helper and hands
 * the batch to the background download queue.
 */
export function WorkflowRequirements() {
  const { params, language } = useStore();
  const ko = language === "ko";
  const generationTarget = useGenerationQueueStore(
    (state) => state.config.generationTarget
  );
  const runpodPodId = useGenerationQueueStore((state) => state.config.runpodPodId);
  const startRunpodDownload = useRunpodDownloadStore((state) => state.startDownload);
  const runpodDownloading = useRunpodDownloadStore(
    (state) => state.downloadingByPod[runpodPodId] ?? false
  );
  const runpodPendingRecheck = useRunpodDownloadStore(
    (state) => state.pendingRecheckByPod[runpodPodId] ?? false
  );

  const [requirements, setRequirements] = useState<WorkflowRequirement[] | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");
  // The freshest params, for callbacks that must not re-run on every prompt keystroke.
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  const runpodMode = generationTarget === "runpod";
  // Only the fields a requirement depends on: re-checking on every prompt keystroke
  // would hammer the pod helper.
  const signature = [
    generationTarget,
    runpodMode ? runpodPodId : "",
    params.model_name,
    params.krea2_workflow,
    params.upscale_model_name,
  ].join("|");

  const load = useCallback(async () => {
    const current = paramsRef.current;
    if (!runpodMode) return fetchLocalRequirements(current);
    if (!runpodPodId) return null;

    // The pod check reports only what is absent, so pair it with the local endpoint's
    // requirement list: that gives the same "here is everything this workflow needs"
    // view for a pod, with presence taken from the pod instead of this disk.
    const [list, podMissing] = await Promise.all([
      fetchLocalRequirements(current),
      fetchRunpodMissing(runpodPodId, current),
    ]);
    const pending = new Map(podMissing.map((item) => [item.path, item]));
    const rows = list.map((item) => {
      const path = `${item.folder}/${item.filename}`;
      const miss = pending.get(path);
      pending.delete(path);
      return {
        ...item,
        exists: !miss,
        url: miss?.downloadable === true ? "runpod" : "",
      };
    });
    // Anything else the pod lacks (LoRAs, embeddings, the ADetailer detector) still
    // blocks generation, so the one-click install has to cover it too.
    return [...rows, ...requirementsFromRunpodMissing([...pending.values()])];
  }, [runpodMode, runpodPodId]);

  // Re-check whenever the workflow, checkpoint, or target changes — selecting a
  // workflow is exactly when the user needs to know what it still needs. A finished
  // pod download flips pendingRecheck, which re-runs this so the banner clears itself.
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await load();
        if (!active) return;
        setRequirements(next);
        setMessage("");
      } catch (error) {
        if (!active) return;
        setRequirements(null);
        setMessage(error instanceof Error ? error.message : "Requirement check failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [signature, load, runpodPendingRecheck]);

  const missing = (requirements ?? []).filter((item) => !item.exists);
  const installable = missing.filter((item) => Boolean(item.url));

  const installLocal = useCallback(
    async (targets: WorkflowRequirement[]) => {
      let done = 0;
      for (const item of targets) {
        setMessage(
          ko
            ? `${item.filename} 받는 중 (${done + 1}/${targets.length})`
            : `Downloading ${item.filename} (${done + 1}/${targets.length})`
        );
        const response = await fetch("/api/models/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folder: item.folder,
            filename: item.filename,
            url: item.url,
          }),
        });
        if (!response.ok || !response.body) {
          throw new Error(`${item.filename}: HTTP ${response.status}`);
        }
        // NDJSON progress stream. The body has to be drained for the download to run
        // to completion, and its last event is what reports failure.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let failure = "";
        for (;;) {
          const { value, done: streamDone } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as {
              type?: string;
              error?: string;
              percent?: number | null;
            };
            if (event.type === "error") failure = event.error || "download failed";
            if (event.type === "progress" && typeof event.percent === "number") {
              setMessage(
                `${item.filename} ${event.percent}% (${done + 1}/${targets.length})`
              );
            }
          }
        }
        if (failure) throw new Error(`${item.filename}: ${failure}`);
        done += 1;
      }
      // The model dropdowns read the same folders, so let them refresh too.
      window.dispatchEvent(new Event("local-models-changed"));
      setMessage(ko ? "설치 완료." : "Install complete.");
    },
    [ko]
  );

  const installOnRunpod = useCallback(async () => {
    if (!runpodPodId) return;
    // Re-check first: the banner may be stale, and startDownload needs the resource
    // metadata the check returns.
    const podMissing = (await fetchRunpodMissing(runpodPodId, paramsRef.current)).filter(
      (item) => item.downloadable === true
    );
    if (podMissing.length === 0) {
      setMessage(ko ? "이미 모두 준비돼 있습니다." : "Everything is already there.");
      return;
    }
    setMessage(
      ko
        ? `RunPod에 ${podMissing.length}개 파일을 받는 중입니다.`
        : `Downloading ${podMissing.length} file(s) to RunPod.`
    );
    await startRunpodDownload(
      runpodPodId,
      podMissing.map((item) => ({ path: item.path, resource: item.resource })),
      { ko }
    );
  }, [ko, runpodPodId, startRunpodDownload]);

  const install = useCallback(async () => {
    setInstalling(true);
    try {
      if (runpodMode) {
        await installOnRunpod();
      } else {
        await installLocal(installable);
      }
      setRequirements(await load());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Install failed");
    } finally {
      setInstalling(false);
    }
  }, [installLocal, installOnRunpod, installable, load, runpodMode]);

  // Nothing to say for checkpoints that need no support files (plain SDXL merges).
  if (!requirements || (requirements.length === 0 && !message)) return null;

  if (missing.length === 0) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        {ko
          ? `이 워크플로우에 필요한 파일이 ${runpodMode ? "RunPod에" : "로컬에"} 모두 있습니다.`
          : `Every file this workflow needs is ${runpodMode ? "on the pod" : "installed locally"}.`}
        {message && <span className="ml-1">{message}</span>}
      </p>
    );
  }

  const busy = installing || runpodDownloading;

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        {ko
          ? `이 워크플로우에 필요한 파일 ${missing.length}개가 ${runpodMode ? "RunPod에" : "로컬에"} 없습니다.`
          : `${missing.length} file(s) this workflow needs are missing ${runpodMode ? "on the pod" : "locally"}.`}
      </div>
      <div className="space-y-0.5">
        {missing.map((item) => (
          <div
            key={`${item.folder}/${item.filename}`}
            className="break-all font-mono text-muted-foreground"
          >
            {item.label}
            {!item.url && (
              <span className="ml-1 font-sans text-destructive">
                {ko ? "(자동 다운로드 불가)" : "(no automatic source)"}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={busy || installable.length === 0}
          onClick={() => void install()}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <DownloadCloud className="h-3.5 w-3.5" />
          )}
          {ko
            ? runpodMode
              ? "RunPod에 한 번에 설치"
              : "로컬에 한 번에 설치"
            : runpodMode
              ? "Install all on RunPod"
              : "Install all locally"}
        </Button>
        {message && <span className="text-muted-foreground">{message}</span>}
      </div>
    </div>
  );
}
