import type { Frame, StoryAnalysis } from "./types";

// H3 clips are 4–15 s.
const MIN_SECONDS = 4;
const MAX_SECONDS = 15;

// Quoted lines in a beat ('…', "…", ‘…’, “…”), the outer quote only.
const QUOTED = /(?:^|[\s:(])(['"‘“])(.+?)(?:\1|[’”])(?=[\s.,!?;)]|$)/g;

// Seconds a beat's spoken words need: H3 starts about 0.5 s late, lines run long and must end
// 1.5 s before the clip ends, so ~2.2 words per second plus 2.5 s.
function speechSeconds(content: string): number {
  const words = [...content.matchAll(QUOTED)]
    .map((match) => match[2])
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
  return words > 0 ? Math.ceil(words / 2.2 + 2.5) : 0;
}

type Group = { beats: StoryAnalysis["beats"]; seconds: number };

// Frames straight from the analysis beat plan, without the Frames AI call: one frame per beat,
// a beat shorter than 4 s merged into its neighbour, each frame long enough for its lines.
export function framesFromAnalysis(analysis: StoryAnalysis | null | undefined): Frame[] {
  const beats = (analysis?.beats || []).filter((beat) => beat && beat.content?.trim());
  const groups: Group[] = [];
  for (const beat of beats) {
    const seconds = Math.max(1, Math.round(Number(beat.seconds) || MIN_SECONDS), speechSeconds(beat.content));
    const last = groups[groups.length - 1];
    // Fold a short beat (a pause, a reaction) into the frame before it while that frame has room.
    if (last && seconds < MIN_SECONDS && last.seconds + seconds <= MAX_SECONDS) {
      last.beats.push(beat);
      last.seconds += seconds;
    } else {
      groups.push({ beats: [beat], seconds });
    }
  }
  // A short first beat joins the next frame instead.
  if (groups.length > 1 && groups[0].seconds < MIN_SECONDS && groups[0].seconds + groups[1].seconds <= MAX_SECONDS) {
    const [first, second] = groups;
    groups.splice(0, 2, { beats: [...first.beats, ...second.beats], seconds: first.seconds + second.seconds });
  }

  return groups.map((group, index) => ({
    id: `f${index + 1}`,
    title: group.beats.map((beat) => beat.purpose || "beat").join(" + "),
    summary: group.beats
      .map((beat) => `${beat.delivery ? `[${beat.delivery}] ` : ""}${beat.content.trim()}`)
      .join(" Then: "),
    duration: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, group.seconds)),
  }));
}
