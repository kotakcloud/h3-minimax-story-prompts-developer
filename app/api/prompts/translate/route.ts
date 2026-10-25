import { NextResponse } from "next/server";
import { parseModelChain } from "@/lib/models";
import { chatJson } from "@/lib/openrouter";

export const maxDuration = 180;

// Spoken lines in H3 prompts: <d>[Language] words</d>.
const LINE = /<d>\[([^\]]+)\]\s*([\s\S]*?)<\/d>/g;

const SYSTEM = `You translate the spoken lines of a short video into another language. The lines are dialogue,
narration or a character's inner voice, and will be spoken aloud by an AI video model with lip-sync.

Return ONLY one JSON object: {"lines": ["translation 1", "translation 2", ...]} with exactly one translation per input
line, in the same order. No markdown fences. No commentary.

Rules:
- Natural, everyday spoken language as a native speaker would say it in this scene, not a word-for-word translation.
- Keep the meaning, the emotion and roughly the same length (the line must still fit the same seconds).
- Write in the language's own script (for example Gujarati script for Gujarati).
- Keep names, and keep interjections or laughs (Ha ha, Oh) where the original has them.
- Never use double quotes or angle brackets.`;

// Copies prompts with only their spoken lines translated: the shots, camera and panels stay identical.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      segments?: { id?: string; duration?: number; prompt?: string; panel?: number; join?: string }[];
      language?: string;
      model?: string;
      context?: string;
    };
    const chain = parseModelChain(body.model);
    if (chain.error) {
      return NextResponse.json({ error: chain.error }, { status: 400 });
    }
    const language = String(body.language || "").trim();
    if (!/^[\p{L} ()-]{2,40}$/u.test(language)) {
      return NextResponse.json({ error: "Name the language, e.g. Gujarati." }, { status: 400 });
    }
    const segments = (Array.isArray(body.segments) ? body.segments : []).filter((segment) => segment.prompt);
    if (segments.length === 0) {
      return NextResponse.json({ error: "There are no prompts to translate." }, { status: 400 });
    }

    const originals = segments.flatMap((segment) => [...String(segment.prompt).matchAll(LINE)].map((match) => match[2].trim()));
    let translated: string[] = [];
    if (originals.length > 0) {
      const user = [
        `Translate these ${originals.length} spoken lines into ${language}.`,
        ...(body.context?.trim() ? ["", `STORY (context only):\n${body.context.trim().slice(0, 3000)}`] : []),
        "",
        `LINES:\n${JSON.stringify(originals, null, 2)}`,
      ].join("\n");
      const data = (await chatJson(SYSTEM, user, { maxTokens: 4000, models: chain.models })) as { lines?: unknown };
      translated = Array.isArray(data?.lines) ? data.lines.map((line) => String(line ?? "").replace(/["<>]/g, "").trim()) : [];
      if (translated.length !== originals.length || translated.some((line) => !line)) {
        throw new Error("The translation came back incomplete. Try again.");
      }
    }

    let next = 0;
    const out = segments.map((segment) => ({
      ...segment,
      prompt: String(segment.prompt).replace(LINE, () => `<d>[${language}] ${translated[next++]}</d>`),
    }));
    return NextResponse.json({ segments: out, lines: originals.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Translation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
