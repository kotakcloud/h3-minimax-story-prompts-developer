"use client";

import { useEffect, useMemo, useState } from "react";
import { diffPromptSets, diffWords, type DiffRow, type SetDiff, type WordPart } from "@/lib/prompt-diff";
import type { Frame, PromptSegment } from "@/lib/types";

// How many unchanged lines stay visible around a change.
const CONTEXT_LINES = 1;

type Props = {
  older: PromptSegment[];
  newer: PromptSegment[];
  olderLabel: string;
  newerLabel: string;
  frames: Frame[];
};

function summary(diff: SetDiff) {
  if (diff.added + diff.removed + diff.updated === 0) return "no line changes";
  return `${diff.added} added · ${diff.removed} removed · ${diff.updated} updated`;
}

// A link saying what changed between two prompt sets; it opens the side-by-side view.
export function PromptDiffLink(props: Props) {
  const { older, newer, olderLabel } = props;
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => diffPromptSets(older, newer), [older, newer]);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-accent underline underline-offset-2 hover:opacity-80">
        vs {olderLabel}: {summary(diff)}
      </button>
      {open && <PromptDiffDialog {...props} diff={diff} onClose={() => setOpen(false)} />}
    </>
  );
}

function Words({ parts, tint }: { parts: WordPart[]; tint: string }) {
  return parts.map((part, index) =>
    part.changed ? (
      <mark key={index} className={`rounded-sm text-inherit ${tint}`}>
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

function Row({ row }: { row: DiffRow }) {
  const words = useMemo(() => (row.kind === "updated" ? diffWords(row.left || "", row.right || "") : null), [row]);
  const cell = "min-w-0 whitespace-pre-wrap break-words rounded px-2 py-1 font-mono text-xs leading-5";
  const removed = row.kind === "removed" || row.kind === "updated";
  const added = row.kind === "added" || row.kind === "updated";
  return (
    <>
      <div className={`${cell} ${row.left === undefined ? "bg-background/40" : removed ? "bg-red-500/10 text-foreground" : "text-muted"}`}>
        {words ? <Words parts={words.left} tint="bg-red-500/40" /> : row.left}
      </div>
      <div className={`${cell} ${row.right === undefined ? "bg-background/40" : added ? "bg-emerald-500/10 text-foreground" : "text-muted"}`}>
        {words ? <Words parts={words.right} tint="bg-emerald-500/40" /> : row.right}
      </div>
    </>
  );
}

// Changed rows with a little context; long unchanged stretches fold into one note.
function visibleRows(rows: DiffRow[], showAll: boolean) {
  const keep = rows.map(
    (_row, index) =>
      showAll || rows.slice(Math.max(0, index - CONTEXT_LINES), index + CONTEXT_LINES + 1).some((row) => row.kind !== "same"),
  );
  const out: ({ row: DiffRow } | { hidden: number })[] = [];
  rows.forEach((row, index) => {
    const last = out[out.length - 1];
    if (keep[index]) out.push({ row });
    else if (last && "hidden" in last) last.hidden += 1;
    else out.push({ hidden: 1 });
  });
  return out;
}

function PromptDiffDialog({ diff, olderLabel, newerLabel, frames, onClose }: Props & { diff: SetDiff; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 pb-16" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Prompt changes, ${olderLabel} to ${newerLabel}`}
        className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-line bg-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted">
              {olderLabel} → {newerLabel}
            </h2>
            <p className="mt-1 text-xs text-muted">{summary(diff)}</p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              Show unchanged lines
            </label>
            <button type="button" onClick={onClose} className="rounded-full border border-line px-4 py-1.5 text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4">
          <div className="sticky -top-4 z-10 -mx-4 mb-3 grid grid-cols-2 gap-x-2 bg-card px-4 py-2 text-xs font-medium text-foreground">
            <span>{olderLabel}</span>
            <span>{newerLabel}</span>
          </div>
          <div className="space-y-5">
            {diff.segments.map((segment, index) => {
              const title = frames.find((frame) => frame.id === segment.id)?.title || segment.id;
              const changed = segment.added + segment.removed + segment.updated > 0;
              const seconds =
                segment.leftDuration === segment.rightDuration
                  ? `${segment.rightDuration}s`
                  : `${segment.leftDuration ?? "new"}${segment.leftDuration === undefined ? "" : "s"} → ${segment.rightDuration ?? "removed"}${segment.rightDuration === undefined ? "" : "s"}`;
              return (
                <section key={segment.id}>
                  <p className="mb-1 text-sm font-medium">
                    {index + 1}. {title} <span className="text-xs font-normal text-muted">· {seconds}</span>
                    <span className="ml-2 text-xs font-normal text-muted">
                      {changed ? `${segment.added} added · ${segment.removed} removed · ${segment.updated} updated` : "unchanged"}
                    </span>
                  </p>
                  {(changed || showAll) && (
                    <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                      {visibleRows(segment.rows, showAll).map((item, rowIndex) =>
                        "row" in item ? (
                          <Row key={rowIndex} row={item.row} />
                        ) : (
                          <p key={rowIndex} className="col-span-2 py-1 text-center text-xs text-muted">
                            {item.hidden} unchanged {item.hidden === 1 ? "line" : "lines"}
                          </p>
                        ),
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
