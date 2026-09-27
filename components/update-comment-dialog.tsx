"use client";

import { useEffect, useState } from "react";
import type { PromptSegment } from "@/lib/types";

type TargetOption = {
  id: string;
  number: number;
  title: string;
};

export function UpdateCommentDialog({
  open,
  segments,
  options,
  busy,
  onClose,
  onApply,
}: {
  open: boolean;
  segments: PromptSegment[];
  options: TargetOption[];
  busy: boolean;
  onClose: () => void;
  onApply: (comment: string, ids: string[]) => void;
}) {
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setComment("");
    setSelected(segments.map((segment) => segment.id));
  }, [open, segments]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose, open]);

  if (!open) return null;

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div className="relative w-full max-w-lg rounded-2xl border border-line bg-card p-5 shadow-xl">
        <h3 className="text-lg font-medium">Update with comment</h3>
        <p className="mt-1 text-sm text-muted">
          Describe the change, pick which prompt numbers it should hit, then apply once.
        </p>
        <label className="mt-4 block text-xs uppercase tracking-wider text-muted">
          Comment
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={5}
            placeholder="Change the bakery from night to late afternoon. Keep Mira and Jon the same."
            className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-accent"
          />
        </label>
        <fieldset className="mt-4">
          <legend className="text-xs uppercase tracking-wider text-muted">Target prompt numbers</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {options.map((option) => (
              <label key={option.id} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  onChange={() => toggle(option.id)}
                  className="cursor-pointer accent-accent"
                />
                <span>
                  {option.number}. {option.title}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full border border-line px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !comment.trim() || selected.length === 0}
            onClick={() => onApply(comment.trim(), selected)}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            {busy ? "Updating…" : "Apply update"}
          </button>
        </div>
      </div>
    </div>
  );
}
