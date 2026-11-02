import { comparisonFile } from "@/lib/compare";
import { serveFile } from "@/lib/serve-file";

// GET ?storyId=&id= — the comparison video, with Range support so the player can seek.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  let file: string;
  try {
    file = comparisonFile(params.get("storyId") || "", params.get("id") || "");
  } catch {
    return Response.json({ error: "Invalid comparison reference." }, { status: 400 });
  }
  const response = await serveFile(request, file, "private, max-age=3600");
  return response || Response.json({ error: "Comparison video not found." }, { status: 404 });
}
