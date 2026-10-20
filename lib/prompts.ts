import { readFile } from "node:fs/promises";
import path from "node:path";

export { promptTimestamps } from "./types";

export async function readPrompt(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

// System prompt plus the shared story-format catalogue.
export async function readPromptWithFormats(relativePath: string): Promise<string> {
  const [system, formats] = await Promise.all([readPrompt(relativePath), readPrompt("prompts/story-formats.md")]);
  return `${system}\n\n---\n\nSTORY FORMATS (shared reference):\n\n${formats}`;
}

// Compact text block describing the analysis for later steps.
export function analysisBlock(analysis: unknown): string {
  if (!analysis || typeof analysis !== "object") return "";
  const a = analysis as Record<string, unknown>;
  const beats = Array.isArray(a.beats) ? a.beats : [];
  return [
    `FORMAT: ${a.format} — ${a.formatReason || ""}`,
    `PAYOFF: ${a.payoff || ""}`,
    `TONE: ${a.tone || ""}`,
    a.narrator ? "NARRATOR: yes — an off-screen voiceover speaks the narration lines." : "NARRATOR: no",
    a.sensitivity ? `SENSITIVITY: ${a.sensitivity}` : "",
    `BEAT PLAN:\n${JSON.stringify(beats, null, 2)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// H3 renders written words as distorted pseudo-letters, so prompts must never ask for them.
const ON_SCREEN_TEXT = [
  /\b(?:thought|speech|dialogue|text)[ -]?(?:bubble|balloon|cloud)s?\b/gi,
  /\b(?:captions?|subtitles?|title cards?|text overlays?|on-?screen (?:text|words))\b/gi,
  /\bwith the (?:text|words)\b/gi,
  /\b(?:text|words|letters) (?:appears?|pops? up|floats?|is written|are written)\b/gi,
  /\b(?:signs?|banners?|posters?|labels?|notes?|boards?|screens?) (?:that )?(?:reads?|reading|says|saying|showing the words)\b/gi,
  // H3 renders anything inside double quotes as on-screen text.
  /["“”][^"“”\n]{1,80}["“”]/g,
];

export function onScreenTextMentions(prompt: string): string[] {
  const hits = ON_SCREEN_TEXT.flatMap((pattern) => prompt.match(pattern) || []);
  return [...new Set(hits.map((hit) => hit.toLowerCase()))];
}

export function onScreenTextFix(hits: string[]): string {
  return [
    `CORRECTION: your previous answer asked H3 to show written text (${hits.join(", ")}). H3 draws it as distorted letters.`,
    "Rewrite it with no written words anywhere, no double quotes anywhere (spoken words only inside <d>), and without mentioning text, bubbles or captions at all.",
    "A thought becomes the character's off-screen inner voice in their own voice (lips closed, face showing the thought) with the usual timing rules; anything else meant to be read is shown through action, reaction or voiceover.",
  ].join(" ");
}

export function timestampFix(hits: string[]): string {
  return [
    `CORRECTION: your previous answer used timestamps (${hits.slice(0, 6).join(", ")}). Story V2 prompts have no timestamps at all.`,
    "Rewrite it with no timestamps, time ranges, seconds or durations anywhere; order the beats with words (first, then, as …, finally) inside one continuous take with no cuts.",
  ].join(" ");
}

// <Subject N> labels used after subject_definitions without being defined there. In V2 a
// subject not in the shot is left out entirely; naming it makes H3 draw it anyway.
export function undefinedSubjects(prompt: string): string[] {
  const [definitions, ...rest] = prompt.split(/\n\s*summary:/);
  const defined = new Set(definitions.match(/<Subject \d+>/g) || []);
  return [...new Set(rest.join("\n").match(/<Subject \d+>/g) || [])].filter((label) => !defined.has(label));
}

export function undefinedSubjectsFix(labels: string[]): string {
  return [
    `CORRECTION: your previous answer names ${labels.join(", ")} without defining them in subject_definitions.`,
    "A subject who is not in this segment's shot is left out of the prompt entirely: never mention them anywhere, not even as off-frame, just panned away from, or absent. If they ARE visible, define them in subject_definitions and retention_analysis instead.",
  ].join(" ");
}

export const CONTINUOUS_OPENER =
  "The video opens already in progress, continuing the exact same shot from the previous segment: same people, same place, same light, same camera framing.";

// A continuous V2 segment must not cut: without this opener a cut was seen at ~20 s.
export function ensureContinuousOpener(prompt: string): string {
  if (/already in progress/i.test(prompt)) return prompt;
  if (prompt.includes("[Shot 1]")) return prompt.replace("[Shot 1]", `[Shot 1] ${CONTINUOUS_OPENER}`);
  return prompt.replace(/detailed_description:\n/, (match) => `${match}${CONTINUOUS_OPENER} `);
}
