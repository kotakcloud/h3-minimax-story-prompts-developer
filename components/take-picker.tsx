"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { engineInfo } from "@/lib/engines";
import type { Story, StorySummary, VideoRun } from "@/lib/types";

export type PickedTake = { story: Story; run: VideoRun & { video: NonNullable<VideoRun["video"]> } };

function viewSrc(video: { filename: string; subfolder: string; type: string }) {
  return `/api/image/view?${new URLSearchParams({ filename: video.filename, subfolder: video.subfolder, type: video.type })}`;
}

function takeLabel(run: VideoRun) {
  const quality = run.ultraFast ? "ULTRA FAST" : run.devMode ? "DEV" : "FULL";
  const range =
    run.firstSegment || (run.totalSegments && run.segmentCount < run.totalSegments)
      ? ` · segments ${run.firstSegment || 1}-${(run.firstSegment || 1) + run.segmentCount - 1} of ${run.totalSegments || "?"}`
      : ` · ${run.segmentCount} segments`;
  const stars = run.rating ? ` · ${"★".repeat(run.rating)}` : "";
  return `${new Date(run.createdAt).toLocaleString()} · ${engineInfo(run.engine).short} · ${quality}${range}${stars}${run.note ? ` · ${run.note}` : ""}`;
}

// Picks a finished take of another story in the same project (for its last frame, or to join with). `prefer` is the
// story code to open first (e.g. the one before or after this story), else the nearest one.
export function TakePicker({
  currentStoryId,
  projectId,
  prefer,
  title,
  hint,
  confirmLabel,
  busy,
  includeCurrent,
  extra,
  onPick,
  onClose,
}: {
  currentStoryId: string;
  projectId: string;
  prefer: number;
  title: string;
  hint: string;
  confirmLabel: string;
  busy: boolean;
  includeCurrent?: boolean;
  extra?: ReactNode;
  onPick: (take: PickedTake) => void;
  onClose: () => void;
}) {
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const [storyId, setStoryId] = useState("");
  const [story, setStory] = useState<Story | null>(null);
  const [runId, setRunId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let stopped = false;
    fetch("/api/stories")
      .then((response) => response.json())
      .then((data: { stories?: StorySummary[] }) => {
        if (stopped) return;
        const list = (data.stories || [])
          .filter((item) => item.projectId === projectId && (includeCurrent || item.id !== currentStoryId))
          .sort((a, b) => Number(a.code) - Number(b.code));
        setStories(list);
        const first =
          list.find((item) => Number(item.code) === prefer) ||
          [...list].sort((a, b) => Math.abs(Number(a.code) - prefer) - Math.abs(Number(b.code) - prefer))[0];
        setStoryId(first?.id || "");
      })
      .catch(() => !stopped && setError("Could not load the stories."));
    return () => {
      stopped = true;
    };
  }, [currentStoryId, projectId, prefer, includeCurrent]);

  useEffect(() => {
    if (!storyId) return;
    let stopped = false;
    fetch(`/api/stories/${storyId}`)
      .then((response) => response.json())
      .then((data: { story?: Story }) => {
        if (stopped || !data.story) return;
        setStory(data.story);
        const done = data.story.videos.filter((run) => run.status === "done" && run.video);
        // A take that runs to the story's last segment first (its last frame is where the story ends), then the
        // highest rated, then the newest.
        const toEnd = (run: VideoRun) =>
          !run.totalSegments || (run.firstSegment || 1) + run.segmentCount - 1 >= run.totalSegments ? 1 : 0;
        const best = [...done].sort(
          (a, b) => toEnd(b) - toEnd(a) || (b.rating || 0) - (a.rating || 0) || b.createdAt.localeCompare(a.createdAt),
        )[0];
        setRunId(best?.id || "");
      })
      .catch(() => !stopped && setError("Could not load that story."));
    return () => {
      stopped = true;
    };
  }, [storyId]);

  const takes = useMemo(
    () =>
      (story?.id === storyId ? story.videos : [])
        .filter((run): run is PickedTake["run"] => run.status === "done" && Boolean(run.video))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [story, storyId],
  );
  const take = takes.find((run) => run.id === runId);

  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-card p-5 text-sm"
      >
        <h2 className="mb-1 text-base font-medium">{title}</h2>
        <p className="mb-4 text-xs text-muted">{hint}</p>
        {error && <p className="mb-3 text-xs text-red-300">{error}</p>}
        {stories === null ? (
          <p className="text-xs text-muted">Loading stories…</p>
        ) : stories.length === 0 ? (
          <p className="text-xs text-muted">No other story in this project.</p>
        ) : (
          <>
            <label className="mb-3 flex flex-col gap-1 text-xs text-muted">
              Story
              <select
                value={storyId}
                onChange={(event) => {
                  setStoryId(event.target.value);
                  setRunId("");
                }}
                className="rounded-md border border-line bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {stories.map((item) => (
                  <option key={item.id} value={item.id}>
                    #{item.code} {item.title}
                    {item.id === currentStoryId ? " (this story)" : ""}
                    {item.archived ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {story?.id !== storyId ? (
              <p className="text-xs text-muted">Loading its videos…</p>
            ) : takes.length === 0 ? (
              <p className="text-xs text-amber-300">That story has no finished video yet.</p>
            ) : (
              <>
                <label className="mb-3 flex flex-col gap-1 text-xs text-muted">
                  Take
                  <select
                    value={runId}
                    onChange={(event) => setRunId(event.target.value)}
                    className="rounded-md border border-line bg-background px-2 py-1.5 text-sm text-foreground"
                  >
                    {takes.map((run) => (
                      <option key={run.id} value={run.id}>
                        {takeLabel(run)}
                      </option>
                    ))}
                  </select>
                </label>
                {take && (
                  // Opens near the end, so the frame that would be used is in view.
                  <video
                    key={take.id}
                    src={viewSrc(take.video)}
                    controls
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const element = event.currentTarget;
                      if (Number.isFinite(element.duration)) element.currentTime = Math.max(0, element.duration - 0.05);
                    }}
                    className="mb-3 max-h-64 w-full rounded-lg border border-line bg-black"
                  />
                )}
              </>
            )}
          </>
        )}
        {extra}
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:text-foreground">
            Cancel
          </button>
          <button
            type="button"
            disabled={!take || !story || busy}
            onClick={() => take && story && onPick({ story, run: take })}
            className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-ink disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
