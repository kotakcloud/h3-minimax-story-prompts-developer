// Spoken lines read straight from a written H3 prompt (<d>[Language] words</d>), no AI involved.

const WORDS_PER_SECOND = 2.2;
// H3 starts about 0.5 s late, lines run long and must end 1.5 s before the clip ends, plus a short lead-in.
const SILENCE_SECONDS = 2.5;
// H3 clips are 4–15 s.
export const MAX_CLIP_SECONDS = 15;

export type DialogueLine = {
  // Speaker ids as written, e.g. ["S1"] or ["S1", "S2"] for unison; empty when the prompt names none.
  speakers: string[];
  language: string;
  text: string;
  // What the line needs at a natural pace.
  estimate: number;
  // Long-take prompts only: when the prompt says the line starts and finishes, in seconds.
  start?: number;
  end?: number;
};

const LINE = /<d>\s*(?:\[([^\]]*)\]\s*)?([\s\S]*?)\s*<\/d>/g;
const SPEAKERS = /\((S\d+(?:\s*,\s*S\d+)*)\)/g;
const TIME = /\b(\d{2}):(\d{2}(?:\.\d{1,3})?)\b/g;
const FINISHED_BY = /\bby (\d{2}):(\d{2}(?:\.\d{1,3})?)\b/;
// Quoted lines in a frame summary or beat ('…', "…", ‘…’, “…”), the outer quote only.
const QUOTED = /(?:^|[\s:(])(['"‘“])(.+?)(?:\1|[’”])(?=[\s.,!?;)]|$)/g;

function seconds(minutes: string, rest: string): number {
  return Number(minutes) * 60 + Number(rest);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function spokenSeconds(text: string): number {
  return Math.round((wordCount(text) / WORDS_PER_SECOND) * 10) / 10;
}

// Words spoken in a frame summary or beat.
export function quotedWords(text: string): number {
  return wordCount([...text.matchAll(QUOTED)].map((match) => match[2]).join(" "));
}

// A frame's length, raised so the lines in its summary fit (the clip limit still applies).
export function fitDuration(duration: number, summary: string): number {
  return Math.max(duration, Math.min(MAX_CLIP_SECONDS, clipSecondsForWords(quotedWords(summary))));
}

// The clip length spoken words need, silence included.
export function clipSecondsForWords(words: number): number {
  return words > 0 ? Math.ceil(words / WORDS_PER_SECOND + SILENCE_SECONDS) : 0;
}

export function clipSecondsNeeded(lines: DialogueLine[]): number {
  return clipSecondsForWords(lines.reduce((sum, line) => sum + wordCount(line.text), 0));
}

export function parseDialogue(prompt: string): DialogueLine[] {
  const lines: DialogueLine[] = [];
  let previousEnd = 0;
  for (const match of prompt.matchAll(LINE)) {
    const index = match.index;
    const before = prompt.slice(previousEnd, index);
    const lineEnd = prompt.indexOf("\n", index + match[0].length);
    const after = prompt.slice(index + match[0].length, lineEnd < 0 ? undefined : lineEnd);
    previousEnd = index + match[0].length;

    const speaker = [...before.slice(-300).matchAll(SPEAKERS)].at(-1)?.[1];
    // Timing lives on the prompt line of the speech: "At 00:01.800: …" or "00:01.800-00:03.400: …".
    const times = [...before.slice(before.lastIndexOf("\n") + 1).matchAll(TIME)];
    const finished = after.match(FINISHED_BY);
    const end = finished ? seconds(finished[1], finished[2]) : times[1] ? seconds(times[1][1], times[1][2]) : undefined;
    const text = match[2];
    lines.push({
      speakers: speaker ? speaker.split(",").map((id) => id.trim()) : [],
      language: match[1]?.trim() || "",
      text,
      estimate: spokenSeconds(text),
      ...(times[0] ? { start: seconds(times[0][1], times[0][2]) } : {}),
      ...(end !== undefined ? { end } : {}),
    });
  }
  return lines;
}

// Timed prompts: lines that, spoken at a natural pace from their start, run past the prompt's last timestamp. H3 cuts
// these off (a slot shorter than the estimate alone is fine: H3 speaks on past it).
export function cutOffLines(prompt: string): (DialogueLine & { clipEnd: number })[] {
  const clipEnd = Math.max(0, ...[...prompt.matchAll(TIME)].map((match) => seconds(match[1], match[2])));
  return parseDialogue(prompt)
    .filter((line) => line.start !== undefined && line.start + line.estimate > clipEnd)
    .map((line) => ({ ...line, clipEnd }));
}

// Whether a segment's dialogue does not fit. Timed prompts say when lines start; otherwise only the word count is known.
export function isTight(segment: { duration: number; prompt: string }): boolean {
  const lines = parseDialogue(segment.prompt);
  return lines.some((line) => line.start !== undefined)
    ? cutOffLines(segment.prompt).length > 0
    : clipSecondsNeeded(lines) > segment.duration;
}

// Segments whose dialogue does not fit, with the length they should have.
export function timingFixes(segments: { id: string; duration: number; prompt: string }[]): { id: string; duration: number }[] {
  return segments.filter(isTight).map((segment) => ({
    id: segment.id,
    duration: Math.max(segment.duration, Math.min(MAX_CLIP_SECONDS, clipSecondsNeeded(parseDialogue(segment.prompt)))),
  }));
}

// The update comment for timed prompts: the lengths and each line's minimum, worked out here.
export function timingComment(segments: { id: string; duration: number; prompt: string }[]): string {
  return [
    "Give every spoken line enough time, nothing else changes. Keep every word of the dialogue, the speakers and the actions.",
    ...segments.map((segment) => {
      const lines = parseDialogue(segment.prompt).map((line) => `[${line.text}] at least ${line.estimate} s`);
      return `Segment ${segment.id} lasts ${segment.duration} s. Re-time all its beats to fill that length. From start to finishes-by: ${lines.join("; ")}.`;
    }),
    "Shorten the silent beats between lines where needed, and keep the quiet ending.",
  ].join("\n");
}
