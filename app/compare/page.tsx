"use client";

import { useEffect, useState } from "react";
import { Row, visibleRows } from "@/components/prompt-diff";
import { diffTexts } from "@/lib/prompt-diff";

// The two texts stay in this browser between visits.
const TEXTS_KEY = "h3-compare-texts";

type Result = ReturnType<typeof diffTexts>;

// Two big text boxes; Compare shows them side by side with changed lines and words marked, as the prompt diff does.
export default function ComparePage() {
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TEXTS_KEY) || "null");
      if (saved && typeof saved.left === "string" && typeof saved.right === "string") {
        setLeft(saved.left);
        setRight(saved.right);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(TEXTS_KEY, JSON.stringify({ left, right }));
    } catch {}
  }, [left, right]);

  const compare = () => {
    setResult(diffTexts(left, right));
    requestAnimationFrame(() => document.getElementById("compare-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const box =
    "h-[calc(100vh-14rem)] min-h-64 w-full resize-y rounded-xl border border-line bg-card p-3 font-mono text-xs leading-5 text-foreground outline-none focus:border-accent";

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Compare text</h1>
          <p className="text-xs text-muted">Paste two texts. Compare marks the lines and words that differ (blank lines are ignored).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setLeft(right);
              setRight(left);
              setResult(null);
            }}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-foreground hover:border-accent"
          >
            Swap
          </button>
          <button
            type="button"
            onClick={() => {
              setLeft("");
              setRight("");
              setResult(null);
            }}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-muted hover:text-foreground"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={compare}
            disabled={!left.trim() && !right.trim()}
            className="rounded-full bg-accent px-5 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50"
          >
            Compare
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Left (older)</span>
          <textarea value={left} onChange={(event) => setLeft(event.target.value)} spellCheck={false} className={box} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Right (newer)</span>
          <textarea value={right} onChange={(event) => setRight(event.target.value)} spellCheck={false} className={box} />
        </label>
      </div>

      {result && (
        <section id="compare-result" className="mt-6 scroll-mt-20 rounded-2xl border border-line bg-card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              {result.added + result.removed + result.updated === 0
                ? "No differences"
                : `${result.added} added · ${result.removed} removed · ${result.updated} updated`}
            </p>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              Show unchanged lines
            </label>
          </div>
          <div className="mb-1 grid grid-cols-2 gap-x-2 text-xs font-medium text-foreground">
            <span>Left</span>
            <span>Right</span>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
            {visibleRows(result.rows, showAll).map((item, index) =>
              "row" in item ? (
                <Row key={index} row={item.row} />
              ) : (
                <p key={index} className="col-span-2 py-1 text-center text-xs text-muted">
                  {item.hidden} unchanged {item.hidden === 1 ? "line" : "lines"}
                </p>
              ),
            )}
          </div>
        </section>
      )}
    </main>
  );
}
