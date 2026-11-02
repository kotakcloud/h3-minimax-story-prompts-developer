import { comfyViewUrl, localOutputFile } from "@/lib/comfyui";
import { serveFile } from "@/lib/serve-file";

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
    // Straight from disk when the app knows ComfyUI's output folder.
    const local = await localOutputFile({ filename, subfolder, type });
    const served = local && (await serveFile(request, local, "private, max-age=31536000, immutable"));
    if (served) return served;

    // Videos also come through here: the player seeks with Range requests, which ComfyUI answers.
    const range = request.headers.get("range");
    const upstream = await fetch(comfyViewUrl({ filename, subfolder, type }), range ? { headers: { Range: range } } : undefined);
    if (upstream.status === 416) {
      return new Response(null, { status: 416, headers: { "Content-Range": upstream.headers.get("Content-Range") || "" } });
    }
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: `ComfyUI returned ${upstream.status}.` }, { status: 502 });
    }
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") || "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
    };
    for (const name of ["Accept-Ranges", "Content-Length", "Content-Range"]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return Response.json({ error: "ComfyUI is not reachable." }, { status: 502 });
  }
}
