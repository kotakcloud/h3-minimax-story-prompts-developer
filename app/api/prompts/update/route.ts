import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { clampDuration } from "@/lib/parse";
import { analysisBlock, onScreenTextFix, onScreenTextMentions, readPrompt } from "@/lib/prompts";
import type { Character, Frame, PromptSegment } from "@/lib/types";

export const maxDuration = 300;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

type Target = {
  id: string;
  number: number;
  duration: number;
  prompt: string;
  title: string;
  summary: string;
};

function normalize(data: unknown, targets: Target[]): PromptSegment[] {
  if (!data || typeof data !== "object") {
    throw new Error("Update result was not an object.");
  }
  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw.segments) ? raw.segments : [];
  const byId = new Map(
    rows.map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return [asString(row.id), row];
    }),
  );

  return targets.map((target, index) => {
    const row = byId.get(target.id) ?? rows[index];
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const prompt = asString(record.prompt);
    if (!prompt) {
      throw new Error(`Missing updated prompt for ${target.id}.`);
    }
    return {
      id: target.id,
      duration: clampDuration(record.duration, target.duration),
      prompt,
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gist?: string;
      title?: string;
      comment?: string;
      characters?: Character[];
      frames?: Frame[];
      targets?: Target[];
      reference?: boolean;
      analysis?: unknown;
    };

    const comment = body.comment?.trim();
    const targets = Array.isArray(body.targets) ? body.targets.filter((item) => item?.id && item.prompt) : [];
    if (!comment) {
      return NextResponse.json({ error: "Type a comment describing the update." }, { status: 400 });
    }
    if (targets.length === 0) {
      return NextResponse.json({ error: "Select at least one prompt number." }, { status: 400 });
    }

    const system = await readPrompt(
      body.reference === true ? "prompts/h3-ref2va-update.md" : "prompts/h3-t2va-update.md",
    );
    const user = [
      "Apply this update to every listed target prompt in one pass.",
      "",
      `UPDATE COMMENT:\n${comment}`,
      "",
      `TARGET NUMBERS: ${targets.map((target) => target.number).join(", ")}`,
      "",
      `STORY TITLE: ${body.title?.trim() || "Untitled story"}`,
      "",
      `ORIGINAL GIST:\n${body.gist?.trim() || "(not provided)"}`,
      "",
      `CHARACTER LOCK:\n${JSON.stringify(body.characters || [], null, 2)}`,
      ...(analysisBlock(body.analysis) ? ["", `STORY ANALYSIS:\n${analysisBlock(body.analysis)}`] : []),
      "",
      `FRAMES:\n${JSON.stringify(body.frames || [], null, 2)}`,
      "",
      `TARGET PROMPTS:\n${JSON.stringify(targets, null, 2)}`,
    ].join("\n");

    let segments = normalize(await chatJson(system, user, { maxTokens: 16000 }), targets);
    // One retry when an updated prompt still asks H3 to draw text (thought bubbles, captions…).
    const hits = segments.flatMap((segment) => onScreenTextMentions(segment.prompt));
    if (hits.length > 0) {
      console.log(`[prompts/update] on-screen text (${hits.join(", ")}); rewriting`);
      segments = normalize(await chatJson(system, `${user}

${onScreenTextFix(hits)}`, { maxTokens: 16000 }), targets);
    }
    return NextResponse.json({ segments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
