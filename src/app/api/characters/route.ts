import { type NextRequest, NextResponse } from "next/server";
import { createCharacter, listCharacters, normalizeCharacterName } from "@/lib/characters";

export async function GET() {
  try {
    const characters = await listCharacters();
    return NextResponse.json({ characters });
  } catch {
    return NextResponse.json({ characters: [] });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name = normalizeCharacterName(body?.name);

  if (!name) {
    return NextResponse.json(
      { error: "Character name is required" },
      { status: 400 }
    );
  }

  try {
    const character = await createCharacter(name);
    return NextResponse.json({ character });
  } catch {
    return NextResponse.json(
      { error: "Failed to create character" },
      { status: 500 }
    );
  }
}
