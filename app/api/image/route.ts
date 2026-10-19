import { NextResponse } from "next/server";
import { generateReferenceImage } from "@/lib/comfyui";
import { IMAGE_ASPECT_RATIOS } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      storyId?: string;
      prompt?: string;
      negative?: string;
      aspectRatio?: string;
      megapixels?: number;
      seed?: number;
    };
    const prompt = body.prompt?.trim();
    if (!prompt) {
      return NextResponse.json({ error: "Write or generate an image prompt first." }, { status: 400 });
    }
    const aspectRatio = body.aspectRatio || "";
    if (!(IMAGE_ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) {
      return NextResponse.json({ error: "Pick a supported aspect ratio." }, { status: 400 });
    }
    const megapixels = Number(body.megapixels);
    if (!Number.isFinite(megapixels) || megapixels < 0.1 || megapixels > 4) {
      return NextResponse.json({ error: "Megapixels must be between 0.1 and 4." }, { status: 400 });
    }
    const seed = Math.max(0, Math.floor(Number(body.seed) || 0));
    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? body.storyId : "story";

    const images = await generateReferenceImage({
      prompt,
      negative: body.negative?.trim() || "",
      aspectRatio,
      megapixels,
      seed,
      filenamePrefix: `h3-story/${storyId}/reference`,
    });

    return NextResponse.json({ image: images[0] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
