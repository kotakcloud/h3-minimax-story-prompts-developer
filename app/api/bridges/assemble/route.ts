import { NextResponse } from "next/server";
import { probe } from "@/lib/compare";
import { joinVideos } from "@/lib/join";
import { localOutputFile, comfyViewUrl } from "@/lib/comfyui";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const maxDuration = 600;

type Ref = { filename?: unknown; subfolder?: unknown; type?: unknown };

const safeVideo = (item: unknown) => {
  const file = (item && typeof item === "object" ? item : {}) as Ref;
  const filename = String(file.filename || "");
  const subfolder = String(file.subfolder || "");
  if (!filename || /[\\/]/.test(filename) || subfolder.includes("..")) return null;
  return { filename, subfolder, type: file.type === "input" || file.type === "temp" ? String(file.type) : "output" };
};

// How many frames the rendered bridge has (read from the file, so the trim matches what was decoded).
async function frameCount(video: { filename: string; subfolder: string; type: string }): Promise<number> {
  const local = await localOutputFile(video);
  if (local) return Math.round((await probe(local)).duration * 24);
  const work = await mkdtemp(path.join(os.tmpdir(), "h3-bridge-probe-"));
  try {
    const response = await fetch(comfyViewUrl(video));
    if (!response.ok) throw new Error(`ComfyUI could not return the bridge (${response.status}).`);
    await writeFile(path.join(work, "bridge.mp4"), Buffer.from(await response.arrayBuffer()));
    return Math.round((await probe(path.join(work, "bridge.mp4"))).duration * 24);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// POST { storyId, id, from, bridge, to?, pinnedHead, pinnedTail } — first take, then the bridge without its pinned
// frames, then the second take (when there is one), as one video under the story's joined videos.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      storyId?: string;
      id?: string;
      from?: unknown;
      bridge?: unknown;
      to?: unknown;
      pinnedHead?: unknown;
      pinnedTail?: unknown;
    };
    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    const id = /^[a-zA-Z0-9_-]+$/.test(body.id || "") ? String(body.id) : "";
    const from = safeVideo(body.from);
    const bridge = safeVideo(body.bridge);
    const to = body.to ? safeVideo(body.to) : null;
    if (!storyId || !id || !from || !bridge) return NextResponse.json({ error: "Missing the takes or the bridge." }, { status: 400 });
    const total = await frameCount(bridge);
    const head = Math.max(0, Math.round(Number(body.pinnedHead) || 0));
    const tail = Math.max(0, Math.round(Number(body.pinnedTail) || 0));
    if (total - head - tail < 2) return NextResponse.json({ error: "The bridge is too short to join." }, { status: 400 });
    const videos = to ? [from, bridge, to] : [from, bridge];
    const trims = [null, { start: head, end: total - tail }, null];
    const result = await joinVideos(storyId, id, videos, trims);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not join the bridge.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}
