"use client";

// BETA 캐릭터 기준 시트 tab of the character studio. Generates turnaround /
// expression sheet candidates on our own ComfyUI (local or GPU workers, via the
// shared generation queue), lets the user confirm one as the character's
// reference, and shows/installs the IP-Adapter setup the renders need.
// See docs/character-reference-sheet.md.

import { useCallback, useEffect, useState } from "react";
import { Check, Download, Loader2, Lock, RefreshCw, Sparkles, Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CHARACTER_SHEET_SITUATION_ID,
  DEFAULT_SHEET_CROP,
  DEFAULT_SHEET_STRENGTH,
  MAX_SHEET_STRENGTH,
  SHEET_CANDIDATE_COUNT,
  buildSheetCandidateParams,
  clampSheetStrength,
  sheetCandidateSeeds,
} from "@/lib/character-sheet";
import { useGenerationQueueStore } from "@/lib/generation-queue-store";
import {
  baseImageFromParams,
  baseImageSettingsPatch,
  characterTriggerTokens,
  mergeCharacterLoras,
} from "@/lib/paimon-chat-store";
import { useStore } from "@/lib/store";
import type {
  Character,
  CharacterReferenceSheet,
  CharacterReferenceSheetCrop,
  GeneratedImage,
  GenerationParams,
} from "@/lib/types";

interface SetupStatus {
  reachable: boolean;
  nodeInstalled: boolean;
  ipadapter: string | null;
  clipVision: string | null;
  missing: ("ipadapter" | "clip_vision")[];
  recommended?: boolean;
  target?: { kind: string; label: string };
}

interface TargetOption {
  id: string; // "" = local
  label: string;
}

const TARGET_LABEL: Record<string, string> = {
  local: "로컬 ComfyUI",
  workers: "GPU 워커 풀",
  runpod: "RunPod",
};

