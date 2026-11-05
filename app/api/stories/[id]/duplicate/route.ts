import { NextResponse } from "next/server";
import { duplicateStory } from "@/lib/story-store";

type RouteContext = { params: Promise<{ id: string }> };

// POST — copies the story (without its generated videos and comparisons) and returns the copy.
// Optional JSON body: { fromFrames: true } stops the copy at Frames; stepModels and title replace the source's.
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      fromFrames?: unknown;
      stepModels?: { frames?: unknown; prompts?: unknown };
      title?: unknown;
    };
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
    const stepModels =
      body.stepModels && typeof body.stepModels === "object"
        ? { frames: text(body.stepModels.frames), prompts: text(body.stepModels.prompts) }
        : undefined;
    const story = await duplicateStory(id, { fromFrames: body.fromFrames === true, stepModels, title: text(body.title) });
    if (!story) return NextResponse.json({ error: "Story not found." }, { status: 404 });
    return NextResponse.json({ story });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not duplicate the story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
