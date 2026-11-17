import "server-only";

import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from "fs";
import { join } from "path";

// Boot progress for local engines, inferred from their startup logs plus the
// previous boot's duration. Used by the launcher panel's progress bar.

export type BootServiceId = "comfyui" | "a1111" | "forge";

export interface BootProgress {
  percent: number;
  stage: string;
  lastLine: string;
  expectedMs: number | null;
}

interface Stage {
  match: RegExp;
  percent: number;
  label: string;
}

const COMFY_STAGES: Stage[] = [
  { match: /setup plugin alembic|Checkpoint files will always/, percent: 10, label: "Python 환경 로딩" },
  { match: /Total VRAM/, percent: 25, label: "PyTorch · GPU 초기화" },
  { match: /ComfyUI version:/, percent: 40, label: "ComfyUI 코어 로딩" },
  { match: /### Loading:|custom_nodes/, percent: 55, label: "커스텀 노드 로딩" },
  { match: /Import times for custom nodes/, percent: 80, label: "커스텀 노드 로딩 완료" },
  { match: /Starting server/, percent: 92, label: "서버 시작" },
];

const WEBUI_STAGES: Stage[] = [
  { match: /^Python \d|Version: v/m, percent: 8, label: "환경 확인" },
  { match: /Launching Web UI/, percent: 20, label: "WebUI 실행 · torch 로딩" },
  { match: /ADetailer initialized|Loading weights/, percent: 45, label: "확장 · 모델 로딩" },
  { match: /Running on local URL/, percent: 70, label: "서버 시작" },
  { match: /Startup time:/, percent: 82, label: "모델 적용 중" },
  { match: /Model loaded in/, percent: 92, label: "스크립트 등록 대기" },
];

function logDir() {
  return process.env.LOG_DIR || join(process.cwd(), ".local", "logs");
}

// Logs written by scripts/start-local.ps1 vs. by this server's own spawn.
export function launcherLogPaths(id: BootServiceId) {
  const dir = logDir();
  return [join(dir, `${id}.err.log`), join(dir, `${id}.out.log`)];
}

function readTail(path: string, bytes = 48_000) {
  if (!existsSync(path)) return "";
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function clean(text: string) {
  // Strip ANSI colors and turn tqdm carriage-return updates into lines.
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "\n");
}

const bootTimesPath = () => join(process.cwd(), ".local", "launcher-boot-times.json");

function readBootTimes(): Partial<Record<BootServiceId, number>> {
  try {
    return JSON.parse(readFileSync(bootTimesPath(), "utf8"));
  } catch {
    return {};
  }
}

// Remember how long the last successful boot took (once per launch).
const recorded = new Map<BootServiceId, number>();
export function recordBootFinished(id: BootServiceId, startedAt: number) {
  if (recorded.get(id) === startedAt) return;
  recorded.set(id, startedAt);
  const duration = Date.now() - startedAt;
  // Ignore nonsense (clock skew, or an already-running server we only now noticed).
  if (duration < 2_000 || duration > 15 * 60_000) return;
  try {
    writeFileSync(
      bootTimesPath(),
      JSON.stringify({ ...readBootTimes(), [id]: duration }, null, 2) + "\n",
      "utf8"
    );
  } catch {}
}

export function getBootProgress(
  id: BootServiceId,
  startedAt: number | null,
  logPaths: string[]
): BootProgress {
  const text = clean(logPaths.map((p) => readTail(p)).join("\n"));
  const stages = id === "comfyui" ? COMFY_STAGES : WEBUI_STAGES;

  let stagePercent = 2;
  let stage = "프로세스 시작";
  for (const s of stages) {
    if (s.match.test(text)) {
      stagePercent = s.percent;
      stage = s.label;
    }
  }

  const lastLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^\[?INFO\]?\s*$/.test(line))
      .pop()
      ?.slice(0, 200) ?? "";

  const expectedMs = readBootTimes()[id] ?? null;
  let percent = stagePercent;
  if (startedAt && expectedMs) {
    const timePercent = ((Date.now() - startedAt) / expectedMs) * 100;
    percent = Math.max(stagePercent, Math.min(timePercent, 96));
  }

  return { percent: Math.round(Math.min(percent, 97)), stage, lastLine, expectedMs };
}
