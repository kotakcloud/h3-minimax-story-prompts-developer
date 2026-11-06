"use client";

import { useState } from "react";

// A seconds box that keeps what is typed as text and only reads it as a number when you leave the box or press Enter
// (a number input fought every keystroke: "12" became 4 after the "1"). Out-of-range values are clamped then; text
// that is not a number goes back to the saved value.
export function DurationInput({
  value,
  min,
  max,
  onCommit,
  className = "",
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (seconds: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const seconds = Number(draft.trim().replace(",", "."));
    setDraft(null);
    if (!draft.trim() || !Number.isFinite(seconds)) return;
    const next = Math.min(max, Math.max(min, Math.round(seconds)));
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? String(value)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      title={`Seconds, ${min} to ${max}; applied when you leave the box or press Enter`}
      className={`w-20 rounded-md border border-line bg-background px-2 py-1 text-foreground ${className}`}
    />
  );
}
