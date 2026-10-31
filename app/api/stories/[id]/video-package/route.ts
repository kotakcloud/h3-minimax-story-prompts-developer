import { NextResponse } from "next/server";
import { comfyViewUrl } from "@/lib/comfyui";
import { readStory } from "@/lib/story-store";
import { buildVideoPackage } from "@/lib/video-package";

type RouteContext = { params: Promise<{ id: string }> };

// GET — the story's video file: current prompt set, video settings and the reference image (embedded).
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const story = await readStory(id);
    if (!story) return NextResponse.json({ error: "Story not found." }, { status: 404 });
    const pkg = await buildVideoPackage(story, async (image) => {
      const response = await fetch(comfyViewUrl(image)).catch(() => null);
      if (!response?.ok) throw new Error(`Could not read ${image.filename} from ComfyUI. Is it running?`);
      return Buffer.from(await response.arrayBuffer());
    });
    return NextResponse.json(pkg);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not export the video file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
