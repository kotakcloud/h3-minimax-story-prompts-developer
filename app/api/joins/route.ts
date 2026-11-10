import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { joinFile, joinVideos } from "@/lib/join";

export const maxDuration = 600;

const safeVideo = (item: unknown) => {
  const video = (item && typeof item === "object" ? item : {}) as { filename?: unknown; subfolder?: unknown; type?: unknown };
  const filename = String(video.filename || "");
  const subfolder = String(video.subfolder || "");
  if (!filename || /[\\/]/.test(filename) || subfolder.includes("..")) return null;
  return { filename, subfolder, type: video.type === "input" || video.type === "temp" ? String(video.type) : "output" };
};

// POST { storyId, id, videos: [first, second, ...] } — one video of the takes played one after another.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { storyId?: string; id?: string; videos?: unknown[] };
    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    const id = /^[a-zA-Z0-9_-]+$/.test(body.id || "") ? String(body.id) : "";
    if (!storyId || !id) return NextResponse.json({ error: "Missing story or join id." }, { status: 400 });
    const videos = (Array.isArray(body.videos) ? body.videos : []).map(safeVideo);
    if (videos.length < 2 || videos.length > 4 || videos.some((video) => !video)) {
      return NextResponse.json({ error: "Pick 2 finished videos to join." }, { status: 400 });
    }
    const result = await joinVideos(storyId, id, videos as NonNullable<(typeof videos)[number]>[]);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not join the videos.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}

// DELETE ?storyId=&id= — removes the joined video's file (the story entry is removed by the client).
export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    await unlink(joinFile(params.get("storyId") || "", params.get("id") || "")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete the joined video.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
