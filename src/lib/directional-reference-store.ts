"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DirectionalSheetViews } from "./directional-reference";

// The character sheet linked for 방향별 참조. Shared by the generator's plain
// Generate and the varied batch, and kept across reloads (a per-browser
// convenience: the crops are server files, only their URLs live here).
export interface LinkedSheet extends DirectionalSheetViews {
  /** The sheet image it was cut from (/api/consistency-sheet/images/...). */
  sheetUrl: string;
}

interface DirectionalReferenceState {
  linked: LinkedSheet | null;
  /** Off keeps the link but stops applying it. */
  enabled: boolean;
  setLinked: (linked: LinkedSheet | null) => void;
  setEnabled: (enabled: boolean) => void;
}

export const useDirectionalReferenceStore = create<DirectionalReferenceState>()(
  persist(
    (set) => ({
      linked: null,
      enabled: true,
      setLinked: (linked) => set({ linked, enabled: Boolean(linked) }),
      setEnabled: (enabled) => set({ enabled }),
    }),
    { name: "imagegen:directional-reference" }
  )
);
