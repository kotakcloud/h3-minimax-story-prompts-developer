import { NextResponse } from "next/server";
import { unlink } from "node:fs/promises";
import { comparisonFile, stitchComparison, type CompareTile } from "@/lib/compare";

export const maxDuration = 600;

const safeVideo = (item: unknown) => {
  const video = (item && typeof item === "object" ? item : {}) as { filename?: unknown; subfolder?: unknown; type?: unknown };
  const filename = String(video.filename || "");
  const subfolder = String(video.subfolder || "");
  if (!filename || /[\/]/.test(filename) || subfolder.includes("..")) return null;
  return { filename, subfolder, type: video.type === "input" || video.type === "temp" ? String(video.type) : "output" };
};

// POST { storyId, id, tiles: [{ video, lines }], audioFrom } — stitches the comparison video.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      storyId?: string;
      id?: string;
      tiles?: { video?: unknown; lines?: unknown }[];
      audioFrom?: number;
    };
    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    const id = /^[a-zA-Z0-9_-]+$/.test(body.id || "") ? String(body.id) : "";
    if (!storyId || !id) return NextResponse.json({ error: "Missing story or comparison id." }, { status: 400 });
    const tiles: CompareTile[] = [];
    for (const tile of Array.isArray(body.tiles) ? body.tiles : []) {
      const video = safeVideo(tile.video);
      if (!video) return NextResponse.json({ error: "Every compared generation needs a finished video." }, { status: 400 });
      tiles.push({ video, lines: (Array.isArray(tile.lines) ? tile.lines : []).map(String).slice(0, 4) });
    }
    if (tiles.length < 2 || tiles.length > 4) {
      return NextResponse.json({ error: "Pick 2 to 4 generations to compare." }, { status: 400 });
    }
    const result = await stitchComparison(storyId, id, tiles, Math.round(Number(body.audioFrom) || 0));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build the comparison.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}

// DELETE ?storyId=&id= — removes the comparison's video file (the story entry is removed by the client).
export async function DELETE(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    await unlink(comparisonFile(params.get("storyId") || "", params.get("id") || "")).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete the comparison.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
