import { NextResponse } from "next/server";
import { setArchived } from "@/lib/story-store";

type RouteContext = { params: Promise<{ id: string }> };

// POST { archived: boolean } — hides or restores a story in the story lists.
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as { archived?: unknown };
    if (typeof body.archived !== "boolean") {
      return NextResponse.json({ error: "Send archived: true or false." }, { status: 400 });
    }
    const story = await setArchived(id, body.archived);
    if (!story) {
      return NextResponse.json({ error: "Story not found." }, { status: 404 });
    }
    return NextResponse.json({ archived: story.archived });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not archive the story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
