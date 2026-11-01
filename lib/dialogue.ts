// Spoken lines read straight from a written H3 prompt (<d>[Language] words</d>), no AI involved.

const WORDS_PER_SECOND = 2.2;
// H3 starts about 0.5 s late, lines run long and must end 1.5 s before the clip ends, plus a short lead-in.
const SILENCE_SECONDS = 2.5;

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

function seconds(minutes: string, rest: string): number {
  return Number(minutes) * 60 + Number(rest);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function spokenSeconds(text: string): number {
  return Math.round((wordCount(text) / WORDS_PER_SECOND) * 10) / 10;
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
