import { create } from "zustand";
import type { MissingResource } from "@/lib/civitai-resource-matching";

export type DownloadStatus = "downloading" | "complete" | "error";

export interface DownloadEntry {
  resource: MissingResource;
  downloaded: number;
  total: number | null;
  percent: number | null;
  message: string;
  status: DownloadStatus;
  path: string;
}

export type DownloadCompleteHandler = (
  resource: MissingResource,
  path: string,
  metadata?: unknown
) => void;

interface DownloadStoreState {
  downloads: Record<string, DownloadEntry>;
  startDownload: (
    key: string,
    resource: MissingResource,
    onComplete?: DownloadCompleteHandler
  ) => Promise<void>;
}

export function downloadResourceKey(resource: MissingResource) {
  return [
    resource.type,
    resource.modelVersionId ?? "",
    resource.name,
    resource.versionName ?? "",
  ].join(":");
}

function patchEntry(
  state: DownloadStoreState,
  key: string,
  update: Partial<DownloadEntry>
): DownloadStoreState {
  const current = state.downloads[key];
  if (!current) return state;

  return {
    ...state,
    downloads: {
      ...state.downloads,
      [key]: { ...current, ...update },
    },
  };
}

export const useDownloadStore = create<DownloadStoreState>((set, get) => ({
  downloads: {},

  startDownload: async (key, resource, onComplete) => {
    const existing = get().downloads[key];
    if (existing?.status === "downloading") return;

    set((state) => ({
      downloads: {
        ...state.downloads,
        [key]: {
          resource,
          downloaded: 0,
          total: null,
          percent: null,
          message: "Starting download...",
          status: "downloading",
          path: "",
        },
      },
    }));

    const update = (patch: Partial<DownloadEntry>) =>
      set((state) => patchEntry(state, key, patch));

    try {
      const response = await fetch("/api/civitai/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to download Civitai resource");
      }

      if (!response.body) {
        throw new Error("Download progress stream did not start");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const handleEvent = (event: Record<string, unknown>) => {
        if (event.type === "status") {
          update({ message: String(event.message ?? "Working...") });
          return;
        }

        if (event.type === "progress") {
          update({
            downloaded: Number(event.downloaded ?? 0),
            total: typeof event.total === "number" ? Number(event.total) : null,
            percent:
              typeof event.percent === "number" ? Number(event.percent) : null,
            message: "Downloading...",
          });
          return;
        }

        if (event.type === "complete") {
          const path =
            typeof event.filename === "string"
              ? event.filename
              : typeof event.path === "string"
                ? event.path
                : "";

          update({ percent: 100, message: "Complete", status: "complete", path });

          window.dispatchEvent(
            new CustomEvent("local-models-changed", {
              detail: { resource, path, metadata: event.metadata },
            })
          );
          onComplete?.(resource, path, event.metadata);
          return;
        }

        if (event.type === "error") {
          throw new Error(
            String(event.error ?? "Failed to download Civitai resource")
          );
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          handleEvent(JSON.parse(line) as Record<string, unknown>);
        }
      }

      if (buffer.trim()) {
        handleEvent(JSON.parse(buffer) as Record<string, unknown>);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to download Civitai resource";
      update({ message, status: "error" });
    }
  },
}));
