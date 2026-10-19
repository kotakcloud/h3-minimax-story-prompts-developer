import { readFile } from "node:fs/promises";
import path from "node:path";

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
