import { NextResponse } from "next/server";
import { duplicateStory } from "@/lib/story-store";

type RouteContext = { params: Promise<{ id: string }> };

// POST — copies the story (without its generated videos and comparisons) and returns the copy.
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const story = await duplicateStory(id);
    if (!story) return NextResponse.json({ error: "Story not found." }, { status: 404 });
    return NextResponse.json({ story });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not duplicate the story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
