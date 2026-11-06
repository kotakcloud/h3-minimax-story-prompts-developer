import { NextResponse } from "next/server";
import { renameProject, setProjectCharacters } from "@/lib/project-store";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH { name } renames the project; PATCH { characterText } saves its character designs and the cards read from them.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; characterText?: unknown };
    const project =
      body.characterText !== undefined ? await setProjectCharacters(id, body.characterText) : await renameProject(id, body.name);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not rename the project.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
