import { NextResponse } from "next/server";
import { queueBridge } from "@/lib/bridge";

export const maxDuration = 300;

type Ref = { filename?: unknown; subfolder?: unknown; type?: unknown };

const safeFile = (item: unknown) => {
  const file = (item && typeof item === "object" ? item : {}) as Ref;
  const filename = String(file.filename || "");
  const subfolder = String(file.subfolder || "");
  if (!filename || /[\\/]/.test(filename) || subfolder.includes("..")) return null;
  return { filename, subfolder, type: file.type === "input" || file.type === "temp" ? String(file.type) : "output" };
};

// POST { id, from: video, to: { video } | { image }, prompt, seconds, steps, seed } — queues the bridge render in
// ComfyUI (first/last-frame H3 model). Returns its prompt id and how many frames at each end are pinned.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      from?: unknown;
      to?: { video?: unknown; image?: unknown };
      prompt?: unknown;
      seconds?: unknown;
      steps?: unknown;
      seed?: unknown;
      endPin?: unknown;
    };
    const id = /^[a-zA-Z0-9_-]+$/.test(body.id || "") ? String(body.id) : "";
    const from = safeFile(body.from);
    const toVideo = safeFile(body.to?.video);
    const toImage = safeFile(body.to?.image);
    const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
    if (!id || !from) return NextResponse.json({ error: "Pick the take the bridge starts from." }, { status: 400 });
    if (!toVideo && !toImage) return NextResponse.json({ error: "Pick the take or picture the bridge leads into." }, { status: 400 });
    if (!prompt) return NextResponse.json({ error: "Describe what happens in the bridge." }, { status: 400 });
    const seconds = Math.min(8, Math.max(1, Number(body.seconds) || 3));
    const steps = Math.min(20, Math.max(4, Math.round(Number(body.steps) || 8)));
    const seed = Math.max(0, Math.floor(Number(body.seed) || Math.random() * 2 ** 48));
    // Default "clip": in tests a frame-only end made H3 cut and then hold still on that frame; a clip end at least
    // cuts straight into the moving take.
    const endPin = body.endPin === "frame" ? "frame" : "clip";
    const plan = await queueBridge({ id, from, to: toVideo ? { video: toVideo } : { image: toImage! }, prompt, seconds, steps, seed, endPin });
    return NextResponse.json({ ...plan, seed, steps, seconds, endPin });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the bridge.";
    return NextResponse.json({ error: message.slice(0, 600) }, { status: 500 });
  }
}
