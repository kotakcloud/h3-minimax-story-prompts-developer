import { comfyQueue, longTakeStatus } from "@/lib/comfyui";
import { readAllStories } from "@/lib/story-store";

export const dynamic = "force-dynamic";

export type ActiveVideo = {
  storyId: string;
  code: string;
  title: string;
  runId: string;
  status: "queued" | "running";
  // 1 = next in ComfyUI's queue (0 while running).
  queuePosition: number;
  segmentsDone: number;
  segmentCount: number;
  runningSince: string;
  createdAt: string;
};

// GET — every video in progress across all stories, checked live against ComfyUI's queue (a story's own page saves
// the status only while it is open), plus how many other ComfyUI jobs (not from a story) are queued or running.
export async function GET() {
  try {
    const queue = await comfyQueue();
    const stories = await readAllStories();
    const candidates = stories.flatMap((story) =>
      story.videos
        .filter((run) => (run.status === "queued" || run.status === "running") && run.promptId && run.project)
        .filter((run) => queue.running.includes(run.promptId) || queue.pending.includes(run.promptId))
        .map((run) => ({ story, run })),
    );
    const videos = await Promise.all(
      candidates.map(async ({ story, run }): Promise<ActiveVideo | null> => {
        const live = await longTakeStatus(
          run.promptId,
          run.project,
          run.segmentCount,
          Date.parse(run.runningSince || run.createdAt) || 0,
        ).catch(() => null);
        if (!live || (live.status !== "queued" && live.status !== "running")) return null;
        return {
          storyId: story.id,
          code: story.code,
          title: story.title,
          runId: run.id,
          status: live.status,
          queuePosition: live.queuePosition,
          segmentsDone: live.segmentsDone,
          segmentCount: run.segmentCount,
          runningSince: run.runningSince || "",
          createdAt: run.createdAt,
        };
      }),
    );
    const active = videos
      .filter((item): item is ActiveVideo => item !== null)
      .sort((a, b) => (a.status === b.status ? a.queuePosition - b.queuePosition : a.status === "running" ? -1 : 1));
    const ours = new Set(candidates.map(({ run }) => run.promptId));
    const otherJobs = [...queue.running, ...queue.pending].filter((id) => !ours.has(id)).length;
    return Response.json({ videos: active, otherJobs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read ComfyUI's queue.";
    return Response.json({ videos: [], otherJobs: 0, error: message }, { status: 502 });
  }
}
