import { NextResponse } from "next/server";
import { fitDuration, quotedLines } from "@/lib/dialogue";
import { parseModelChain } from "@/lib/models";
import { chatJson } from "@/lib/openrouter";
import { clampDuration } from "@/lib/parse";
import { analysisBlock, readPrompt } from "@/lib/prompts";
import type { Character, Frame } from "@/lib/types";

type Part = { title: string; summary: string; duration: number };

function asParts(data: unknown): Part[] {
  const rows = data && typeof data === "object" && Array.isArray((data as { frames?: unknown }).frames) ? (data as { frames: unknown[] }).frames : [];
  return rows.map((row, index) => {
    const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const summary = typeof item.summary === "string" ? item.summary.trim() : "";
    return {
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : `Part ${index + 1}`,
      summary,
      duration: fitDuration(clampDuration(item.duration, 6), summary),
    };
  });
}

// The words of a frame's spoken lines in order, without punctuation (a line cut in two may gain or lose a comma or
// dots at the cut).
function spokenWords(lines: string[]): string[] {
  return lines
    .join(" ")
    .split(/\s+/)
    .map((word) => word.replace(/[\p{P}\p{S}]/gu, ""))
    .filter(Boolean);
}

// What the parts got wrong: a different number of parts, or spoken lines lost, repeated or reordered. With the dialogue
// split on, a line may be cut into pieces across parts, so the words are compared instead of whole lines.
function problems(parts: Part[], original: string, wanted: number | null, splitDialogue = false): string[] {
  const out: string[] = [];
  if (wanted ? parts.length !== wanted : parts.length < 2 || parts.length > 4) {
    out.push(`return ${wanted ?? "2 to 4"} frames, not ${parts.length}`);
  }
  if (parts.some((part) => !part.summary)) out.push("every frame needs a summary");
  if (splitDialogue) {
    const before = spokenWords(quotedLines(original));
    const after = spokenWords(parts.flatMap((part) => quotedLines(part.summary)));
    if (before.join(" ") !== after.join(" ")) {
      const first = before.findIndex((word, index) => word !== after[index]);
      out.push(
        `the spoken words must stay exactly the same, each once, in order (they differ from word ${first + 1}: ` +
          `expected "${before.slice(Math.max(0, first), first + 6).join(" ")}", got "${after.slice(Math.max(0, first), first + 6).join(" ")}")`,
      );
    }
    return out;
  }
  const squeeze = (lines: string[]) => lines.map((line) => line.replace(/\s+/g, " ").trim());
  const before = squeeze(quotedLines(original));
  const after = squeeze(parts.flatMap((part) => quotedLines(part.summary)));
  if (before.join("\n") !== after.join("\n")) {
    const missing = before.filter((line) => !after.includes(line));
    out.push(
      missing.length
        ? `these spoken lines are missing or changed: ${missing.map((line) => `[${line}]`).join(" ")}`
        : "the spoken lines must appear exactly once each, in the original order",
    );
  }
  return out;
}

// POST — one frame split into consecutive frames by the AI; the app checks that every spoken line survived.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      frame?: Frame;
      frames?: Frame[];
      characters?: Character[];
      gist?: string;
      analysis?: unknown;
      parts?: number;
      model?: string;
      // Long spoken lines may be cut between the new frames.
      splitDialogue?: boolean;
    };
    const chain = parseModelChain(body.model);
    if (chain.error) return NextResponse.json({ error: chain.error }, { status: 400 });
    const frame = body.frame;
    if (!frame?.summary?.trim()) return NextResponse.json({ error: "This frame has no summary to split." }, { status: 400 });
    const splitDialogue = body.splitDialogue === true;
    const wanted = Number(body.parts) >= 2 && Number(body.parts) <= 4 ? Math.round(Number(body.parts)) : null;

    const analysis = analysisBlock(body.analysis);
    const user = [
      `PARTS: ${wanted ?? "auto"}`,
      "",
      `FRAME TO SPLIT:\n${JSON.stringify({ title: frame.title, summary: frame.summary, duration: frame.duration }, null, 2)}`,
      "",
      `ALL FRAMES (context only, in order):\n${JSON.stringify((body.frames || []).map(({ id, title, summary }) => ({ id, title, summary })), null, 2)}`,
      "",
      `CHARACTERS:\n${JSON.stringify(body.characters || [], null, 2)}`,
      "",
      `GIST:\n${body.gist?.trim() || "(not provided)"}`,
      ...(analysis ? ["", `STORY ANALYSIS:\n${analysis}`] : []),
      ...(splitDialogue
        ? [
            "",
            "SPLIT THE DIALOGUE: yes. This replaces the rule that every spoken line goes whole into one frame:",
            "- You may cut a long spoken line into consecutive pieces across frames, at a natural break: the end of a sentence, a comma, a breath or a beat. Never cut inside a word or a short phrase.",
            "- Each piece is quoted on its own, said by the same speaker in the same way (on-screen or voiceover, tone), and the frame says it continues the same line.",
            "- Every word of the frame's speech appears exactly once across the frames, word for word, in the original order. Never translate, shorten, reword, drop or add words.",
            "- Use the cuts to spread the speech so each frame's speech fits its duration and each frame has its own dominant action or reaction.",
          ]
        : []),
    ].join("\n");
    const system = await readPrompt("prompts/frame-split-system.md");

    let parts = asParts(await chatJson(system, user, { maxTokens: 4000, models: chain.models }));
    let issues = problems(parts, frame.summary, wanted, splitDialogue);
    if (issues.length) {
      console.log(`[frames/split] ${frame.id}: ${issues.join("; ")}; asking again`);
      const fix = `CORRECTION: your previous answer was wrong: ${issues.join("; ")}. Answer again with every ${
        splitDialogue ? "spoken word" : "spoken line"
      } of the frame exactly once, word for word, in order.`;
      parts = asParts(await chatJson(system, `${user}\n\n${fix}`, { maxTokens: 4000, models: chain.models }));
      issues = problems(parts, frame.summary, wanted, splitDialogue);
      if (issues.length) {
        return NextResponse.json({ error: `The split did not keep the frame intact (${issues.join("; ")}). Try again.` }, { status: 502 });
      }
    }
    return NextResponse.json({ frames: parts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not split the frame.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
