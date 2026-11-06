import { NextResponse } from "next/server";
import { readProject } from "@/lib/project-store";
import { setProjectStoriesSeed } from "@/lib/story-store";

type RouteContext = { params: Promise<{ id: string }> };

// POST — gives every story of the project the project's video seed; returns how many stories the project has.
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const project = await readProject(id);
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (project.videoSeed === undefined) return NextResponse.json({ error: "The project has no video seed." }, { status: 400 });
  const stories = await setProjectStoriesSeed(id, project.videoSeed);
  return NextResponse.json({ stories, seed: project.videoSeed });
}
