import { NextResponse } from "next/server";
import { renameProject, setProjectArchived, setProjectCharacters, setProjectSeed } from "@/lib/project-store";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH { name } renames the project; { characterText } saves its character designs and the cards read from them;
// { videoSeed } sets the video seed new stories start with (null = none); { archived } archives or brings it back.
export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      characterText?: unknown;
      videoSeed?: unknown;
      archived?: unknown;
    };
    const project =
      body.archived !== undefined
        ? await setProjectArchived(id, body.archived)
        : body.videoSeed !== undefined
        ? await setProjectSeed(id, body.videoSeed)
        : body.characterText !== undefined
          ? await setProjectCharacters(id, body.characterText)
          : await renameProject(id, body.name);
    if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json({ project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not rename the project.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
