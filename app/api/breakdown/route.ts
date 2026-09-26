import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { clampDuration } from "@/lib/parse";
import { readPrompt } from "@/lib/prompts";
import type { BreakdownResult, Character, Frame } from "@/lib/types";

export const maxDuration = 120;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalize(data: unknown): BreakdownResult {
  if (!data || typeof data !== "object") {
    throw new Error("Breakdown result was not an object.");
  }

  const raw = data as Record<string, unknown>;
  const charactersIn = Array.isArray(raw.characters) ? raw.characters : [];
  const framesIn = Array.isArray(raw.frames) ? raw.frames : [];

  const characters: Character[] = charactersIn.map((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: asString(row.id, `S${index + 1}`),
      name: asString(row.name, `Character ${index + 1}`),
      look: asString(row.look, "Appearance not specified."),
    };
  });

  const frames: Frame[] = framesIn.map((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: asString(row.id, `f${index + 1}`),
      title: asString(row.title, `Frame ${index + 1}`),
      summary: asString(row.summary),
      duration: clampDuration(row.duration),
    };
  });

  if (frames.length === 0) {
    throw new Error("The model returned no frames.");
  }

  return {
    title: asString(raw.title, "Untitled story"),
    characters,
    frames,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gist?: string };
    const gist = body.gist?.trim();
    if (!gist) {
      return NextResponse.json({ error: "Paste a story gist first." }, { status: 400 });
    }

    const system = await readPrompt("prompts/breakdown-system.md");
    const data = await chatJson(
      system,
      `Break this story gist into H3 frames.\n\nGIST:\n${gist}`,
      { maxTokens: 4000 },
    );

    return NextResponse.json(normalize(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Breakdown failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
