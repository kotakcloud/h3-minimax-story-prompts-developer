import { NextResponse } from "next/server";
import { projectExists } from "@/lib/project-store";
import { readStoryCost } from "@/lib/story-cost";
import { parseModelChain } from "@/lib/models";
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
    const body = (await request.json().catch(() => ({}))) as {
      storyType?: unknown;
      projectId?: unknown;
      // The Frames / Prompts steps' own models, chosen before creating (blank = the story's model).
      stepModels?: { frames?: unknown; prompts?: unknown };
    };
    const projectId = typeof body.projectId === "string" && (await projectExists(body.projectId)) ? body.projectId : DEFAULT_PROJECT_ID;
    const stepModel = (value: unknown) => {
      const chain = parseModelChain(value);
      if (chain.error) throw new Error(chain.error);
      return chain.models.join(",") || undefined;
    };
    const stepModels = { frames: stepModel(body.stepModels?.frames), prompts: stepModel(body.stepModels?.prompts) };
    const story = await createStory(isStoryType(body.storyType) ? body.storyType : "regular", projectId, stepModels);
    return NextResponse.json({ story }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
