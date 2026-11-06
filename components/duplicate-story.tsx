"use client";

import { useState } from "react";
import { IconButton, Icons } from "@/components/icons";
import { stepLabel, storySteps, type StoryStep, type StoryType } from "@/lib/types";

const KEEPS: Partial<Record<StoryStep, string>> = {
  gist: "the gist and its analysis",
  cast: "+ characters and location",
  image: "+ image prompt and reference images",
  frames: "+ frames",
  prompts: "+ prompt sets (no videos)",
  video: "+ its videos (same video files)",
};

// Duplicate with a choice of how far the copy goes: everything up to the chosen step, later steps start empty.
export function DuplicateStory({
  storyType,
  imported,
  onDuplicate,
}: {
  storyType: StoryType;
  imported: boolean;
  onDuplicate: (upTo: StoryStep) => void;
}) {
  const steps = imported ? (["video"] as StoryStep[]) : storySteps({ imported: null, storyType }).filter((step) => step !== "export");
  const [open, setOpen] = useState(false);
  const [upTo, setUpTo] = useState<StoryStep>(imported ? "video" : "prompts");
  if (!open) {
    return (
      <IconButton label="Duplicate…" onClick={() => setOpen(true)}>
        {Icons.copy}
      </IconButton>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 rounded-full border border-accent/60 px-3 py-1 text-xs text-muted">
      Copy up to
      <select
        value={upTo}
        onChange={(event) => setUpTo(event.target.value as StoryStep)}
        aria-label="Copy the story up to this step"
        className="rounded-md border border-line bg-background px-2 py-1 text-foreground"
      >
        {steps.map((step) => (
          <option key={step} value={step}>
            {stepLabel(step)}: {step === "image" && !steps.includes("cast") ? "+ characters, image prompt and reference images" : KEEPS[step]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          onDuplicate(upTo);
        }}
        className="rounded-full bg-accent px-3 py-1 font-medium text-accent-ink"
      >
        Copy
      </button>
      <button type="button" onClick={() => setOpen(false)} className="px-1 hover:text-foreground">
        Cancel
      </button>
    </span>
  );
}
