import { NextResponse } from "next/server";
import { setNote } from "@/lib/story-store";

type RouteContext = { params: Promise<{ id: string }> };

// POST { note } — the story's free note from the story list.
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { note?: unknown };
    if (typeof body.note !== "string") return NextResponse.json({ error: "Send note as text." }, { status: 400 });
    const story = await setNote(id, body.note.slice(0, 4000));
    if (!story) return NextResponse.json({ error: "Story not found." }, { status: 404 });
    return NextResponse.json({ note: story.note });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the note.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
