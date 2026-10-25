import { NextResponse } from "next/server";
import { comfyViewUrl } from "@/lib/comfyui";
import { parseModelChain } from "@/lib/models";
import { chatJson } from "@/lib/openrouter";
import { analysisBlock, readPrompt } from "@/lib/prompts";
import type { Character, Frame, StoryLocation } from "@/lib/types";

export const maxDuration = 180;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// One frame per storyboard panel, written by a model that looks at the grid picture.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      gist?: string;
      title?: string;
      characters?: Character[];
      location?: StoryLocation;
      analysis?: unknown;
      image?: { filename?: string; subfolder?: string; type?: string };
      rows?: number;
      cols?: number;
      model?: string;
    };
    const chain = parseModelChain(body.model);
    if (chain.error) {
      return NextResponse.json({ error: chain.error }, { status: 400 });
    }
    const rows = Math.round(Number(body.rows) || 0);
    const cols = Math.round(Number(body.cols) || 0);
    const image = body.image;
    if (rows < 1 || cols < 1 || rows * cols < 2 || rows * cols > 16) {
      return NextResponse.json({ error: "The grid needs 2 to 16 panels." }, { status: 400 });
    }
    if (!image?.filename || /[\\/]/.test(image.filename) || (image.subfolder || "").includes("..")) {
      return NextResponse.json({ error: "Select the storyboard grid image first." }, { status: 400 });
    }

    const picture = await fetch(
      comfyViewUrl({ filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" }),
    );
    if (!picture.ok) {
      return NextResponse.json({ error: `ComfyUI could not return the grid image (${picture.status}).` }, { status: 502 });
    }
    const dataUrl = `data:image/png;base64,${Buffer.from(await picture.arrayBuffer()).toString("base64")}`;

    const system = await readPrompt("prompts/grid-frames-system.md");
    const analysis = analysisBlock(body.analysis);
    const user = [
      `The attached picture is a ${rows} x ${cols} storyboard grid: ${rows * cols} panels, read left to right, top to bottom.`,
      "",
      `STORY TITLE: ${body.title?.trim() || "Untitled story"}`,
      "",
      `GIST:\n${body.gist?.trim() || "(not provided: tell the story the panels show)"}`,
      "",
      `CHARACTER LOCK:\n${JSON.stringify(body.characters || [], null, 2)}`,
      "",
      `LOCATION:\n${JSON.stringify(body.location || {}, null, 2)}`,
      ...(analysis ? ["", `STORY ANALYSIS:\n${analysis}`] : []),
    ].join("\n");

    let data: unknown;
    try {
      data = await chatJson(system, user, { maxTokens: 6000, models: chain.models, images: [dataUrl] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${message} Reading the grid needs a model that can see images, e.g. google/gemini-3.7-flash (sidebar).`,
      );
    }
    const rowsIn = Array.isArray((data as { frames?: unknown })?.frames) ? (data as { frames: unknown[] }).frames : [];
    const count = rows * cols;
    const frames: Frame[] = Array.from({ length: count }, (_, index) => {
      const panel = index + 1;
      const row = (rowsIn.find((item) => Number((item as { panel?: unknown })?.panel) === panel) ??
        rowsIn[index] ??
        {}) as Record<string, unknown>;
      const duration = Math.min(15, Math.max(4, Math.round(Number(row.duration) || 5)));
      return {
        id: `f${panel}`,
        title: asString(row.title) || `Panel ${panel}`,
        summary: asString(row.summary),
        duration,
        panel,
        join: row.join === "continuous" ? "continuous" : "cut",
      };
    });
    if (frames.some((frame) => !frame.summary)) {
      throw new Error("The model did not describe every panel. Try again or pick another model.");
    }
    return NextResponse.json({ frames });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reading the grid failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
