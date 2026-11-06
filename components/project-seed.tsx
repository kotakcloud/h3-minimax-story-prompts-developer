"use client";

import { useState } from "react";
import type { Project } from "@/lib/types";

// A project's video seed: new stories in the project start with it (each story can still change its own on the Video
// step). "Apply to all stories" gives it to the stories already in the project.
export function ProjectSeed({
  project,
  storyCount,
  onSave,
  onApply,
}: {
  project: Project;
  storyCount: number;
  onSave: (seed: number | null) => Promise<void>;
  onApply: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = project.videoSeed;

  const commit = async (text: string) => {
    setDraft(null);
    const trimmed = text.trim();
    const seed = trimmed === "" ? null : Number(trimmed);
    if (seed !== null && !(Number.isSafeInteger(seed) && seed >= 0)) {
      setError("A whole number of 0 or more.");
      return;
    }
    setError("");
    if ((seed ?? undefined) === saved) return;
    setBusy(true);
    try {
      await onSave(seed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
      <label className="flex items-center gap-2" title="New stories in this project start with this video seed; each story can still change its own">
        Video seed
        <input
          type="text"
          inputMode="numeric"
          value={draft ?? (saved !== undefined ? String(saved) : "")}
          placeholder="none (random per story)"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => draft !== null && void commit(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(null);
          }}
          disabled={busy}
          className="w-48 rounded-md border border-line bg-background px-2 py-1 font-mono text-foreground outline-none focus:border-accent"
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void commit(String(Math.floor(Math.random() * 2 ** 48)))}
        className="rounded-full border border-line px-3 py-1 text-foreground disabled:opacity-50"
      >
        New seed
      </button>
      {saved !== undefined && storyCount > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            if (!window.confirm(`Give all ${storyCount} stories of ${project.name} the video seed ${saved}?`)) return;
            setBusy(true);
            try {
              await onApply();
            } finally {
              setBusy(false);
            }
          }}
          title="Every story of this project gets this seed for its next videos (videos already made keep theirs)"
          className="rounded-full border border-line px-3 py-1 text-foreground hover:border-accent disabled:opacity-50"
        >
          Apply to all {storyCount} stories
        </button>
      )}
      {error && <span className="text-red-300">{error}</span>}
    </div>
  );
}
