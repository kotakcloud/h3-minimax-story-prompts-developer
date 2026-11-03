import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/project-store";

export async function GET() {
  try {
    return NextResponse.json({ projects: await listProjects() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list projects.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST { name } — a new, empty project.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown };
    return NextResponse.json({ project: await createProject(body.name) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the project.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
