import { type NextRequest, NextResponse } from "next/server";
import {
  deleteCharacter,
  getCharacter,
  isValidCharacterId,
  updateCharacter,
} from "@/lib/characters";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const character = await getCharacter(id);
  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  return NextResponse.json({ character });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const character = await updateCharacter(id, body);

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  return NextResponse.json({ character });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!isValidCharacterId(id)) {
    return NextResponse.json({ error: "Invalid character id" }, { status: 400 });
  }

  const deleted = await deleteCharacter(id);

  if (!deleted) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
