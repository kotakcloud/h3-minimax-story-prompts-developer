import { NextResponse } from "next/server";
import { safeVideo } from "@/lib/compare";
import { tightenVideo } from "@/lib/tighten";

export const maxDuration = 600;

// POST { storyId, runId, video } — a copy of the finished video without its dead air, no GPU. The file is served and
// deleted through /api/compare, with the id from tightenedId().
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { storyId?: string; runId?: string; video?: unknown };
    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    const runId = /^[a-zA-Z0-9_-]+$/.test(body.runId || "") ? String(body.runId) : "";
    const video = safeVideo(body.video);
    if (!storyId || !runId || !video) return NextResponse.json({ error: "Pick a finished video." }, { status: 400 });
    return NextResponse.json(await tightenVideo(storyId, runId, video));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not tighten the video.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}
