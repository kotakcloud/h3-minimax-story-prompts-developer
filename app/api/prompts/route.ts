import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { clampDuration } from "@/lib/parse";
import { readPrompt } from "@/lib/prompts";
import type { BreakdownResult, PromptSegment } from "@/lib/types";

export const maxDuration = 300;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalize(data: unknown, fallback: BreakdownResult): PromptSegment[] {
  if (!data || typeof data !== "object") {
    throw new Error("Prompt result was not an object.");
  }

  const raw = data as Record<string, unknown>;
  const rows = Array.isArray(raw.segments) ? raw.segments : [];
  const byId = new Map(
    rows.map((item) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return [asString(row.id), row];
    }),
  );

  const segments = fallback.frames.map((frame, index) => {
    const row = byId.get(frame.id) ?? rows[index];
    const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const prompt = asString(record.prompt);
    if (!prompt) {
      throw new Error(`Missing H3 prompt for frame ${frame.id}.`);
    }
    return {
      id: frame.id,
      duration: clampDuration(record.duration, frame.duration),
      prompt,
    };
  });

  if (segments.length === 0) {
    throw new Error("The model returned no prompts.");
  }

  return segments;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gist?: string;
      title?: string;
      characters?: BreakdownResult["characters"];
      frames?: BreakdownResult["frames"];
    };

    const frames = Array.isArray(body.frames) ? body.frames : [];
    if (frames.length === 0) {
      return NextResponse.json({ error: "Add at least one frame first." }, { status: 400 });
    }

    const breakdown: BreakdownResult = {
      title: body.title?.trim() || "Untitled story",
      characters: Array.isArray(body.characters) ? body.characters : [],
      frames: frames.map((frame, index) => ({
        id: frame.id || `f${index + 1}`,
        title: frame.title?.trim() || `Frame ${index + 1}`,
        summary: frame.summary?.trim() || "",
        duration: clampDuration(frame.duration),
      })),
    };

    const system = await readPrompt("prompts/h3-t2va-system.md");
    const user = [
      "Write one T2VA H3 prompt per frame. Keep character identity locked across segments.",
      "",
      `STORY TITLE: ${breakdown.title}`,
      "",
      `ORIGINAL GIST:\n${body.gist?.trim() || "(not provided)"}`,
      "",
      `CHARACTER LOCK:\n${JSON.stringify(breakdown.characters, null, 2)}`,
      "",
      `FRAMES:\n${JSON.stringify(breakdown.frames, null, 2)}`,
    ].join("\n");

    try {
      const data = await chatJson(system, user, { maxTokens: 24000 });
      return NextResponse.json({ segments: normalize(data, breakdown) });
    } catch (batchError) {
      const segments: PromptSegment[] = [];
      for (const frame of breakdown.frames) {
        const singleUser = [
          "Write exactly one T2VA H3 prompt for this single frame. Keep character identity locked.",
          "",
          `STORY TITLE: ${breakdown.title}`,
          "",
          `ORIGINAL GIST:\n${body.gist?.trim() || "(not provided)"}`,
          "",
          `CHARACTER LOCK:\n${JSON.stringify(breakdown.characters, null, 2)}`,
          "",
          `FRAMES:\n${JSON.stringify([frame], null, 2)}`,
        ].join("\n");
        const data = await chatJson(system, singleUser, { maxTokens: 4000 });
        segments.push(...normalize(data, { ...breakdown, frames: [frame] }));
      }
      if (segments.length === 0) {
        throw batchError;
      }
      return NextResponse.json({ segments });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
