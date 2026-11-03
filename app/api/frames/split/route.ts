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

// What the parts got wrong: a different number of parts, or spoken lines lost, repeated or reordered.
function problems(parts: Part[], original: string, wanted: number | null): string[] {
  const out: string[] = [];
  if (wanted ? parts.length !== wanted : parts.length < 2 || parts.length > 4) {
    out.push(`return ${wanted ?? "2 to 4"} frames, not ${parts.length}`);
  }
  if (parts.some((part) => !part.summary)) out.push("every frame needs a summary");
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
    };
    const chain = parseModelChain(body.model);
    if (chain.error) return NextResponse.json({ error: chain.error }, { status: 400 });
    const frame = body.frame;
    if (!frame?.summary?.trim()) return NextResponse.json({ error: "This frame has no summary to split." }, { status: 400 });
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
    ].join("\n");
    const system = await readPrompt("prompts/frame-split-system.md");

    let parts = asParts(await chatJson(system, user, { maxTokens: 4000, models: chain.models }));
    let issues = problems(parts, frame.summary, wanted);
    if (issues.length) {
      console.log(`[frames/split] ${frame.id}: ${issues.join("; ")}; asking again`);
      const fix = `CORRECTION: your previous answer was wrong: ${issues.join("; ")}. Answer again with every spoken line of the frame exactly once, word for word, in order.`;
      parts = asParts(await chatJson(system, `${user}\n\n${fix}`, { maxTokens: 4000, models: chain.models }));
      issues = problems(parts, frame.summary, wanted);
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
