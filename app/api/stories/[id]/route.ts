import { NextResponse } from "next/server";
import { deleteStory, readStory, updateStory } from "@/lib/story-store";
import type { Story } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const story = await readStory(id);
  if (!story) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 });
  }
  return NextResponse.json({ story });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const patch = (await request.json()) as Partial<Story>;
    const story = await updateStory(id, patch);
    if (!story) {
      return NextResponse.json({ error: "Story not found." }, { status: 404 });
    }
    return NextResponse.json({ story });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const ok = await deleteStory(id);
  if (!ok) {
    return NextResponse.json({ error: "Story not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
