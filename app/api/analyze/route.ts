import { NextResponse } from "next/server";
import { chatJson } from "@/lib/openrouter";
import { parseModelChain } from "@/lib/models";
import { readPromptWithFormats } from "@/lib/prompts";
import type { StoryAnalysis, StoryBeat } from "@/lib/types";
import { STORY_FORMATS } from "@/lib/types";

export const maxDuration = 120;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalize(data: unknown): StoryAnalysis {
  if (!data || typeof data !== "object") {
    throw new Error("Analysis result was not an object.");
  }
  const raw = data as Record<string, unknown>;
  const format = asString(raw.format);
  const logic = raw.logicCheck && typeof raw.logicCheck === "object" ? (raw.logicCheck as Record<string, unknown>) : {};
  const logicOk = logic.ok !== false;
  const beats: StoryBeat[] = (Array.isArray(raw.beats) ? raw.beats : []).map((item, index) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const seconds = Number(row.seconds);
    return {
      id: asString(row.id, `b${index + 1}`),
      purpose: asString(row.purpose),
      delivery: asString(row.delivery),
      content: asString(row.content),
      seconds: Number.isFinite(seconds) ? Math.max(1, Math.round(seconds)) : 5,
    };
  });
  if (beats.length === 0) {
    throw new Error("The analysis returned no beats.");
  }
  return {
    format: (STORY_FORMATS as readonly string[]).includes(format) ? format : "narrative",
    formatReason: asString(raw.formatReason),
    premise: asString(raw.premise),
    payoff: asString(raw.payoff),
    logicOk,
    logicIssue: logicOk ? "" : asString(logic.issue),
    suggestedGist: logicOk ? "" : asString(logic.suggestedGist),
    narrator: raw.narrator === true,
    tone: asString(raw.tone),
    sensitivity: asString(raw.sensitivity),
    beats,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { gist?: string; model?: string };
    // The story's OpenRouter model chain; blank = the .env default.
    const chain = parseModelChain(body.model);
    if (chain.error) {
      return NextResponse.json({ error: chain.error }, { status: 400 });
    }
    const gist = body.gist?.trim();
    if (!gist) {
      return NextResponse.json({ error: "Paste a story gist first." }, { status: 400 });
    }
    const system = await readPromptWithFormats("prompts/analysis-system.md");
    const data = await chatJson(system, `Analyse this story gist.\n\nGIST:\n${gist}`, { maxTokens: 4000, models: chain.models });
    return NextResponse.json({ analysis: normalize(data) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Story analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