export function CharacterSheetPanel({
  character,
  candidates,
  onPatch,
  onOpenImage,
  onReloadImages,
}: {
  character: Character;
  candidates: GeneratedImage[];
  onPatch: (patch: Partial<Character>) => void;
  onOpenImage: (image: GeneratedImage) => void;
  onReloadImages: () => void;
}) {
  const sheet = character.referenceSheet ?? null;
  const generationTarget = useGenerationQueueStore((s) => s.config.generationTarget);
  const runpodPodId = useGenerationQueueStore((s) => s.config.runpodPodId);
  const pending = useGenerationQueueStore(
    (s) =>
      s.queue.filter(
        (job) =>
          job.characterId === character.id &&
          job.situationId === CHARACTER_SHEET_SITUATION_ID
      ).length +
      s.running.filter(
        (job) =>
          job.characterId === character.id &&
          job.situationId === CHARACTER_SHEET_SITUATION_ID
      ).length
  );
  const [error, setError] = useState("");

  // The queue's target is published by the generator page. Opened straight
  // from the studio (page reload), it is still the "local" default even when
  // the user picked the GPU worker pool there; restore that saved choice so
  // sheet candidates go where the user expects. RunPod needs a pod id from the
  // generator page, so it is left to that page.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("image-gen:generation-target");
      const queue = useGenerationQueueStore.getState();
      if (saved === "workers" && queue.config.generationTarget === "local") {
        queue.setConfig({ generationTarget: "workers" });
      }
    } catch {}
  }, []);

  // Candidates land in the gallery as each job finishes; refresh the strip then.
  const [lastPending, setLastPending] = useState(pending);
  if (lastPending !== pending) {
    setLastPending(pending);
    if (pending < lastPending) onReloadImages();
  }

  const generateCandidates = useCallback(async () => {
    setError("");
    if (!character.appearancePrompt.trim()) {
      setError("아이덴티티 탭의 외형 프롬프트가 비어 있음. 먼저 외형 프롬프트 입력 필요.");
      return;
    }
    const current = useStore.getState().params;
    // Baseline: the main image's model/sampler/LoRA settings when there is one,
    // else whatever the generator currently has.
    const baseImage = baseImageFromParams(character.mainImage?.params ?? undefined);
    const base: GenerationParams = baseImage
      ? { ...current, ...baseImageSettingsPatch(baseImage) }
      : current;
    const loras = mergeCharacterLoras(base.loras, character.loras ?? []);
    const list = buildSheetCandidateParams({
      base,
      appearancePrompt: character.appearancePrompt,
      loras,
      triggerWords: characterTriggerTokens(character.loras),
      seeds: sheetCandidateSeeds(SHEET_CANDIDATE_COUNT),
    });
    const queue = useGenerationQueueStore.getState();
    for (const params of list) {
      await queue.enqueue(params, {
        characterId: character.id,
        situationId: CHARACTER_SHEET_SITUATION_ID,
      });
    }
  }, [character]);

  const confirm = useCallback(
    (image: GeneratedImage) => {
      const next: CharacterReferenceSheet = {
        url: image.url,
        filename: image.filename,
        thumbnailUrl: image.thumbnailUrl,
        confirmed: true,
        enabled: sheet?.enabled ?? true,
        prompt: image.params?.prompt ?? "",
        seed: typeof image.params?.seed === "number" ? image.params.seed : null,
        strength: sheet?.strength ?? DEFAULT_SHEET_STRENGTH,
        confirmedAt: Date.now(),
        crop: null,
      };
      onPatch({ referenceSheet: next });
      // Start with the default 참조 영역 so renders get one figure, not the
      // whole sheet; the user can move it in the editor below.
      void cutSheetCrop(image.filename, DEFAULT_SHEET_CROP).then((crop) => {
        if (crop) onPatch({ referenceSheet: { ...next, crop } });
      });
    },
    [onPatch, sheet]
  );

  const updateSheet = useCallback(
    (patch: Partial<CharacterReferenceSheet>) => {
      if (!sheet) return;
      onPatch({ referenceSheet: { ...sheet, ...patch } });
    },
    [onPatch, sheet]
  );

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-background p-5 shadow-sm">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              기준 시트
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                BETA
              </span>
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              정면·측면·후면 전신 + 표정 4종 시트. 확정하면 이 캐릭터의 모든 렌더에 IP-Adapter
              참조로 자동 적용 (SDXL/Illustrious). 우리 GPU에서만 생성.
            </p>
          </div>
          {sheet?.confirmed ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Lock className="h-3 w-3" /> 확정됨
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
              미확정
            </span>
          )}
        </div>

        {sheet?.confirmed && (
          <div className="mb-4 grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,360px)_1fr]">
            <SheetCropEditor
              key={sheet.filename}
              sheet={sheet}
              onSaved={(crop) => updateSheet({ crop })}
            />
            <div className="space-y-3 text-xs">
              <label className="flex items-center justify-between gap-3">
                <span>이 캐릭터에 시트 참조 사용</span>
                <Switch
                  checked={sheet.enabled}
                  onCheckedChange={(checked) => updateSheet({ enabled: checked })}
                />
              </label>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>참조 강도 (IP-Adapter weight)</span>
                  <span className="font-mono">{sheet.strength.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={MAX_SHEET_STRENGTH}
                  step={0.05}
                  value={sheet.strength}
                  onChange={(event) =>
                    updateSheet({ strength: clampSheetStrength(parseFloat(event.target.value)) })
                  }
                  className="w-full"
                />
                <p className="text-muted-foreground">
                  0.4–0.6 권장. 높을수록 얼굴·의상 고정, 너무 높으면 시트 구도가 장면에 섞임.
                </p>
              </div>
              <p className="text-muted-foreground">
                seed {sheet.seed ?? "-"} · {sheet.filename}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => updateSheet({ confirmed: false })}
              >
                <Unlock className="mr-1 h-3.5 w-3.5" /> 확정 해제
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void generateCandidates()} disabled={pending > 0}>
            {pending > 0 ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : candidates.length > 0 ? (
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Sparkles className="mr-1 h-3.5 w-3.5" />
            )}
            {pending > 0
              ? `후보 생성 중 (${pending})`
              : candidates.length > 0
                ? `후보 ${SHEET_CANDIDATE_COUNT}장 다시 생성`
                : `후보 ${SHEET_CANDIDATE_COUNT}장 생성`}
          </Button>
          <span className="text-xs text-muted-foreground">
            생성 대상: {TARGET_LABEL[generationTarget] ?? generationTarget} (이미지 생성 화면에서 변경)
            {character.mainImage?.params ? " · 메인 이미지 설정 기준" : " · 현재 생성 설정 기준"}
          </span>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        {candidates.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {candidates.map((image) => {
              const isCurrent = sheet?.filename === image.filename && sheet.confirmed;
              return (
                <div
                  key={image.id}
                  className={cn(
                    "overflow-hidden rounded-lg border bg-muted",
                    isCurrent ? "border-emerald-500 ring-2 ring-emerald-500/30" : "border-border"
                  )}
                >
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() => onOpenImage(image)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.thumbnailUrl || image.url}
                      alt="기준 시트 후보"
                      className="aspect-[1216/832] w-full object-cover"
                    />
                  </button>
                  <div className="flex items-center justify-between gap-2 bg-background px-2 py-1.5">
                    <span className="truncate text-[11px] text-muted-foreground">
                      seed {image.params?.seed ?? "-"}
                    </span>
                    <Button
                      size="sm"
                      variant={isCurrent ? "secondary" : "outline"}
                      disabled={isCurrent}
                      onClick={() => confirm(image)}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" />
                      {isCurrent ? "확정됨" : "이걸로 확정"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <SheetSetupCard
        preferWorkers={generationTarget === "workers"}
        preferredPodId={generationTarget === "runpod" ? runpodPodId : ""}
      />
    </div>
  );
}

async function cutSheetCrop(
  filename: string,
  region: { x: number; y: number; size: number }
): Promise<CharacterReferenceSheetCrop | null> {
  try {
    const res = await fetch("/api/character-sheet/crop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, ...region }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { crop?: CharacterReferenceSheetCrop };
    return data.crop ?? null;
  } catch {
    return null;
  }
}

// 참조 영역 editor: a square on the confirmed sheet (click to move, slider to
// resize). IP-Adapter gets this crop — one face/upper body — instead of the
// multi-view sheet, which duplicated the character in scenes during evaluation.
function SheetCropEditor({
  sheet,
  onSaved,
}: {
  sheet: CharacterReferenceSheet;
  onSaved: (crop: CharacterReferenceSheetCrop | null) => void;
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [region, setRegion] = useState(() =>
    sheet.crop
      ? { x: sheet.crop.x, y: sheet.crop.y, size: sheet.crop.w }
      : { ...DEFAULT_SHEET_CROP }
  );
  const [saving, setSaving] = useState(false);
  const aspect = natural ? natural.w / natural.h : 1216 / 832;
  // Box height as a fraction of the image height (square in pixels).
  const boxH = region.size * aspect;
  const savedMatches =
    sheet.crop &&
    Math.abs(sheet.crop.x - region.x) < 0.002 &&
    Math.abs(sheet.crop.y - region.y) < 0.002 &&
    Math.abs(sheet.crop.w - region.size) < 0.002;

  const clamp = (next: { x: number; y: number; size: number }) => {
    const size = Math.min(Math.max(next.size, 0.08), Math.min(1, 1 / aspect));
    return {
      size,
      x: Math.min(Math.max(next.x, 0), 1 - size),
      y: Math.min(Math.max(next.y, 0), 1 - size * aspect),
    };
  };

  const save = async () => {
    setSaving(true);
    const crop = await cutSheetCrop(sheet.filename, region);
    setSaving(false);
    if (crop) {
      setRegion({ x: crop.x, y: crop.y, size: crop.w });
      onSaved(crop);
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <div
        className="relative cursor-crosshair overflow-hidden rounded-md border border-border bg-muted"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const cx = (event.clientX - rect.left) / rect.width;
          const cy = (event.clientY - rect.top) / rect.height;
          setRegion((current) =>
            clamp({ ...current, x: cx - current.size / 2, y: cy - (current.size * aspect) / 2 })
          );
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sheet.url}
          alt="확정된 기준 시트"
          className="block w-full select-none"
          draggable={false}
          onLoad={(event) =>
            setNatural({
              w: event.currentTarget.naturalWidth,
              h: event.currentTarget.naturalHeight,
            })
          }
        />
        <div
          className="pointer-events-none absolute border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
          style={{
            left: `${region.x * 100}%`,
            top: `${region.y * 100}%`,
            width: `${region.size * 100}%`,
            height: `${boxH * 100}%`,
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-muted-foreground">영역 크기</span>
        <input
          type="range"
          min={0.08}
          max={0.6}
          step={0.01}
          value={region.size}
          onChange={(event) =>
            setRegion((current) => clamp({ ...current, size: parseFloat(event.target.value) }))
          }
          className="w-full accent-primary"
          aria-label="참조 영역 크기"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={saving || Boolean(savedMatches)} onClick={() => void save()}>
          {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          참조 영역 저장
        </Button>
        {sheet.crop ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheet.crop.url} alt="참조 영역" className="h-8 w-8 rounded border border-border object-cover" />
            IP-Adapter는 이 영역만 사용
          </span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">
            영역 미지정 — 시트 전체 사용(인물 복제 위험)
          </span>
        )}
      </div>
      <p className="text-muted-foreground">
        클릭으로 위치 이동. 정면 얼굴~어깨가 들어가게 지정 권장. 무표정에 가까운 얼굴일수록 표정 전이가 적음.
      </p>
    </div>
  );
}

// IP-Adapter readiness per generation target, with a one-click model download
// for workers/pods (helper flow) and the setup script for local ComfyUI.
function SheetSetupCard({
  preferWorkers,
  preferredPodId,
}: {
  preferWorkers: boolean;
  preferredPodId: string;
}) {
  const [targets, setTargets] = useState<TargetOption[]>([{ id: "", label: "로컬 ComfyUI" }]);
  const [targetId, setTargetId] = useState("");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [log, setLog] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then(
        (data: {
          gpuWorkers?: { id: string; label: string }[];
          runpodPods?: { id: string; label: string; kind: string }[];
        }) => {
          if (!active) return;
          // Start on the target the generator is set to: the first GPU worker
          // for the worker pool, the selected pod for RunPod.
          const firstWorker = data.gpuWorkers?.[0]?.id ?? "";
          if (preferWorkers && firstWorker) setTargetId(firstWorker);
          else if (preferredPodId) setTargetId(preferredPodId);
          setTargets([
            { id: "", label: "로컬 ComfyUI" },
            ...(data.gpuWorkers ?? []).map((worker) => ({
              id: worker.id,
              label: `GPU 워커 · ${worker.label || worker.id}`,
            })),
            ...(data.runpodPods ?? [])
              .filter((pod) => pod.kind === "image")
              .map((pod) => ({ id: pod.id, label: `RunPod · ${pod.label || pod.id}` })),
          ]);
        }
      )
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [preferWorkers, preferredPodId]);

  const check = useCallback(async (id: string) => {
    setChecking(true);
    setStatus(null);
    try {
      const res = await fetch(
        `/api/character-sheet/assets${id ? `?targetId=${encodeURIComponent(id)}` : ""}`,
        { cache: "no-store" }
      );
      setStatus((await res.json()) as SetupStatus);
    } catch {
      setStatus({ reachable: false, nodeInstalled: false, ipadapter: null, clipVision: null, missing: [] });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-change: the async result is what updates state, not this effect.
    void (async () => {
      await check(targetId);
    })();
  }, [check, targetId]);

  const install = useCallback(async () => {
    setInstalling(true);
    setLog("");
    try {
      const res = await fetch("/api/character-sheet/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: targetId || undefined }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const event = JSON.parse(line.slice(5).trim()) as {
            type: string;
            message?: string;
            percent?: number;
            file?: string;
          };
          if (event.type === "progress" && typeof event.percent === "number") {
            setLog(`${event.file ?? ""} ${event.percent}%`);
          } else if (event.message) {
            setLog(event.message);
          }
        }
      }
    } catch (error) {
      setLog(error instanceof Error ? error.message : "실패");
    } finally {
      setInstalling(false);
      void check(targetId);
    }
  }, [check, targetId]);

  const ready =
    status?.reachable &&
    status.nodeInstalled &&
    status.missing.length === 0 &&
    status.recommended === true;
  const isLocal = targetId === "";

  return (
    <section className="rounded-xl border border-border bg-background p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">IP-Adapter 준비 상태</h3>
        <div className="flex items-center gap-2">
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {targets.map((target) => (
              <option key={target.id || "local"} value={target.id}>
                {target.label}
              </option>
            ))}
          </select>
          <Button size="sm" variant="ghost" onClick={() => void check(targetId)} disabled={checking}>
            <RefreshCw className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
          </Button>
        </div>
      </div>
      {!status || checking ? (
        <p className="text-xs text-muted-foreground">확인 중...</p>
      ) : !status.reachable ? (
        <p className="text-xs text-muted-foreground">ComfyUI 응답 없음 (꺼져 있거나 연결 불가).</p>
      ) : (
        <ul className="space-y-1 text-xs">
          <li className={status.nodeInstalled ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
            노드 ComfyUI_IPAdapter_plus: {status.nodeInstalled ? "설치됨" : "없음"}
            {!status.nodeInstalled &&
              (isLocal
                ? " — 아래 '설치'로 로컬 설치 후 ComfyUI 재시작"
                : " — GPU 워커는 최신 worker-kit으로 start-worker.bat 재실행 (원격 설치 안 함)")}
          </li>
          <li
            className={
              status.recommended
                ? "text-emerald-600 dark:text-emerald-400"
                : status.ipadapter
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-destructive"
            }
          >
            ipadapter 모델: {status.ipadapter ?? "없음"}
            {!status.recommended &&
              " — 권장: ipadapter/NOOB-IPA-MARK1.safetensors (Illustrious 계열에서 SDXL 기본 어댑터는 색 번짐·인물 복제)"}
          </li>
          <li className={status.clipVision ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}>
            clip_vision 모델: {status.clipVision ?? "없음 (clip_vision/CLIP-ViT-bigG-14-laion2B-39B-b160k.safetensors)"}
          </li>
        </ul>
      )}
      {status?.reachable && !ready && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void install()} disabled={installing}>
            {installing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            {isLocal ? "설치 (노드 + 모델 ~5.1GB)" : "모델 받기 (~5.1GB)"}
          </Button>
        </div>
      )}
      {log && <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">{log}</p>}
    </section>
  );
}

// Generator-page strip: shows whether the next render of the linked character
// gets its reference sheet, with a per-render on/off and strength override.
// The link is the queue's characterContext (set when a Paimon situation is
// composed), valid while the prompt still matches — the same rule enqueue uses.
export function GeneratorSheetBadge() {
  const context = useGenerationQueueStore((s) => s.characterContext);
  const prompt = useStore((s) => s.params.prompt);
  const disabled = useStore((s) => s.params.character_sheet_disabled === true);
  const override = useStore((s) => s.params.character_sheet_strength_override ?? null);
  const setParams = useStore((s) => s.setParams);
  const characterId =
    context?.characterId && context.prompt === prompt ? context.characterId : null;

  const [beta, setBeta] = useState(false);
  const [character, setCharacter] = useState<Character | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/settings", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { betaCharacterSheet?: boolean }) => {
        if (active) setBeta(data.betaCharacterSheet === true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!beta || !characterId) return;
    let active = true;
    fetch(`/api/characters/${characterId}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { character?: Character }) => {
        if (active) setCharacter(data.character ?? null);
      })
      .catch(() => {
        if (active) setCharacter(null);
      });
    return () => {
      active = false;
    };
  }, [beta, characterId]);

  // Overrides belong to one character: a different (or no) character resets them.
  useEffect(() => {
    const { params } = useStore.getState();
    if (params.character_sheet_disabled || params.character_sheet_strength_override != null) {
      setParams({ character_sheet_disabled: false, character_sheet_strength_override: null });
    }
  }, [characterId, setParams]);

  if (!beta || !characterId || !character || character.id !== characterId) return null;
  const sheet = character.referenceSheet;
  const usable = Boolean(sheet?.confirmed && sheet.enabled);
  const strength = override ?? sheet?.strength ?? DEFAULT_SHEET_STRENGTH;

  return (
    <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3 text-xs">
      {sheet?.confirmed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={sheet.thumbnailUrl || sheet.url}
          alt="기준 시트"
          className="h-14 w-20 shrink-0 rounded border border-border object-cover"
        />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">
            기준 시트 <span className="text-[10px] text-primary">BETA</span> · {character.name}
          </span>
          {usable ? (
            <label className="flex shrink-0 items-center gap-1.5">
              <span className={disabled ? "text-muted-foreground" : "text-emerald-600 dark:text-emerald-400"}>
                {disabled ? "이번 생성 끔" : "적용"}
              </span>
              <Switch
                size="sm"
                checked={!disabled}
                onCheckedChange={(checked) => setParams({ character_sheet_disabled: !checked })}
              />
            </label>
          ) : (
            <span className="shrink-0 text-amber-600 dark:text-amber-400">
              {sheet?.confirmed ? "캐릭터에서 꺼짐" : "미확정 — 스튜디오에서 확정"}
            </span>
          )}
        </div>
        {usable && !disabled && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={MAX_SHEET_STRENGTH}
              step={0.05}
              value={strength}
              onChange={(event) =>
                setParams({
                  character_sheet_strength_override: clampSheetStrength(
                    parseFloat(event.target.value)
                  ),
                })
              }
              className="w-full accent-primary"
              aria-label="기준 시트 참조 강도"
            />
            <span className="w-9 shrink-0 text-right font-mono">{strength.toFixed(2)}</span>
            {override != null && (
              <button
                type="button"
                className="shrink-0 text-muted-foreground underline"
                onClick={() => setParams({ character_sheet_strength_override: null })}
              >
                기본값
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
