import { NextResponse } from "next/server";
import { projectExists } from "@/lib/project-store";
import { readStoryCost } from "@/lib/story-cost";
import { createStory, listStories } from "@/lib/story-store";
import { DEFAULT_PROJECT_ID, isStoryType } from "@/lib/types";

export async function GET() {
  try {
    // With each story's AI cost so far (the cost files live apart from the stories).
    const stories = await Promise.all(
      (await listStories()).map(async (story) => ({ ...story, aiCostUsd: (await readStoryCost(story.id))?.usd ?? 0 })),
    );
    return NextResponse.json({ stories });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list stories.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { storyType?: unknown; projectId?: unknown };
    const projectId = typeof body.projectId === "string" && (await projectExists(body.projectId)) ? body.projectId : DEFAULT_PROJECT_ID;
    const story = await createStory(isStoryType(body.storyType) ? body.storyType : "regular", projectId);
    return NextResponse.json({ story }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
