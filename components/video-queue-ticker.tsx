"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ActiveVideo } from "@/app/api/video/active/route";

const BUSY_REFRESH_MS = 5_000;
const IDLE_REFRESH_MS = 20_000;

function elapsed(since: string, now: number): string {
  const start = Date.parse(since);
  if (!start) return "";
  const minutes = Math.max(0, Math.floor((now - start) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// Videos in progress across all stories (ComfyUI runs one at a time; the rest wait in its queue). Each badge opens
// that story's Video step. Hidden when nothing is running.
export function VideoQueueTicker() {
  const pathname = usePathname();
  const [videos, setVideos] = useState<ActiveVideo[]>([]);
  const [otherJobs, setOtherJobs] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      window.clearTimeout(timer);
      let busy = false;
      if (document.visibilityState === "visible") {
        try {
          const data = (await fetch("/api/video/active").then((response) => response.json())) as {
            videos?: ActiveVideo[];
            otherJobs?: number;
          };
          if (cancelled) return;
          setVideos(data.videos || []);
          setOtherJobs(data.otherJobs || 0);
          setNow(Date.now());
          busy = (data.videos?.length || 0) + (data.otherJobs || 0) > 0;
        } catch {
          // The app or ComfyUI is briefly unreachable: keep what is shown and try again.
        }
      }
      if (!cancelled) timer = window.setTimeout(load, busy ? BUSY_REFRESH_MS : IDLE_REFRESH_MS);
    };
    void load();
    const onVisible = () => void load();
    document.addEventListener("visibilitychange", onVisible);
    // A video queued from a story page shows up at once.
    window.addEventListener("h3-video-queued", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("h3-video-queued", onVisible);
    };
  }, []);

  if (videos.length === 0 && otherJobs === 0) return null;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 text-xs [scrollbar-width:none]" aria-label="Videos in progress">
      {videos.map((video) => {
        const here = pathname?.startsWith(`/stories/${video.storyId}/`);
        const running = video.status === "running";
        return (
          <Link
            key={video.runId}
            href={`/stories/${video.storyId}/video`}
            title={`${video.title}${video.code ? ` (#${video.code})` : ""}\n${
              running
                ? `Running: ${video.segmentsDone}/${video.segmentCount} segments${video.runningSince ? `, for ${elapsed(video.runningSince, now)}` : ""}`
                : `Waiting in ComfyUI's queue: number ${video.queuePosition}`
            }\nOpen its Video step`}
            className={`flex max-w-64 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${
              here ? "border-accent text-foreground" : "border-line text-muted hover:border-accent hover:text-foreground"
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "animate-pulse bg-accent" : "bg-muted"}`} />
            {video.code && <span className="font-mono">#{video.code}</span>}
            <span className="truncate">{video.title}</span>
            <span className="shrink-0 font-mono">
              {running
                ? `${video.segmentsDone}/${video.segmentCount}${video.runningSince ? ` · ${elapsed(video.runningSince, now)}` : ""}`
                : `queued ${video.queuePosition}`}
            </span>
          </Link>
        );
      })}
      {otherJobs > 0 && (
        <span
          className="shrink-0 rounded-full border border-dashed border-line px-2.5 py-0.5 text-muted"
          title="ComfyUI jobs that are not a story's video (images, or jobs queued in ComfyUI itself)"
        >
          +{otherJobs} other ComfyUI {otherJobs === 1 ? "job" : "jobs"}
        </span>
      )}
    </div>
  );
}
