import { NextResponse } from "next/server";
import { projectExists } from "@/lib/project-store";
import { setProject } from "@/lib/story-store";

type RouteContext = { params: Promise<{ id: string }> };

// POST { projectId } — moves a story to another project.
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { projectId?: unknown };
    if (typeof body.projectId !== "string" || !(await projectExists(body.projectId))) {
      return NextResponse.json({ error: "That project does not exist." }, { status: 400 });
    }
    const story = await setProject(id, body.projectId);
    if (!story) return NextResponse.json({ error: "Story not found." }, { status: 404 });
    return NextResponse.json({ projectId: story.projectId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not move the story.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
