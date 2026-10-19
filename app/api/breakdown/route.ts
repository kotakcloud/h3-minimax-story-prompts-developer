import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { clampDuration } from "@/lib/parse";
import { analysisBlock, readPromptWithFormats } from "@/lib/prompts";
import type { BreakdownResult, Character, Frame, StoryLocation } from "@/lib/types";

export const maxDuration = 120;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalize(data: unknown, lockedCharacters: Character[]): BreakdownResult {
  if (!data || typeof data !== "object") {
    throw new Error("Breakdown result was not an object.");
  }

  const raw = data as Record<string, unknown>;
  const charactersIn = Array.isArray(raw.characters) ? raw.characters : [];
  const framesIn = Array.isArray(raw.frames) ? raw.frames : [];

  const characters: Character[] = lockedCharacters.length > 0 ? lockedCharacters : charactersIn.map((item, index) => {
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
    const body = (await request.json()) as {
      gist?: string;
      characters?: Character[];
      location?: StoryLocation;
      layout?: string;
      analysis?: unknown;
    };
    const gist = body.gist?.trim();
    if (!gist) {
      return NextResponse.json({ error: "Paste a story gist first." }, { status: 400 });
    }
    const characters = Array.isArray(body.characters) ? body.characters : [];

    const parts = [`Break this story gist into H3 frames.`, "", `GIST:\n${gist}`];
    if (characters.length > 0) {
      parts.push("", `CHARACTERS (locked):\n${JSON.stringify(characters, null, 2)}`);
    }
    if (body.location?.description?.trim()) {
      parts.push("", `LOCATION:\n${JSON.stringify(body.location, null, 2)}`);
    }
    if (body.layout?.trim()) {
      parts.push("", `REFERENCE LAYOUT:\n${body.layout.trim()}`);
    }
    const analysis = analysisBlock(body.analysis);
    if (analysis) {
      parts.push("", `STORY ANALYSIS:\n${analysis}`);
    }

    const system = await readPromptWithFormats("prompts/breakdown-system.md");
    const data = await chatJson(system, parts.join("\n"), { maxTokens: 4000 });

    return NextResponse.json(normalize(data, characters));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Breakdown failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
