import { create } from "zustand";
import { UNGROUPED_WORKSPACE_ID, type WorkspaceSummary } from "./types";

// The video screens share the image gallery's workspaces — one record, one
// RunPod share — but each screen counts and filters only its own media. The
// image page keeps its workspace state inside the main app store (it is wired
// into paging and generation); this store holds the same state for the two
// video screens so they never show, or fetch, each other's files.
export type VideoWorkspaceMedia = "videos" | "seedance";

const MEDIA: VideoWorkspaceMedia[] = ["videos", "seedance"];

export interface MediaWorkspaceEntry {
  workspaces: WorkspaceSummary[];
  ungroupedCount: number;
  activeWorkspaceId: string | null;
}

const EMPTY_ENTRY: MediaWorkspaceEntry = {
  workspaces: [],
  ungroupedCount: 0,
  activeWorkspaceId: null,
};

interface MediaWorkspaceState {
  byMedia: Record<VideoWorkspaceMedia, MediaWorkspaceEntry>;

  fetchWorkspaces: (media: VideoWorkspaceMedia) => Promise<void>;
  setActiveWorkspace: (
    media: VideoWorkspaceMedia,
    workspaceId: string | null
  ) => void;
  createWorkspace: (
    media: VideoWorkspaceMedia,
    name: string
  ) => Promise<WorkspaceSummary | null>;
  renameWorkspace: (
    media: VideoWorkspaceMedia,
    workspaceId: string,
    name: string
  ) => Promise<void>;
  reorderWorkspaces: (
    media: VideoWorkspaceMedia,
    orderedIds: string[]
  ) => Promise<void>;
  deleteWorkspace: (
    media: VideoWorkspaceMedia,
    workspaceId: string
  ) => Promise<void>;
  // Toggles one membership and answers with the file's new workspace ids, or
  // null when the request failed (the caller then leaves its list untouched).
  setFileWorkspace: (
    media: VideoWorkspaceMedia,
    filename: string,
    workspaceId: string,
    assigned: boolean
  ) => Promise<string[] | null>;
}

/** Does a video with these memberships belong in the currently filtered view? */
export function fileMatchesWorkspace(
  workspaces: string[] | undefined,
  workspaceId: string | null
) {
  if (workspaceId === null) return true;
  if (workspaceId === UNGROUPED_WORKSPACE_ID) return (workspaces ?? []).length === 0;
  return (workspaces ?? []).includes(workspaceId);
}

export const useMediaWorkspaceStore = create<MediaWorkspaceState>((set, get) => {
  const patch = (
    media: VideoWorkspaceMedia,
    update: Partial<MediaWorkspaceEntry>
  ) =>
    set((state) => ({
      byMedia: {
        ...state.byMedia,
        [media]: { ...state.byMedia[media], ...update },
      },
    }));

  const fetchWorkspaces = async (media: VideoWorkspaceMedia) => {
    try {
      const response = await fetch(`/api/workspaces?media=${media}`, {
        cache: "no-store",
      });
      const data = await response.json();
      patch(media, {
        workspaces: Array.isArray(data.workspaces)
          ? (data.workspaces as WorkspaceSummary[])
          : [],
        ungroupedCount:
          typeof data.ungroupedCount === "number" ? data.ungroupedCount : 0,
      });
    } catch {
      // Leave the previous list in place on a transient failure.
    }
  };

  // Creating, renaming, reordering and deleting all edit the one shared
  // workspace record, so every media's copy of the list is refreshed.
  const refreshAll = () => Promise.all(MEDIA.map(fetchWorkspaces));

  return {
    byMedia: { videos: EMPTY_ENTRY, seedance: EMPTY_ENTRY },

    fetchWorkspaces,

    setActiveWorkspace: (media, workspaceId) =>
      patch(media, { activeWorkspaceId: workspaceId }),

    createWorkspace: async (media, name) => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      try {
        const response = await fetch("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!response.ok) return null;

        const data = await response.json();
        const workspace = data.workspace as WorkspaceSummary | undefined;
        if (!workspace) return null;

        await refreshAll();
        return workspace;
      } catch {
        return null;
      }
    },

    renameWorkspace: async (media, workspaceId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;

      try {
        const response = await fetch(`/api/workspaces/${workspaceId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        if (!response.ok) return;
      } catch {
        return;
      }

      await refreshAll();
    },

    reorderWorkspaces: async (media, orderedIds) => {
      const previous = get().byMedia[media].workspaces;
      const byId = new Map(previous.map((workspace) => [workspace.id, workspace]));
      const next: WorkspaceSummary[] = [];

      for (const id of orderedIds) {
        const workspace = byId.get(id);
        if (!workspace) continue;
        next.push(workspace);
        byId.delete(id);
      }
      for (const workspace of previous) {
        if (byId.has(workspace.id)) next.push(workspace);
      }

      // Optimistic: the drag already moved the chip on screen.
      patch(media, { workspaces: next });

      try {
        const response = await fetch("/api/workspaces", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        });
        if (!response.ok) throw new Error("reorder failed");
      } catch {
        patch(media, { workspaces: previous });
        return;
      }

      await refreshAll();
    },

    deleteWorkspace: async (media, workspaceId) => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}`, {
          method: "DELETE",
        });
        if (!response.ok) return;
      } catch {
        return;
      }

      // Viewing the workspace that just went away falls back to "all".
      for (const item of MEDIA) {
        if (get().byMedia[item].activeWorkspaceId === workspaceId) {
          patch(item, { activeWorkspaceId: null });
        }
      }
      await refreshAll();
    },

    setFileWorkspace: async (media, filename, workspaceId, assigned) => {
      try {
        const response = await fetch("/api/workspaces/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media, filename, workspaceId, assigned }),
        });
        if (!response.ok) return null;

        const data = await response.json();
        const workspaces = Array.isArray(data.workspaces)
          ? (data.workspaces as string[])
          : [];

        // Only this media's counts changed.
        void fetchWorkspaces(media);
        return workspaces;
      } catch {
        return null;
      }
    },
  };
});
