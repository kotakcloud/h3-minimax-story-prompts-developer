// Spoken lines read straight from a written H3 prompt (<d>[Language] words</d>), no AI involved.

import type { Frame } from "./types";

const WORDS_PER_SECOND = 2.2;
// H3 starts about 0.5 s late, lines run long and must end 1.5 s before the clip ends, plus a short lead-in.
const SILENCE_SECONDS = 2.5;
// H3 clips are 4–15 s.
export const MAX_CLIP_SECONDS = 15;
const MIN_CLIP_SECONDS = 4;
// H3 spreads speech over the clip and leaves about a second between phrases (text between , . ! ?), so length comes from
// phrases, not words. Measured: dialogue ran to the very end of 85% of 14-16 s clips, and of only 3 in 26 clips with 4 s or
// more per phrase. Segment 4 of a test story was cut off at 15 s, timed or not, and split in two; three 12 s clips of about
// 3 phrases each all ended 2-4 s early.
const SECONDS_PER_PHRASE = 4;
const MAX_PHRASES_PER_CLIP = 3;
export const MAX_DIALOGUE_CLIP_SECONDS = SECONDS_PER_PHRASE * MAX_PHRASES_PER_CLIP + 1;

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

function phraseCount(text: string): number {
  return text.split(/[,.!?।]+/).filter((part) => part.trim()).length;
}

// The clip length spoken text needs.
export function clipSecondsForText(texts: string[]): number {
  const phrases = texts.reduce((sum, text) => sum + phraseCount(text), 0);
  const words = texts.reduce((sum, text) => sum + wordCount(text), 0);
  return words > 0 ? Math.max(phrases * SECONDS_PER_PHRASE, Math.ceil(words / WORDS_PER_SECOND + SILENCE_SECONDS)) : 0;
}

// The text quoted in a frame summary or beat.
export function quotedLines(text: string): string[] {
  return [...text.matchAll(QUOTED)].map((match) => match[2]);
}

// Lines quoted in a frame summary that a written prompt left out.
export function missingLines(summary: string, prompt: string): string[] {
  const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();
  const written = parseDialogue(prompt).map((line) => squeeze(line.text));
  return [...summary.matchAll(QUOTED)].map((match) => squeeze(match[2])).filter((line) => !written.includes(line));
}

// A frame's length, raised so the lines in its summary fit (the clip limit still applies).
export function fitDuration(duration: number, summary: string): number {
  return Math.max(duration, Math.min(MAX_DIALOGUE_CLIP_SECONDS, clipSecondsForText(quotedLines(summary))));
}

export function clipSecondsNeeded(lines: DialogueLine[]): number {
  return clipSecondsForText(lines.map((line) => line.text));
}

// Whether a frame holds more speech than one clip can finish.
export function isDenseFrame(frame: Pick<Frame, "summary">): boolean {
  return clipSecondsForText(quotedLines(frame.summary)) > MAX_DIALOGUE_CLIP_SECONDS;
}

function sentences(line: string): string[] {
  return line.match(/[^.!?।]+[.!?।]*\s*/g)?.map((part) => part.trim()).filter(Boolean) || [line];
}

// One dense frame as several, in order, broken at sentence ends. Each part repeats the words that introduce its speaker,
// so a line carried over still says who speaks. No AI involved.
function splitDenseFrame(frame: Frame, nextId: () => string): Frame[] {
  const quotes = [...frame.summary.matchAll(QUOTED)];
  const parts: { text: string; phrases: number; lines: string[] }[] = [];
  const add = (lead: string, spoken: string, phrases: number) => {
    const last = parts[parts.length - 1];
    const fresh = !last || last.phrases + phrases > MAX_PHRASES_PER_CLIP;
    if (fresh) parts.push({ text: "", phrases: 0, lines: [] });
    const part = parts[parts.length - 1];
    part.text += `${part.text ? " " : ""}${lead}${lead ? " " : ""}'${spoken}'`;
    part.phrases += phrases;
    part.lines.push(spoken);
  };
  let position = 0;
  for (const quote of quotes) {
    const open = quote.index + quote[0].indexOf(quote[1]);
    const lead = frame.summary.slice(position, open).trim();
    position = open + quote[1].length + quote[2].length + 1;
    // Only the sentence naming the speaker is repeated on a later part.
    const speaker = lead.split(/(?<=[.!?])\s+/).at(-1) || "";
    let first = true;
    let group: string[] = [];
    const flush = () => {
      if (group.length === 0) return;
      add(first ? lead : speaker, group.join(" "), phraseCount(group.join(" ")));
      first = false;
      group = [];
    };
    for (const sentence of sentences(quote[2])) {
      if (group.length > 0 && phraseCount([...group, sentence].join(" ")) > MAX_PHRASES_PER_CLIP) flush();
      group.push(sentence);
    }
    flush();
  }
  const closing = frame.summary.slice(position).trim();
  if (parts.length < 2) return [frame];
  if (closing) parts[parts.length - 1].text += ` ${closing}`;
  return parts.map((part, index) => ({
    ...frame,
    id: index === 0 ? frame.id : nextId(),
    title: `${frame.title} (${index + 1}/${parts.length})`,
    summary: part.text,
    duration: Math.max(frame.duration && parts.length === 1 ? frame.duration : MIN_CLIP_SECONDS, Math.min(MAX_DIALOGUE_CLIP_SECONDS, clipSecondsForText(part.lines))),
    // Later parts continue the take, whatever joined the first one to the frame before.
    ...(index > 0 ? { join: "continuous" as const } : {}),
  }));
}

// Dense frames split so each clip can finish its speech. New frames get fresh ids, in order after the frame they came from.
export function splitDenseFrames(frames: Frame[]): Frame[] {
  let highest = Math.max(0, ...frames.map((frame) => Number(frame.id.replace(/\D/g, "")) || 0));
  return frames.flatMap((frame) => (isDenseFrame(frame) ? splitDenseFrame(frame, () => `f${++highest}`) : [frame]));
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

// Whether a segment's dialogue does not fit. Times in the prompt are no guide: H3 hardly follows them.
export function isTight(segment: { duration: number; prompt: string }): boolean {
  return clipSecondsNeeded(parseDialogue(segment.prompt)) > segment.duration;
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
// the segment grows or shrinks to match; at 15 s it cannot grow, so the quiet ending gives up the time. Throws when the
// result does not fit in one clip. This only edits the prompt: renders of sets differing only in these times, same seed,
// ended their speech at the same moment.
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
  return segments.flatMap((segment) => {
    const duration = Math.min(MAX_DIALOGUE_CLIP_SECONDS, clipSecondsNeeded(parseDialogue(segment.prompt)));
    return duration > segment.duration ? [{ id: segment.id, duration }] : [];
  });
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
