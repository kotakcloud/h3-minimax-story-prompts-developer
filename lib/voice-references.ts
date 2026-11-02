import { parseDialogue } from "./dialogue";
import type { Character } from "./types";

// Render tests on one story (docs/RESEARCH_voice_references.md): long samples leak their words into the speech, and
// references on a continuing segment garble it, so samples stay short and every segment starts fresh.
export const VOICE_SAMPLE_MAX_SECONDS = 4;
export const VOICE_SAMPLE_MIN_SECONDS = 1;
export const VOICE_SAMPLE_DEFAULT_SECONDS = 3.5;

export type VoiceSample = {
  // The character's id, which is their speaker id in the prompts (S1, S2).
  speaker: string;
  filename: string;
  subfolder: string;
  seconds: number;
};

export type VoiceReference = VoiceSample & { name: string };

// In the cast's order, which is the <Audio N> order. Samples of removed characters are left out.
export function voiceReferences(voices: VoiceSample[], characters: Character[]): VoiceReference[] {
  return characters.flatMap((character) => {
    const voice = voices.find((item) => item.speaker === character.id);
    return voice ? [{ ...voice, name: character.name }] : [];
  });
}

// Only who speaks in this prompt: a silent segment given a sample speaks that sample's words.
export function voicesInSegment(prompt: string, voices: VoiceReference[]): VoiceReference[] {
  const speakers = new Set(parseDialogue(prompt).flatMap((line) => line.speakers));
  return voices.filter((voice) => speakers.has(voice.speaker));
}

function subjectLabel(prompt: string, voice: VoiceReference): string {
  const speaker = `(${voice.speaker})`;
  const escapedName = voice.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const number =
    prompt.match(new RegExp(`<Subject (\\d+)> \\(${voice.speaker}\\)`))?.[1] ||
    prompt.match(new RegExp(`<Subject (\\d+)> is ${escapedName}\\b`))?.[1];
  return number ? `<Subject ${number}> ${speaker}` : speaker;
}

// Adds the references to a six-section prompt at queue time; the saved prompt stays as written.
export function withVoiceReferences(prompt: string, voices: VoiceReference[]): string {
  if (voices.length === 0) return prompt;
  const labels = voices.map((_, index) => `<Audio ${index + 1}>`);
  const defined = voices
    .map((voice, index) => {
      const label = labels[index];
      return `${label} is the voice-timbre reference for ${subjectLabel(prompt, voice)}, used for voice timbre only; the words spoken in ${label} are never repeated.`;
    })
    .join("\n");
  const retained = labels
    .map((label) => `${label}: reference - the target speaker follows ${label}'s voice timbre and measured delivery without copying the original signal.`)
    .join("\n");
  const rule = `All speech uses only the exact words inside the <d> tags; no word from ${labels.join(" or ")} is spoken. `;

  const sections: [RegExp, (found: string) => string][] = [
    [/\n\s*summary:/, (found) => `\n${defined}${found}`],
    [/\n\s*detailed_description:/, (found) => `\n${retained}${found}`],
    [/overall_soundscape:\s*\n/, (found) => `${found}${rule}`],
  ];
  return sections.reduce((text, [pattern, replace]) => {
    if (!pattern.test(text)) {
      throw new Error("Voice references need prompts in the six-section H3 format.");
    }
    return text.replace(pattern, replace);
  }, prompt.replace("[reference generation]", "[reference generation + audio reference]"));
}
