"use client";

import { useState } from "react";

// "3-6" → segments 3 to 6; "4" → only 4; "3-" → 3 to the end; "-4" → 1 to 4. Null when it cannot be read.
export function parseSegmentRange(text: string, count: number): { from: number; to: number } | null {
  const value = text.trim().replace(/\s*(–|—|to)\s*/gi, "-");
  const match = value.match(/^(\d*)\s*(-?)\s*(\d*)$/);
  if (!match || (!match[1] && !match[3])) return null;
  const from = match[1] ? Number(match[1]) : 1;
  const to = match[3] ? Number(match[3]) : match[2] ? count : from;
  const clamp = (n: number) => Math.min(Math.max(1, n), Math.max(1, count));
  const a = clamp(from);
  const b = clamp(to);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

// A text box for a segment range, read when you leave it or press Enter (Escape goes back).
export function SegmentRangeInput({
  from,
  to,
  count,
  disabled,
  onCommit,
}: {
  from: number;
  to: number;
  count: number;
  disabled?: boolean;
  onCommit: (range: { from: number; to: number }) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = from === to ? String(from) : `${from}-${to}`;
  const commit = () => {
    if (draft === null) return;
    const range = parseSegmentRange(draft, count);
    setDraft(null);
    if (range && (range.from !== from || range.to !== to)) onCommit(range);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      value={disabled ? "" : (draft ?? shown)}
      placeholder="all"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      title={`Segments to render, e.g. 3-6 (of ${count}); 4 = only segment 4. Applied when you leave the box or press Enter.`}
      className="w-20 rounded-md border border-line bg-background px-2 py-1 text-foreground disabled:opacity-50"
    />
  );
}
