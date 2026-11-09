import { readFile } from "fs/promises";
import { join } from "path";
import { NextResponse } from "next/server";
import type { ConsistencySheetImage } from "@/lib/consistency-sheet";
import { getAssignments } from "@/lib/workspaces";
import {
  CONSISTENCY_SHEET_OUTPUT_DIR,
  listConsistencySheetFilenames,
} from "@/lib/server-consistency-sheet";

export async function GET() {
  try {
    const [imageFiles, assignments] = await Promise.all([
      listConsistencySheetFilenames(),
      // Workspace membership rides along so the gallery can show and filter by
      // the workspace each sheet was saved into.
      getAssignments("consistencySheet").catch(
        () => ({}) as Record<string, string[]>
      ),
    ]);

    const images = await Promise.all(
      imageFiles.map(async (filename): Promise<ConsistencySheetImage> => {
        const metaPath = join(
          CONSISTENCY_SHEET_OUTPUT_DIR,
          filename.replace(/\.\w+$/, ".json")
        );
        const workspaces = assignments[filename] ?? [];
        try {
          const meta = JSON.parse(
            await readFile(metaPath, "utf-8")
          ) as ConsistencySheetImage;
          // Trust the on-disk url but re-derive if missing.
          return {
            ...meta,
            url: meta.url || `/api/consistency-sheet/images/${filename}`,
            workspaces,
          };
        } catch {
          // Sidecar missing/corrupt — still show the file.
          return {
            id: filename,
            url: `/api/consistency-sheet/images/${filename}`,
            filename,
            timestamp: 0,
            contentType: "image/png",
            prompt: "",
            params: null,
            workspaces,
          };
        }
      })
    );

    images.sort((a, b) => b.timestamp - a.timestamp);
    return NextResponse.json({ images });
  } catch {
    return NextResponse.json({ images: [] });
  }
}
