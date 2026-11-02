import { NextResponse } from "next/server";
import { safeVideo } from "@/lib/compare";
import { VOICE_SAMPLE_DEFAULT_SECONDS } from "@/lib/voice-references";
import { sampleFromUpload, sampleFromVideo } from "@/lib/voice-sample";

const SAFE_ID = /^[a-zA-Z0-9_-]+$/;

// POST a form { storyId, speaker, seconds, audio } or JSON { storyId, speaker, seconds, start, video }: a short voice
// sample, from an audio file or cut out of a finished video. It goes to ComfyUI's input folder; no GPU.
export async function POST(request: Request) {
  try {
    if ((request.headers.get("content-type") || "").startsWith("multipart/form-data")) {
      const form = await request.formData();
      const storyId = String(form.get("storyId") || "");
      const speaker = String(form.get("speaker") || "");
      const audio = form.get("audio");
      if (!SAFE_ID.test(storyId) || !SAFE_ID.test(speaker) || !(audio instanceof Blob)) {
        return NextResponse.json({ error: "Pick an audio file." }, { status: 400 });
      }
      const seconds = Number(form.get("seconds")) || VOICE_SAMPLE_DEFAULT_SECONDS;
      return NextResponse.json({ voice: await sampleFromUpload(storyId, speaker, audio, seconds) });
    }

    const body = (await request.json()) as {
      storyId?: string;
      speaker?: string;
      seconds?: number;
      start?: number;
      video?: unknown;
    };
    const storyId = String(body.storyId || "");
    const speaker = String(body.speaker || "");
    const video = safeVideo(body.video);
    if (!SAFE_ID.test(storyId) || !SAFE_ID.test(speaker) || !video) {
      return NextResponse.json({ error: "Pick a finished video." }, { status: 400 });
    }
    const seconds = Number(body.seconds) || VOICE_SAMPLE_DEFAULT_SECONDS;
    return NextResponse.json({ voice: await sampleFromVideo(storyId, speaker, video, Number(body.start) || 0, seconds) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not make the voice sample.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}
