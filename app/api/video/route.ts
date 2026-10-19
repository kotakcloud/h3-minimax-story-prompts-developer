import { NextResponse } from "next/server";
import { queueLongTake } from "@/lib/comfyui";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      storyId?: string;
      segments?: { duration?: number; prompt?: string }[];
      image?: { filename?: string; subfolder?: string; type?: string };
      devMode?: boolean;
      seed?: number;
    };

    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    if (!storyId) {
      return NextResponse.json({ error: "Missing story id." }, { status: 400 });
    }
    const segments = (Array.isArray(body.segments) ? body.segments : [])
      .map((segment) => ({ duration: Number(segment.duration), prompt: segment.prompt?.trim() || "" }))
      .filter((segment) => segment.prompt && segment.duration >= 4 && segment.duration <= 15);
    if (segments.length === 0 || segments.length !== (body.segments || []).length) {
      return NextResponse.json({ error: "Every segment needs a prompt and a 4–15 s duration." }, { status: 400 });
    }
    const image = body.image;
    if (!image?.filename || /[\\/]/.test(image.filename) || (image.subfolder || "").includes("..")) {
      return NextResponse.json({ error: "Select a reference image first." }, { status: 400 });
    }

    const { promptId, project } = await queueLongTake({
      segments,
      image: { filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" },
      devMode: body.devMode !== false,
      seed: Math.max(0, Math.floor(Number(body.seed) || 0)),
      projectBase: `h3s_${storyId.slice(0, 8)}`,
    });

    return NextResponse.json({ promptId, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
