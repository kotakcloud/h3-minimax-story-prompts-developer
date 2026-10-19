import { longTakeStatus } from "@/lib/comfyui";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const promptId = params.get("promptId") || "";
  const project = params.get("project") || "";
  const segmentCount = Number(params.get("segments") || 0);
  const startedAt = Date.parse(params.get("startedAt") || "") || 0;

  if (!/^[a-f0-9-]{8,}$/i.test(promptId) || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return Response.json({ error: "Invalid run reference." }, { status: 400 });
  }

  try {
    return Response.json(await longTakeStatus(promptId, project, segmentCount, startedAt));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read the run status.";
    return Response.json({ error: message }, { status: 502 });
  }
}
