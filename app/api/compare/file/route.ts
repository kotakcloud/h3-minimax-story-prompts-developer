import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { comparisonFile } from "@/lib/compare";

// GET ?storyId=&id= — the comparison video, with Range support so the player can seek.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let file: string;
  try {
    file = comparisonFile(params.get("storyId") || "", params.get("id") || "");
  } catch {
    return Response.json({ error: "Invalid comparison reference." }, { status: 400 });
  }
  const info = await stat(file).catch(() => null);
  if (!info) return Response.json({ error: "Comparison video not found." }, { status: 404 });

  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    const stream = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(info.size) } });
}
