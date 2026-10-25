import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { parseModelChain } from "@/lib/models";
import { clampDuration } from "@/lib/parse";
import {
  analysisBlock,
  ensureContinuousOpener,
  onScreenTextFix,
  onScreenTextMentions,
  promptTimestamps,
  readPrompt,
  timestampFix,
  undefinedSubjects,
  undefinedSubjectsFix,
} from "@/lib/prompts";
import { isFreshShot, storyboardInstructions, type GridFeed } from "@/lib/grid";
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
  panel?: number;
  join?: "cut" | "continuous";
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
      ...(target.panel ? { panel: target.panel } : {}),
      ...(target.join ? { join: target.join } : {}),
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
      promptStyle?: string;
      tips?: boolean;
      model?: string;
      grid?: { rows?: number; cols?: number; feed?: string };
    };
    // The story's OpenRouter model chain; blank = the .env default.
    const chain = parseModelChain(body.model);
    if (chain.error) {
      return NextResponse.json({ error: chain.error }, { status: 400 });
    }

    const comment = body.comment?.trim();
    const targets = Array.isArray(body.targets) ? body.targets.filter((item) => item?.id && item.prompt) : [];
    if (!comment) {
      return NextResponse.json({ error: "Type a comment describing the update." }, { status: 400 });
    }
    if (targets.length === 0) {
      return NextResponse.json({ error: "Select at least one prompt number." }, { status: 400 });
    }

    const v2 = body.reference === true && body.promptStyle === "story-v2";
    const system = await readPrompt(
      v2
        ? "prompts/h3-ref2va-v2-update.md"
        : body.reference === true
          ? "prompts/h3-ref2va-update.md"
          : "prompts/h3-t2va-update.md",
      { tips: body.tips !== false },
    );
    // Storyboard grid: keep each target's <Picture 1> storyboard lines and its cut / continue opening.
    const grid =
      body.reference === true && body.grid && Number(body.grid.rows) >= 1 && Number(body.grid.cols) >= 1
        ? {
            rows: Math.round(Number(body.grid.rows)),
            cols: Math.round(Number(body.grid.cols)),
            feed: (body.grid.feed === "panels" ? "panels" : "whole") as GridFeed,
          }
        : null;
    const storyboard = grid
      ? targets
          .filter((target) => target.panel)
          .flatMap((target) => [
            "",
            `TARGET ${target.number} (id ${target.id}) plays storyboard panel ${target.panel}. Keep these rules for it:`,
            ...storyboardInstructions(
              target.panel as number,
              grid.rows,
              grid.cols,
              grid.feed,
              isFreshShot(target.number - 1, target.join),
            ),
          ])
      : [];
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
      ...storyboard,
    ].join("\n");

    let segments = normalize(await chatJson(system, user, { maxTokens: 16000, models: chain.models }), targets);
    // One retry when an updated prompt still asks H3 to draw text (thought bubbles, captions…)
    // or, in Story V2 style, still carries timestamps or names a subject who is not in the shot.
    const hits = segments.flatMap((segment) => onScreenTextMentions(segment.prompt));
    const times = v2 ? segments.flatMap((segment) => promptTimestamps(segment.prompt)) : [];
    const ghosts = v2 ? [...new Set(segments.flatMap((segment) => undefinedSubjects(segment.prompt)))] : [];
    if (hits.length > 0 || times.length > 0 || ghosts.length > 0) {
      if (hits.length) console.log(`[prompts/update] on-screen text (${hits.join(", ")}); rewriting`);
      if (times.length) console.log(`[prompts/update] timestamps in a V2 prompt (${times.join(", ")}); rewriting`);
      if (ghosts.length) console.log(`[prompts/update] undefined subjects in a V2 prompt (${ghosts.join(", ")}); rewriting`);
      const fixes = [
        hits.length ? onScreenTextFix(hits) : "",
        times.length ? timestampFix(times) : "",
        ghosts.length ? undefinedSubjectsFix(ghosts) : "",
      ].filter(Boolean);
      segments = normalize(await chatJson(system, `${user}

${fixes.join("\n\n")}`, { maxTokens: 16000, models: chain.models }), targets);
    }
    if (v2) {
      segments = segments.map((segment) =>
        (() => {
          const target = targets.find((item) => item.id === segment.id);
          return !target || isFreshShot(target.number - 1, target.join);
        })()
          ? segment
          : { ...segment, prompt: ensureContinuousOpener(segment.prompt) },
      );
    }
    return NextResponse.json({ segments });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt update failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
