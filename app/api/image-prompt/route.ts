import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { parseModelChain } from "@/lib/models";
import { analysisBlock, readPrompt } from "@/lib/prompts";
import type { Character, StoryLocation } from "@/lib/types";
import { DEFAULT_IMAGE_SETTINGS, IMAGE_ASPECT_RATIOS } from "@/lib/types";

export const maxDuration = 120;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gist?: string;
      title?: string;
      characters?: Character[];
      location?: StoryLocation;
      analysis?: unknown;
      model?: string;
    };
    // The story's OpenRouter model chain; blank = the .env default.
    const chain = parseModelChain(body.model);
    if (chain.error) {
      return NextResponse.json({ error: chain.error }, { status: 400 });
    }
    const characters = (Array.isArray(body.characters) ? body.characters : []).filter(
      (character) => !character.voiceOnly,
    );
    if (characters.length === 0) {
      return NextResponse.json({ error: "Extract the cast first." }, { status: 400 });
    }
    if (!body.location?.description?.trim()) {
      return NextResponse.json({ error: "Add a location description first." }, { status: 400 });
    }

    const system = await readPrompt("prompts/reference-image-system.md");
    const user = [
      "Write the reference image prompt for this story.",
      "",
      `STORY TITLE: ${body.title?.trim() || "Untitled story"}`,
      "",
      `GIST:\n${body.gist?.trim() || "(not provided)"}`,
      "",
      `CHARACTERS:\n${JSON.stringify(characters, null, 2)}`,
      "",
      `LOCATION:\n${JSON.stringify(body.location, null, 2)}`,
      ...(analysisBlock(body.analysis) ? ["", `STORY ANALYSIS (for tone and staging):\n${analysisBlock(body.analysis)}`] : []),
    ].join("\n");

    const data = await chatJson(system, user, { maxTokens: 3000, models: chain.models });
    const raw = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const prompt = asString(raw.prompt);
    if (!prompt) {
      throw new Error("The model returned no image prompt.");
    }
    const aspect = asString(raw.aspectRatio);

    return NextResponse.json({
      prompt,
      negative: asString(raw.negative),
      layout: asString(raw.layout),
      aspectRatio: (IMAGE_ASPECT_RATIOS as readonly string[]).includes(aspect)
        ? aspect
        : DEFAULT_IMAGE_SETTINGS.aspectRatio,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image prompt generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
