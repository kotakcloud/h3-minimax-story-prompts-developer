import { NextResponse } from "next/server";
import { readStory } from "@/lib/story-store";
import { buildTimelineWorkflow } from "@/lib/timeline-export";

type RouteContext = { params: Promise<{ id: string }> };

// GET — the story as a comfyui-obvpm-timeline workflow, to open in ComfyUI. Nothing is queued.
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const story = await readStory(id);
    if (!story) return NextResponse.json({ error: "Story not found." }, { status: 404 });
    return NextResponse.json(await buildTimelineWorkflow(story));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export the timeline workflow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
