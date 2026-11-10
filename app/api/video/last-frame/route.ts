import { NextResponse } from "next/server";
import { uploadReferenceImage } from "@/lib/comfyui";
import { lastFrame } from "@/lib/join";

export const maxDuration = 120;

// POST { storyId, video } — the last frame of a finished video (usually another story's take), saved as a picture in
// this story's ComfyUI folder (h3-story/<storyId>/upload_<time>_last.png) so a segment can start from it.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { storyId?: string; video?: { filename?: string; subfolder?: string; type?: string } };
    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    if (!storyId) return NextResponse.json({ error: "Missing story id." }, { status: 400 });
    const filename = String(body.video?.filename || "");
    const subfolder = String(body.video?.subfolder || "");
    if (!filename || /[\\/]/.test(filename) || subfolder.includes("..")) {
      return NextResponse.json({ error: "Pick a finished video." }, { status: 400 });
    }
    const type = body.video?.type === "temp" || body.video?.type === "input" ? String(body.video.type) : "output";
    const png = await lastFrame({ filename, subfolder, type });
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const image = await uploadReferenceImage(new Blob([new Uint8Array(png)], { type: "image/png" }), `h3-story/${storyId}`, `upload_${stamp}_last.png`);
    return NextResponse.json({ image });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not take the last frame.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}
