import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { Workspace, WorkspaceSummary } from "@/lib/types";

const DATA_DIR = join(process.cwd(), "data");
const WORKSPACES_FILE = join(DATA_DIR, "workspaces.json");
const MAX_WORKSPACE_NAME_LENGTH = 60;

interface WorkspacesData {
  workspaces: Workspace[];
  // Maps an image filename to the list of workspace ids it belongs to.
  assignments: Record<string, string[]>;
}

// All mutations are serialized through this promise chain so concurrent
// generations / membership edits can't clobber each other's read-modify-write.
let writeChain: Promise<unknown> = Promise.resolve();

function isSafeFilename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("..") &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

export function isValidWorkspaceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

export function normalizeWorkspaceName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_WORKSPACE_NAME_LENGTH);
}

function normalizeData(raw: unknown): WorkspacesData {
  if (!raw || typeof raw !== "object") return { workspaces: [], assignments: {} };

  const record = raw as Record<string, unknown>;
  const workspaces = Array.isArray(record.workspaces)
    ? record.workspaces
        .filter(
          (item): item is Workspace =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as Workspace).id === "string" &&
            typeof (item as Workspace).name === "string"
        )
        .map((item) => ({
          id: item.id,
          name: item.name,
          createdAt:
            typeof item.createdAt === "number" ? item.createdAt : Date.now(),
        }))
    : [];

  const assignments: Record<string, string[]> = {};
  if (record.assignments && typeof record.assignments === "object") {
    for (const [filename, ids] of Object.entries(
      record.assignments as Record<string, unknown>
    )) {
      if (!isSafeFilename(filename) || !Array.isArray(ids)) continue;
      const normalized = ids.filter(
        (id): id is string => typeof id === "string"
      );
      if (normalized.length > 0) assignments[filename] = normalized;
    }
  }

  return { workspaces, assignments };
}

async function readData(): Promise<WorkspacesData> {
  try {
    const content = await readFile(WORKSPACES_FILE, "utf-8");
    return normalizeData(JSON.parse(content));
  } catch {
    return { workspaces: [], assignments: {} };
  }
}

async function writeData(data: WorkspacesData) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(WORKSPACES_FILE, JSON.stringify(data, null, 2));
}

// Serializes a read-modify-write against the workspaces file.
function mutate<T>(updater: (data: WorkspacesData) => { data: WorkspacesData; result: T }) {
  const next = writeChain.then(async () => {
    const current = await readData();
    const { data, result } = updater(current);
    await writeData(data);
    return result;
  });

  // Keep the chain alive even if this mutation rejects.
  writeChain = next.catch(() => {});

  return next;
}

function pruneAssignmentsForWorkspace(
  assignments: Record<string, string[]>,
  workspaceId: string
) {
  const next: Record<string, string[]> = {};
  for (const [filename, ids] of Object.entries(assignments)) {
    const filtered = ids.filter((id) => id !== workspaceId);
    if (filtered.length > 0) next[filename] = filtered;
  }
  return next;
}

