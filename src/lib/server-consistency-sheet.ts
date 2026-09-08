import { readdir } from "fs/promises";
import { join } from "path";

// Consistency sheets live in their own output folder, so workspace membership
// for the "consistencySheet" media is counted over these files.
export const CONSISTENCY_SHEET_OUTPUT_DIR = join(
  process.cwd(),
  "output",
  "consistency-sheet"
);

export async function listConsistencySheetFilenames(): Promise<string[]> {
  const files = await readdir(CONSISTENCY_SHEET_OUTPUT_DIR).catch(
    () => [] as string[]
  );
  return files.filter((file) => /\.png$/i.test(file));
}
