import { NextResponse } from "next/server";
import { createStory, listStories } from "@/lib/story-store";

export async function GET() {
  try {
    return NextResponse.json({ stories: await listStories() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list stories.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const story = await createStory();
    return NextResponse.json({ story }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create a story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
