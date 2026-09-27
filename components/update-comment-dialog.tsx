"use client";

import { useEffect, useState } from "react";
import { diffLines, type DiffLine } from "@/lib/line-diff";
import type { PromptSegment } from "@/lib/types";

function PromptDiffColumn({ label, lines }: { label: string; lines: DiffLine[] }) {
  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wider text-muted">{label}</p>
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5">
        {lines.map((line, index) => (
          <div
            key={`${label}-${index}`}
            className={
              line.type === "add"
                ? "bg-emerald-950/50 text-emerald-200"
                : line.type === "del"
                  ? "bg-red-950/50 text-red-300"
                  : "text-muted"
            }
          >
            {line.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

type TargetOption = {
  id: string;
  number: number;
  title: string;
};

type PreviewRow = {
  id: string;
  number: number;
  title: string;
  before: string;
  after: string;
};

export function UpdateCommentDialog({
  open,
  segments,
  options,
  busy,
  onClose,
  onPreview,
  onApply,
}: {
  open: boolean;
  segments: PromptSegment[];
  options: TargetOption[];
  busy: boolean;
  onClose: () => void;
  onPreview: (comment: string, ids: string[]) => Promise<PromptSegment[]>;
  onApply: (updated: PromptSegment[]) => Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [previews, setPreviews] = useState<PreviewRow[]>([]);
  const [proposed, setProposed] = useState<PromptSegment[]>([]);

  useEffect(() => {
    if (!open) return;
    setComment("");
    setSelected(segments.map((segment) => segment.id));
    setAccepted([]);
    setPreviews([]);
    setProposed([]);
    // Reset only when the dialog opens, not when the story updates behind it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
    setAccepted([]);
    setPreviews([]);
    setProposed([]);
  }

  function toggleAccepted(id: string) {
    setAccepted((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function preview() {
    const updated = await onPreview(comment.trim(), selected);
    const byId = new Map(updated.map((segment) => [segment.id, segment]));
    const rows = options
      .filter((option) => selected.includes(option.id))
      .map((option) => ({
        id: option.id,
        number: option.number,
        title: option.title,
        before: segments.find((segment) => segment.id === option.id)?.prompt || "",
        after: byId.get(option.id)?.prompt || "",
      }));
    setProposed(updated);
    setPreviews(rows);
    setAccepted(rows.map((row) => row.id));
  }

  const showingDiffs = previews.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
      <button
        type="button"
        className="absolute inset-0 cursor-pointer"
        aria-label="Close dialog"
        disabled={busy}
        onClick={onClose}
      />
      <div className="relative flex max-h-full w-full max-w-4xl flex-col rounded-2xl border border-line bg-card p-5 shadow-xl">
        <h3 className="text-lg font-medium">Update with comment</h3>
        <p className="mt-1 text-sm text-muted">
          Describe the change, pick prompt numbers, preview the before/after diffs, then apply
          only the prompts you keep checked.
        </p>
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <label className="block text-xs uppercase tracking-wider text-muted">
            Comment
            <textarea
              value={comment}
              onChange={(event) => {
                setComment(event.target.value);
                setAccepted([]);
                setPreviews([]);
                setProposed([]);
              }}
              rows={4}
              placeholder="Change the bakery from night to late afternoon. Keep Mira and Jon the same."
              className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-accent"
            />
          </label>
          <fieldset>
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
          {showingDiffs && (
            <div className="space-y-4">
              <p className="text-xs uppercase tracking-wider text-muted">
                Apply these prompts
              </p>
              {previews.map((previewRow) => {
                const lines = diffLines(previewRow.before, previewRow.after);
                const included = accepted.includes(previewRow.id);
                return (
                  <article
                    key={previewRow.id}
                    className={`rounded-xl border bg-background p-3 ${
                      included ? "border-line" : "border-line/60 opacity-60"
                    }`}
                  >
                    <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleAccepted(previewRow.id)}
                        className="cursor-pointer accent-accent"
                      />
                      <span>
                        Prompt {previewRow.number}. {previewRow.title}
                      </span>
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <PromptDiffColumn
                        label="Before"
                        lines={lines.filter((line) => line.type !== "add")}
                      />
                      <PromptDiffColumn
                        label="After"
                        lines={lines.filter((line) => line.type !== "del")}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
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
            onClick={() => {
              void preview().catch(() => undefined);
            }}
            className="rounded-full border border-line px-4 py-2 text-sm"
          >
            {busy && !showingDiffs ? "Generating preview…" : "Preview diffs"}
          </button>
          <button
            type="button"
            disabled={busy || !showingDiffs || accepted.length === 0}
            onClick={() => {
              void onApply(proposed.filter((segment) => accepted.includes(segment.id)));
            }}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            {busy && showingDiffs ? "Saving…" : "Apply update"}
          </button>
        </div>
      </div>
    </div>
  );
}
