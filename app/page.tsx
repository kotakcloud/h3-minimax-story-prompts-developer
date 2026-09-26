"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StorySummary } from "@/lib/types";
import { storyPath } from "@/lib/types";

function stepLabel(step: StorySummary["step"]) {
  if (step === "gist") return "Gist";
  if (step === "frames") return "Frames";
  return "Prompts";
}

export default function Home() {
  const router = useRouter();
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const response = await fetch("/api/stories");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load stories.");
    setStories(data.stories || []);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load stories."));
  }, []);

  async function createStory() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/stories", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a story.");
      router.push(storyPath(data.story.id, "gist"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a story.");
      setBusy(false);
    }
  }

  async function removeStory(id: string) {
    if (!window.confirm("Delete this story from this machine?")) return;
    const response = await fetch(`/api/stories/${id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not delete story.");
      return;
    }
    setStories((current) => current.filter((story) => story.id !== id));
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-10 sm:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-accent">MiniMax H3</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Stories</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Each story is saved on this machine. Open one, or open several in new tabs.
          </p>
        </div>
        <button
          type="button"
          onClick={createStory}
          disabled={busy}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          {busy ? "Creating…" : "New story"}
        </button>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {stories.length === 0 ? (
        <p className="text-sm text-muted">No stories yet. Create one to start a gist.</p>
      ) : (
        <ul className="space-y-3">
          {stories.map((story) => (
            <li
              key={story.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-4"
            >
              <div className="min-w-0">
                <Link href={storyPath(story.id, story.step)} className="block truncate text-base font-medium">
                  {story.title}
                </Link>
                <p className="mt-1 font-mono text-xs text-muted">
                  {story.id} · {stepLabel(story.step)} · {story.frameCount} frames · {story.segmentCount} prompts
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Link
                  href={storyPath(story.id, story.step)}
                  className="rounded-full bg-foreground px-3 py-1 text-background"
                >
                  Open
                </Link>
                <a
                  href={storyPath(story.id, story.step)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-line px-3 py-1"
                >
                  New tab
                </a>
                <button type="button" onClick={() => removeStory(story.id)} className="px-2 text-muted">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
