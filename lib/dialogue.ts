// Spoken lines read straight from a written H3 prompt (<d>[Language] words</d>), no AI involved.

const WORDS_PER_SECOND = 2.2;
// H3 starts about 0.5 s late, lines run long and must end 1.5 s before the clip ends, plus a short lead-in.
const SILENCE_SECONDS = 2.5;
// H3 clips are 4–15 s.
export const MAX_CLIP_SECONDS = 15;
const MIN_CLIP_SECONDS = 4;

export type DialogueLine = {
  // Speaker ids as written, e.g. ["S1"] or ["S1", "S2"] for unison; empty when the prompt names none.
  speakers: string[];
  language: string;
  text: string;
  // What the line needs at a natural pace.
  estimate: number;
  // The prompt has this voice come from off screen (an inner voice does not count: nobody's lips move).
  offScreen: boolean;
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

function toSeconds(minutes: string, rest: string): number {
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

// Lines quoted in a frame summary that a written prompt left out.
export function missingLines(summary: string, prompt: string): string[] {
  const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
  const written = parseDialogue(prompt).map((line) => squeeze(line.text));
  return [...summary.matchAll(QUOTED)].map((match) => squeeze(match[2])).filter((line) => !written.includes(line));
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
    const lead = before.slice(-200);
    // Timing lives on the prompt line of the speech: "At 00:01.800: …" or "00:01.800-00:03.400: …".
    const times = [...before.slice(before.lastIndexOf("\n") + 1).matchAll(TIME)];
    const finished = after.match(FINISHED_BY);
    const end = finished ? toSeconds(finished[1], finished[2]) : times[1] ? toSeconds(times[1][1], times[1][2]) : undefined;
    const text = match[2];
    lines.push({
      speakers: speaker ? speaker.split(",").map((id) => id.trim()) : [],
      offScreen: /off[- ]?screen/i.test(lead) && !/inner voice/i.test(lead),
      language: match[1]?.trim() || "",
      text,
      estimate: spokenSeconds(text),
      ...(times[0] ? { start: toSeconds(times[0][1], times[0][2]) } : {}),
      ...(end !== undefined ? { end } : {}),
    });
  }
  return lines;
}

// Timed prompts: lines that, spoken at a natural pace from their start, run past the prompt's last timestamp. H3 cuts
// these off (a slot shorter than the estimate alone is fine: H3 speaks on past it).
export function cutOffLines(prompt: string): (DialogueLine & { clipEnd: number })[] {
  const clipEnd = Math.max(0, ...[...prompt.matchAll(TIME)].map((match) => toSeconds(match[1], match[2])));
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

// Why a prompt would put a line in the wrong mouth: H3 moves the mouth of whoever is on screen. Voice-only characters are
// meant to be unseen, and nobody's lips move for them.
export function speakerProblems(prompt: string, voiceOnly: string[] = []): string[] {
  const lines = parseDialogue(prompt);
  const seen = lines.filter((line) => line.speakers.some((id) => !voiceOnly.includes(id)));
  const speakers = new Set(seen.flatMap((line) => line.speakers));
  const timeline = prompt.split(/detailed_description:/i)[1]?.split(/overall_soundscape:/i)[0] || "";
  const problems: string[] = [];
  if (speakers.size > 1 && /\[Shot [2-9]\]|camera cuts to/i.test(timeline)) problems.push("the camera cuts between speakers");
  if (speakers.size > 1 && /close-?up/i.test(timeline)) problems.push("a close-up leaves a speaker out of frame");
  if (seen.some((line) => line.offScreen)) problems.push("a character speaks off-screen");
  if (lines.some((line) => line.speakers.length === 0)) problems.push("a line has no speaker label");
  return problems;
}

function formatTime(value: number): string {
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${(value - minutes * 60).toFixed(3).padStart(6, "0")}`;
}

export type LineDuration = { segmentId: string; lineIndex: number; seconds: number };

// Gives a timed line a new length without AI: the line keeps its start, everything after it moves by the difference, and
// the segment grows or shrinks to match. Throws when the result does not fit in one clip.
export function retimeLine(segment: { id: string; duration: number; prompt: string }, lineIndex: number, seconds: number) {
  const line = parseDialogue(segment.prompt)[lineIndex];
  if (line?.start === undefined || line.end === undefined) throw new Error(`Segment ${segment.id}: this line has no times to change.`);
  const { start, end } = line;
  const close = (a: number, b: number) => Math.abs(a - b) < 0.0005;
  const newEnd = start + seconds;
  const delta = newEnd - end;
  const times = [...segment.prompt.matchAll(TIME)].map((match) => toSeconds(match[1], match[2]));
  const clipEnd = Math.max(...times);
  // Continuation segments run from 0.92 s: the clip ends at duration + 0.92 in their timestamps.
  const offset = clipEnd - segment.duration;
  const duration = Math.max(MIN_CLIP_SECONDS, Math.ceil(clipEnd + delta - offset - 0.0005));
  const fitted = Math.min(MAX_CLIP_SECONDS, duration);
  const newClipEnd = offset + fitted;
  const moved = (time: number) => {
    if (close(time, end)) return newEnd;
    if (close(time, clipEnd)) return newClipEnd;
    return time < end ? time : time + delta;
  };
  const beats = times.filter((time) => !close(time, clipEnd)).map(moved);
  if (newEnd > newClipEnd || Math.max(0, ...beats) >= newClipEnd) {
    throw new Error(`Segment ${segment.id}: these lines need more than ${MAX_CLIP_SECONDS} s, so they do not fit in one clip.`);
  }
  return {
    duration: fitted,
    prompt: segment.prompt.replace(TIME, (_match, minutes: string, rest: string) => formatTime(moved(toSeconds(minutes, rest)))),
  };
}

// Applies typed line lengths to a prompt set, later lines first so earlier ones still read their own times.
export function applyLineDurations<T extends { id: string; duration: number; prompt: string }>(segments: T[], edits: LineDuration[]): T[] {
  return segments.map((segment) =>
    edits
      .filter((edit) => edit.segmentId === segment.id)
      .sort((a, b) => b.lineIndex - a.lineIndex)
      .reduce((current, edit) => ({ ...current, ...retimeLine(current, edit.lineIndex, edit.seconds) }), segment),
  );
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
