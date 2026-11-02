import type { PromptSegment } from "./types";

// Line diff between two prompt sets, no AI involved. Segments are matched by id; blank lines are ignored.

export type DiffRow = { kind: "same" | "added" | "removed" | "updated"; left?: string; right?: string };
export type DiffCounts = { added: number; removed: number; updated: number };
export type SegmentDiff = DiffCounts & { id: string; leftDuration?: number; rightDuration?: number; rows: DiffRow[] };
export type SetDiff = DiffCounts & { segments: SegmentDiff[] };
export type WordPart = { text: string; changed: boolean };

// Keeps the table small enough for the browser; longer lines are simply marked as changed whole.
const MAX_WORD_CELLS = 4_000_000;

// Longest common subsequence, as index pairs in order.
function matches<T>(a: T[], b: T[]): [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

function promptLines(prompt: string | undefined): string[] {
  return (prompt || "").split(/\r?\n/).filter((line) => line.trim());
}

function diffLines(left: string[], right: string[]): DiffRow[] {
  const rows: DiffRow[] = [];
  // Between two matches, lines on both sides are one line edited; what is left over was added or removed.
  const gap = (fromLeft: number, toLeft: number, fromRight: number, toRight: number) => {
    const paired = Math.min(toLeft - fromLeft, toRight - fromRight);
    for (let k = 0; k < paired; k++) rows.push({ kind: "updated", left: left[fromLeft + k], right: right[fromRight + k] });
    for (let k = fromLeft + paired; k < toLeft; k++) rows.push({ kind: "removed", left: left[k] });
    for (let k = fromRight + paired; k < toRight; k++) rows.push({ kind: "added", right: right[k] });
  };
  let i = 0;
  let j = 0;
  for (const [a, b] of matches(left, right)) {
    gap(i, a, j, b);
    rows.push({ kind: "same", left: left[a], right: right[b] });
    i = a + 1;
    j = b + 1;
  }
  gap(i, left.length, j, right.length);
  return rows;
}

export function diffPromptSets(older: PromptSegment[], newer: PromptSegment[]): SetDiff {
  const ids = [...new Set([...newer.map((segment) => segment.id), ...older.map((segment) => segment.id)])];
  const segments = ids.map((id) => {
    const left = older.find((segment) => segment.id === id);
    const right = newer.find((segment) => segment.id === id);
    const rows = diffLines(promptLines(left?.prompt), promptLines(right?.prompt));
    const count = (kind: DiffRow["kind"]) => rows.filter((row) => row.kind === kind).length;
    return {
      id,
      leftDuration: left?.duration,
      rightDuration: right?.duration,
      rows,
      added: count("added"),
      removed: count("removed"),
      updated: count("updated"),
    };
  });
  const total = (key: keyof DiffCounts) => segments.reduce((sum, segment) => sum + segment[key], 0);
  return { segments, added: total("added"), removed: total("removed"), updated: total("updated") };
}

// The words that differ inside an updated line, for highlighting.
export function diffWords(left: string, right: string): { left: WordPart[]; right: WordPart[] } {
  const a = left.split(/(\s+)/);
  const b = right.split(/(\s+)/);
  if (a.length * b.length > MAX_WORD_CELLS) {
    return { left: [{ text: left, changed: true }], right: [{ text: right, changed: true }] };
  }
  const pairs = matches(a, b);
  const parts = (words: string[], kept: Set<number>) => {
    const out: WordPart[] = [];
    words.forEach((text, index) => {
      const changed = !kept.has(index) && text.trim() !== "";
      const last = out[out.length - 1];
      if (last && last.changed === changed) last.text += text;
      else out.push({ text, changed });
    });
    return out;
  };
  return { left: parts(a, new Set(pairs.map((pair) => pair[0]))), right: parts(b, new Set(pairs.map((pair) => pair[1]))) };
}