// The stored array order is the user-facing order: new workspaces are appended
// (so it starts out as creation order) and `reorderWorkspaces` rewrites it when
// the user drags a chip to a new position.
export async function listWorkspaceSummaries(): Promise<WorkspaceSummary[]> {
  const { workspaces, assignments } = await readData();
  const counts = new Map<string, number>();

  for (const ids of Object.values(assignments)) {
    for (const id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return workspaces.map((workspace) => ({
    ...workspace,
    count: counts.get(workspace.id) ?? 0,
  }));
}

export async function getAssignments(): Promise<Record<string, string[]>> {
  const { assignments } = await readData();
  return assignments;
}

export async function getWorkspaceFilenames(
  workspaceId: string
): Promise<Set<string>> {
  const { assignments } = await readData();
  const filenames = new Set<string>();
  for (const [filename, ids] of Object.entries(assignments)) {
    if (ids.includes(workspaceId)) filenames.add(filename);
  }
  return filenames;
}

export async function workspaceExists(workspaceId: string): Promise<boolean> {
  const { workspaces } = await readData();
  return workspaces.some((workspace) => workspace.id === workspaceId);
}

export function createWorkspace(name: string): Promise<Workspace> {
  const workspace: Workspace = {
    id: randomUUID(),
    name,
    createdAt: Date.now(),
  };

  return mutate((data) => ({
    data: { ...data, workspaces: [...data.workspaces, workspace] },
    result: workspace,
  }));
}

export function renameWorkspace(
  workspaceId: string,
  name: string
): Promise<Workspace | null> {
  return mutate((data) => {
    const target = data.workspaces.find((item) => item.id === workspaceId);
    if (!target) return { data, result: null };

    const updated: Workspace = { ...target, name };
    return {
      data: {
        ...data,
        workspaces: data.workspaces.map((item) =>
          item.id === workspaceId ? updated : item
        ),
      },
      result: updated,
    };
  });
}

// Rewrites the stored order from a client-supplied id list. Ids the client did
// not know about (created concurrently, in another tab) keep their relative
// order at the end instead of being dropped.
export function reorderWorkspaces(orderedIds: string[]): Promise<Workspace[]> {
  return mutate((data) => {
    const remaining = new Map(data.workspaces.map((item) => [item.id, item]));
    const workspaces: Workspace[] = [];

    for (const id of orderedIds) {
      const workspace = remaining.get(id);
      if (!workspace) continue;
      workspaces.push(workspace);
      remaining.delete(id);
    }
    for (const workspace of data.workspaces) {
      if (remaining.has(workspace.id)) workspaces.push(workspace);
    }

    return { data: { ...data, workspaces }, result: workspaces };
  });
}

export function deleteWorkspace(workspaceId: string): Promise<boolean> {
  return mutate((data) => {
    const exists = data.workspaces.some((item) => item.id === workspaceId);
    return {
      data: {
        workspaces: data.workspaces.filter((item) => item.id !== workspaceId),
        assignments: pruneAssignmentsForWorkspace(data.assignments, workspaceId),
      },
      result: exists,
    };
  });
}

// Replaces the full set of workspaces an image belongs to. Unknown workspace
// ids are dropped so the assignments file never references a deleted workspace.
export function setImageWorkspaces(
  filename: string,
  workspaceIds: string[]
): Promise<string[]> {
  return mutate((data) => {
    const validIds = new Set(data.workspaces.map((item) => item.id));
    const nextIds = Array.from(
      new Set(workspaceIds.filter((id) => validIds.has(id)))
    );

    const assignments = { ...data.assignments };
    if (nextIds.length > 0) {
      assignments[filename] = nextIds;
    } else {
      delete assignments[filename];
    }

    return {
      data: { ...data, assignments },
      result: nextIds,
    };
  });
}

export function toggleImageWorkspace(
  filename: string,
  workspaceId: string,
  assigned: boolean
): Promise<string[]> {
  return mutate((data) => {
    const validIds = new Set(data.workspaces.map((item) => item.id));
    const current = data.assignments[filename] ?? [];
    let nextIds: string[];

    if (assigned) {
      nextIds = validIds.has(workspaceId)
        ? Array.from(new Set([...current, workspaceId]))
        : current;
    } else {
      nextIds = current.filter((id) => id !== workspaceId);
    }

    const assignments = { ...data.assignments };
    if (nextIds.length > 0) {
      assignments[filename] = nextIds;
    } else {
      delete assignments[filename];
    }

    return {
      data: { ...data, assignments },
      result: nextIds,
    };
  });
}

export function removeImageAssignments(filename: string): Promise<void> {
  return mutate((data) => {
    if (!(filename in data.assignments)) {
      return { data, result: undefined };
    }
    const assignments = { ...data.assignments };
    delete assignments[filename];
    return { data: { ...data, assignments }, result: undefined };
  });
}

// Creates a workspace under a caller-supplied id, or renames it when it already
// exists. Downloading a shared workspace reuses the sharer's id so a later
// re-download updates that same workspace instead of forking a duplicate.
export function upsertWorkspace(
  workspaceId: string,
  name: string,
  createdAt?: number
): Promise<Workspace> {
  return mutate((data) => {
    const existing = data.workspaces.find((item) => item.id === workspaceId);
    const workspace: Workspace = existing
      ? { ...existing, name }
      : {
          id: workspaceId,
          name,
          createdAt: typeof createdAt === "number" ? createdAt : Date.now(),
        };

    return {
      data: {
        ...data,
        workspaces: existing
          ? data.workspaces.map((item) =>
              item.id === workspaceId ? workspace : item
            )
          : [...data.workspaces, workspace],
      },
      result: workspace,
    };
  });
}

// Adds a batch of images to one workspace in a single read-modify-write, so
// downloading a shared workspace doesn't queue one file mutation per image.
export function addImagesToWorkspace(
  filenames: string[],
  workspaceId: string
): Promise<number> {
  return mutate((data) => {
    if (!data.workspaces.some((item) => item.id === workspaceId)) {
      return { data, result: 0 };
    }

    const assignments = { ...data.assignments };
    let added = 0;
    for (const filename of filenames) {
      if (!isSafeFilename(filename)) continue;
      const current = assignments[filename] ?? [];
      if (current.includes(workspaceId)) continue;
      assignments[filename] = [...current, workspaceId];
      added += 1;
    }

    return { data: { ...data, assignments }, result: added };
  });
}
