import { NextResponse } from "next/server";
import { promptState } from "@/lib/comfyui";

// GET ?promptId= — where the bridge render stands; when done, the video file it saved.
export async function GET(request: Request) {
  const promptId = new URL(request.url).searchParams.get("promptId") || "";
  if (!/^[a-f0-9-]{8,}$/i.test(promptId)) return NextResponse.json({ error: "Invalid bridge reference." }, { status: 400 });
  try {
    const state = await promptState(promptId);
    // The saved bridge (output folder), not the input clips ComfyUI echoes back from its loaders.
    const video = state.files.find((file) => file.type === "output" && /\.(mp4|webm|mov)$/i.test(file.filename)) || null;
    if (state.status === "done" && !video) {
      return NextResponse.json({ status: "error", queuePosition: 0, video: null, error: "The bridge finished without a video file." });
    }
    return NextResponse.json({
      status: state.status,
      queuePosition: state.queuePosition,
      video: video ? { filename: video.filename, subfolder: video.subfolder, type: video.type } : null,
      error: state.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the bridge status.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
