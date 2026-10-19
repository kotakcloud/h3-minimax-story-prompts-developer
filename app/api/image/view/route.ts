import { comfyViewUrl } from "@/lib/comfyui";

const TYPES = new Set(["output", "input", "temp"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filename = params.get("filename") || "";
  const subfolder = params.get("subfolder") || "";
  const type = params.get("type") || "output";

  if (!filename || /[\\/]/.test(filename) || subfolder.includes("..") || !TYPES.has(type)) {
    return Response.json({ error: "Invalid image reference." }, { status: 400 });
  }

  try {
    const upstream = await fetch(comfyViewUrl({ filename, subfolder, type }));
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: `ComfyUI returned ${upstream.status}.` }, { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "image/png",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch {
    return Response.json({ error: "ComfyUI is not reachable." }, { status: 502 });
  }
}
