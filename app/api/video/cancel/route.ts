import { NextResponse } from "next/server";
import { cancelPrompt } from "@/lib/comfyui";

// POST { promptId } — stops this video only (interrupt if running, remove if queued).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { promptId?: unknown };
    const promptId = typeof body.promptId === "string" ? body.promptId : "";
    if (!/^[a-f0-9-]{8,}$/i.test(promptId)) {
      return NextResponse.json({ error: "Invalid run reference." }, { status: 400 });
    }
    return NextResponse.json({ result: await cancelPrompt(promptId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not stop the video.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
