import { execFile } from "node:child_process";
import { NextResponse } from "next/server";
import { COMFYUI_URL } from "@/lib/comfyui";

// Only this app's own pages: the server listens on the network, so no other site may trigger this.
function sameOrigin(request: Request): boolean {
  try {
    return new URL(request.headers.get("origin") || "").host === request.headers.get("host");
  } catch {
    return false;
  }
}

// POST — hibernates this computer, unless ComfyUI still has work (409: try again later).
export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "Hibernate is only set up for Windows." }, { status: 400 });
  }
  // ComfyUI being unreachable means nothing is rendering.
  const queue = (await fetch(`${COMFYUI_URL}/queue`)
    .then((response) => response.json())
    .catch(() => null)) as { queue_running?: unknown[]; queue_pending?: unknown[] } | null;
  if (queue && (queue.queue_running?.length || queue.queue_pending?.length)) {
    return NextResponse.json({ error: "ComfyUI still has jobs." }, { status: 409 });
  }
  // A moment later, so this answer reaches the page first.
  setTimeout(() => {
    execFile("shutdown", ["/h"], (error) => {
      if (error) console.error(`[hibernate] ${error.message}`);
    });
  }, 1000);
  return NextResponse.json({ ok: true });
}
