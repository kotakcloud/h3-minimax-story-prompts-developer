import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { uploadReferenceImage, type ComfyImage } from "@/lib/comfyui";
import { projectExists } from "@/lib/project-store";
import { addStory } from "@/lib/story-store";
import { DEFAULT_PROJECT_ID } from "@/lib/types";
import { packagePngs, parseVideoPackage, storyFromPackage } from "@/lib/video-package";

// POST (body: the video file, ?name=<file name>) — stores its images in ComfyUI and creates a Video-only story.
// Nothing is queued here; rendering starts from that story's Video tab.
export async function POST(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const fileName = (params.get("name") || "video-package.json").slice(0, 200);
    const project = params.get("project") || "";
    const projectId = project && (await projectExists(project)) ? project : DEFAULT_PROJECT_ID;
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "This is not an H3 video file." }, { status: 400 });
    }
    let pkg;
    try {
      pkg = parseVideoPackage(raw);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid file." }, { status: 400 });
    }

    const id = randomUUID();
    const image = pkg.images.find((item) => item.id === pkg.segments[0].image)!;
    const files: ComfyImage[] = [];
    for (const { suffix, bytes } of packagePngs(image)) {
      const blob = new Blob([new Uint8Array(bytes)], { type: "image/png" });
      files.push(await uploadReferenceImage(blob, `h3-story/${id}`, `package${suffix}.png`));
    }
    const story = await addStory(id, { ...storyFromPackage(pkg, fileName, files), projectId });
    return NextResponse.json({ story });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import the file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
