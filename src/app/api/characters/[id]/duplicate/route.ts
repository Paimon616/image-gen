import { type NextRequest, NextResponse } from "next/server";
import { duplicateCharacter, isValidCharacterId } from "@/lib/characters";

// Copies a character, with fresh ids for its outfits / backgrounds / situations.
// The copy is stored directly after the original, so the client inserts it there
// rather than appending.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const character = await duplicateCharacter(id);
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  return NextResponse.json({ character });
}
