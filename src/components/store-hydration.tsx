"use client";

import { useEffect } from "react";

import { hydratePersistedParams } from "@/lib/store";
import { hydratePersistedVideoParams } from "@/lib/video-store";

/**
 * Restores the remembered image/video generation settings from localStorage.
 *
 * Reading them while the stores are created would desync the server-rendered
 * HTML, so the restore is deferred to this mount effect. It lives at the very
 * top of the tree on purpose: React flushes effects in tree order, so the
 * restored params are in place before the editor's own effects (which read the
 * checkpoint, size, and ratio) run for the first time.
 */
export function StoreHydration() {
  useEffect(() => {
    hydratePersistedParams();
    hydratePersistedVideoParams();
  }, []);

  return null;
}
