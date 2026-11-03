import { NextResponse } from "next/server";
import { projectExists } from "@/lib/project-store";
import { createStory, listStories } from "@/lib/story-store";
import { DEFAULT_PROJECT_ID, isStoryType } from "@/lib/types";

export async function GET() {
  try {
    return NextResponse.json({ stories: await listStories() });
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
