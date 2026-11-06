import type { Story } from "./types";

// Renumbering the characters (S1, S2…) without the AI: every "S<n>" in the frames and the analysis is swapped in one
// pass, so S1 <-> S2 swaps do not collide. S<n> is <Subject n> in the prompts, so the current prompts were written for the
// old numbers and are cleared (earlier prompt sets stay).

export const CHARACTER_ID = /^S([1-9]\d?)$/;

// Problems with the new ids, or [] when they can be used.
export function characterIdProblems(ids: string[]): string[] {
  const out: string[] = [];
  const bad = ids.filter((id) => !CHARACTER_ID.test(id));
  if (bad.length) out.push(`Use S followed by a number (S1 to S99), not ${bad.map((id) => `"${id || "(blank)"}"`).join(", ")}.`);
  const seen = new Set<string>();
  const twice = [...new Set(ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false))))];
  if (twice.length) out.push(`Each character needs its own number: ${twice.join(", ")} is used twice.`);
  return out;
}

function swap(text: string, map: Map<string, string>): string {
  return text.replace(/\bS([1-9]\d?)\b/g, (match) => map.get(match) ?? match);
}

function swapDeep<T>(value: T, map: Map<string, string>): T {
  if (typeof value === "string") return swap(value, map) as T;
  if (Array.isArray(value)) return value.map((item) => swapDeep(item, map)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swapDeep(item, map)])) as T;
  }
  return value;
}

// The story fields to change for new ids (old id -> new id), or null when nothing changes.
export function renumberCharacters(story: Story, next: Record<string, string>): Partial<Story> | null {
  const map = new Map(Object.entries(next).filter(([from, to]) => from !== to));
  if (map.size === 0) return null;
  const number = (id: string) => Number(CHARACTER_ID.exec(id)?.[1] ?? 999);
  return {
    characters: story.characters
      .map((character) => ({ ...character, id: map.get(character.id) ?? character.id }))
      .sort((a, b) => number(a.id) - number(b.id)),
    frames: story.frames.map((frame) => ({ ...frame, title: swap(frame.title, map), summary: swap(frame.summary, map) })),
    analysis: story.analysis ? swapDeep(story.analysis, map) : story.analysis,
    frameInstructions: swap(story.frameInstructions, map),
    segments: [],
  };
}
