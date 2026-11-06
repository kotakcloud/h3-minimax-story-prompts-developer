"use client";

import { Money } from "@/components/money";
import type { Project, StorySummary } from "@/lib/types";

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} d ago` : new Date(iso).toLocaleDateString();
}

// One project in the project list: its stories, what their AI calls cost, when one last changed, and its shared setup
// (character cards, video seed).
export function ProjectCard({
  project,
  stories,
  active,
  onOpen,
}: {
  project: Project;
  stories: StorySummary[];
  active: boolean;
  onOpen: () => void;
}) {
  const live = stories.filter((story) => !story.archived);
  const cost = stories.reduce((sum, story) => sum + (story.aiCostUsd ?? 0), 0);
  const videos = stories.filter((story) => story.latestVideo).length;
  const latest = stories.reduce((max, story) => (story.updatedAt > max ? story.updatedAt : max), "");
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={active}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active ? "border-accent bg-card ring-1 ring-accent/40" : "border-line bg-card/50 hover:border-foreground/30"
      }`}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-sm font-medium ${active ? "text-foreground" : "text-foreground/90"}`}>{project.name}</span>
        {project.archived && <span className="shrink-0 text-[11px] text-amber-300">archived</span>}
      </span>
      <span className="mt-1 block text-xs text-muted">
        {live.length} {live.length === 1 ? "story" : "stories"}
        {stories.length > live.length && ` (+${stories.length - live.length} archived)`}
        {videos > 0 && ` · ${videos} with video`}
      </span>
      <span className="mt-0.5 block text-xs text-muted">
        AI cost <Money usd={cost} />
        {latest && ` · ${ago(latest)}`}
      </span>
      {(project.characters?.length || project.videoSeed !== undefined) && (
        <span className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] text-muted">
          {project.characters?.length ? (
            <span className="rounded-full border border-line px-2 py-0.5">{project.characters.length} characters</span>
          ) : null}
          {project.videoSeed !== undefined && (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono">seed {project.videoSeed}</span>
          )}
        </span>
      )}
    </button>
  );
}
