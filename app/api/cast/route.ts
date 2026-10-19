import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { analysisBlock, readPrompt } from "@/lib/prompts";
import type { Character, StoryLocation } from "@/lib/types";

export const maxDuration = 120;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalize(data: unknown): { title: string; characters: Character[]; location: StoryLocation } {
  if (!data || typeof data !== "object") {
    throw new Error("Cast result was not an object.");
  }

  const raw = data as Record<string, unknown>;
  const charactersIn = Array.isArray(raw.characters) ? raw.characters : [];
  const characters: Character[] = charactersIn.map((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: asString(row.id, `S${index + 1}`),
      name: asString(row.name, `Character ${index + 1}`),
      look: asString(row.look, "Appearance not specified."),
      ...(row.voiceOnly === true ? { voiceOnly: true } : {}),
    };
  });
  if (characters.length === 0) {
    throw new Error("The model returned no characters.");
  }

  const locationIn =
    raw.location && typeof raw.location === "object" ? (raw.location as Record<string, unknown>) : {};
  const location: StoryLocation = {
    name: asString(locationIn.name, "Main location"),
    description: asString(locationIn.description),
    generated: locationIn.generated === true,
  };
  if (!location.description) {
    throw new Error("The model returned no location description.");
  }

  return { title: asString(raw.title, "Untitled story"), characters, location };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gist?: string;
      comment?: string;
      previous?: { characters?: Character[]; location?: StoryLocation };
      analysis?: unknown;
    };
    const gist = body.gist?.trim();
    if (!gist) {
      return NextResponse.json({ error: "Paste a story gist first." }, { status: 400 });
    }

    const parts = [`Extract the characters and the main location from this story gist.`, "", `GIST:\n${gist}`];
    const analysis = analysisBlock(body.analysis);
    if (analysis) {
      parts.push("", `STORY ANALYSIS:\n${analysis}`);
    }
    const comment = body.comment?.trim();
    if (comment) {
      const previous = {
        characters: Array.isArray(body.previous?.characters) ? body.previous.characters : [],
        location: body.previous?.location || null,
      };
      parts.push(
        "",
        `PREVIOUS RESULT:\n${JSON.stringify(previous, null, 2)}`,
        "",
        `USER COMMENT (apply it; keep everything else from the previous result unless the comment says otherwise):\n${comment}`,
      );
    }

    const system = await readPrompt("prompts/cast-system.md");
    const data = await chatJson(system, parts.join("\n"), { maxTokens: 4000 });

    return NextResponse.json(normalize(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cast extraction failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
