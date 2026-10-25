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
  readPromptWithFormats,
  timestampFix,
  undefinedSubjects,
  undefinedSubjectsFix,
} from "@/lib/prompts";
import { isFreshShot, storyboardInstructions, type GridFeed } from "@/lib/grid";
import type { BreakdownResult, PromptSegment, StoryLocation } from "@/lib/types";

export const maxDuration = 300;

// OpenRouter occasionally stalls on one request for minutes. If a frame has not
// answered by then, send the same request again and keep whichever finishes first.
const BACKUP_AFTER_MS = 75_000;

// Continuation segments carry 0.92 s of the previous segment at their start.
function continuationEnd(duration: number): string {
  const total = duration + 0.92;
  const seconds = Math.floor(total);
  const millis = Math.round((total - seconds) * 1000);
  return `00:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function withBackupRequest<T>(run: () => Promise<T>, backupAfterMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let running = 0;
    let backupSent = false;

    const sendBackup = (reason: string) => {
      if (settled || backupSent) return;
      backupSent = true;
      clearTimeout(timer);
      console.log(`[prompts] frame ${label}: ${reason}; sending a backup request`);
      launch();
    };

    const launch = () => {
      running += 1;
      run().then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          running -= 1;
          if (settled) return;
          if (!backupSent) {
            sendBackup(`request failed (${error instanceof Error ? error.message : error})`);
          } else if (running === 0) {
            settled = true;
            reject(error);
          }
        },
      );
    };

    const timer = setTimeout(() => sendBackup(`no answer after ${backupAfterMs / 1000}s`), backupAfterMs);
    launch();
  });
}

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
      reference?: boolean;
      location?: StoryLocation;
      layout?: string;
      analysis?: unknown;
      promptStyle?: string;
      tips?: boolean;
      model?: string;
      // The selected reference image is a storyboard grid.
      grid?: { rows?: number; cols?: number; feed?: string };
    };
    // The story's OpenRouter model chain; blank = the .env default.
    const chain = parseModelChain(body.model);
    if (chain.error) {
      return NextResponse.json({ error: chain.error }, { status: 400 });
    }

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
        ...(frame.panel ? { panel: Math.round(Number(frame.panel)) } : {}),
        ...(frame.join === "cut" || frame.join === "continuous" ? { join: frame.join } : {}),
      })),
    };
    const grid =
      body.grid && Number(body.grid.rows) >= 1 && Number(body.grid.cols) >= 1
        ? {
            rows: Math.round(Number(body.grid.rows)),
            cols: Math.round(Number(body.grid.cols)),
            feed: (body.grid.feed === "panels" ? "panels" : "whole") as GridFeed,
          }
        : null;

    // One call per frame, all in parallel: a single call for the whole story regularly
    // ran past several minutes, while per-frame calls finish in well under that.
    const reference = body.reference === true;
    // Story V2 style exists only for reference-image (Ref2VA) prompts.
    const v2 = reference && body.promptStyle === "story-v2";
    const tips = { tips: body.tips !== false };
    const system = v2
      ? await readPromptWithFormats("prompts/h3-ref2va-v2-system.md", tips)
      : reference
        ? await readPromptWithFormats("prompts/h3-ref2va-system.md", tips)
        : await readPrompt("prompts/h3-t2va-system.md", tips);
    const analysis = analysisBlock(body.analysis);
    const perFrame = await Promise.all(
      breakdown.frames.map(async (frame, index) => {
        // A cut (or the first segment) starts a fresh shot; everything else continues the take.
        const fresh = isFreshShot(index, frame.join);
        const storyboard =
          reference && grid && frame.panel
            ? storyboardInstructions(frame.panel, grid.rows, grid.cols, grid.feed, fresh)
            : [];
        const lines = v2
          ? [
              `Write exactly one Story V2 Ref2VA H3 prompt for segment ${index + 1} of ${breakdown.frames.length} (id "${frame.id}", ${frame.duration} s). No timestamps anywhere.`,
              index === 0
                ? "This is SEGMENT 1: a fresh shot in the place of <Picture 1>."
                : fresh
                  ? "This segment starts with a CUT: a fresh shot, so it does NOT open with the already-in-progress sentence; one continuous take inside the segment."
                  : "This is a CONTINUOUS segment: [Shot 1] opens with the exact already-in-progress sentence and the take never cuts.",
              "Leave out every character who is not in this segment's shot. Name the background on both sides of the frame.",
              "Keep character identity locked and stay continuous with the neighbouring segments.",
              "",
              `STORY TITLE: ${breakdown.title}`,
              "",
              `ORIGINAL GIST:\n${body.gist?.trim() || "(not provided)"}`,
              "",
              `CHARACTER LOCK (S1 = <Subject 1>, S2 = <Subject 2>, …):\n${JSON.stringify(breakdown.characters, null, 2)}`,
              "",
              `LOCATION (shown in <Picture 1>):\n${JSON.stringify(body.location || {}, null, 2)}`,
              "",
              `<Picture 1> LAYOUT: ${body.layout?.trim() || "(not provided)"}`,
            ]
          : reference
          ? [
              `Write exactly one Ref2VA H3 prompt for segment ${index + 1} of ${breakdown.frames.length} (id "${frame.id}", ${frame.duration} s).`,
              fresh
                ? `This is ${index === 0 ? "SEGMENT 1" : "a new shot after a CUT"}: it starts fresh${storyboard.length ? " on its storyboard panel" : " from <Picture 1>"}; timestamps run 00:00.000 to 00:${String(frame.duration).padStart(2, "0")}.000, and it does NOT open on the previous shot's final moment.`
                : `This is a CONTINUATION segment: open with the previous shot's final moment; content timestamps run 00:00.920 to ${continuationEnd(frame.duration)}.`,
              "Keep character identity locked and stay continuous with the neighbouring segments.",
              "",
              `STORY TITLE: ${breakdown.title}`,
              "",
              `ORIGINAL GIST:\n${body.gist?.trim() || "(not provided)"}`,
              "",
              `CHARACTER LOCK (S1 = <Subject 1>, S2 = <Subject 2>, …):\n${JSON.stringify(breakdown.characters, null, 2)}`,
              "",
              `LOCATION (shown in <Picture 1>):\n${JSON.stringify(body.location || {}, null, 2)}`,
              "",
              `<Picture 1> LAYOUT: ${body.layout?.trim() || "(not provided)"}`,
            ]
          : [
              `Write exactly one T2VA H3 prompt for frame ${index + 1} of ${breakdown.frames.length} (id "${frame.id}"). Keep character identity locked and stay continuous with the neighbouring frames.`,
              "",
              `STORY TITLE: ${breakdown.title}`,
              "",
              `ORIGINAL GIST:\n${body.gist?.trim() || "(not provided)"}`,
              "",
              `CHARACTER LOCK:\n${JSON.stringify(breakdown.characters, null, 2)}`,
            ];
        const user = [
          ...lines,
          ...(storyboard.length ? ["", ...storyboard] : []),
          ...(analysis ? ["", `STORY ANALYSIS:\n${analysis}`] : []),
          "",
          `ALL FRAMES (context only):\n${JSON.stringify(breakdown.frames, null, 2)}`,
          "",
          `FRAMES (write this one only):\n${JSON.stringify([frame], null, 2)}`,
        ].join("\n");
        const generate = async (request: string) => {
          const data = await withBackupRequest(
            () => chatJson(system, request, { maxTokens: 6000, timeoutMs: 180_000, models: chain.models }),
            BACKUP_AFTER_MS,
            frame.id,
          );
          const segments = normalize(data, { ...breakdown, frames: [frame] }).map((segment) => ({
            ...segment,
            ...(frame.panel ? { panel: frame.panel } : {}),
            ...(frame.join ? { join: frame.join } : {}),
          }));
          return v2 && !fresh
            ? segments.map((segment) => ({ ...segment, prompt: ensureContinuousOpener(segment.prompt) }))
            : segments;
        };
        const segments = await generate(user);
        // One retry when the prompt still asks H3 to draw text (thought bubbles, captions…)
        // or, in Story V2 style, still carries timestamps or names a subject who is not in the shot.
        const hits = segments.flatMap((segment) => onScreenTextMentions(segment.prompt));
        const times = v2 ? segments.flatMap((segment) => promptTimestamps(segment.prompt)) : [];
        const ghosts = v2 ? [...new Set(segments.flatMap((segment) => undefinedSubjects(segment.prompt)))] : [];
        // Storyboard segments must name <Picture 1> as the storyboard.
        const noBoard = storyboard.length > 0 && segments.some((segment) => !/storyboard/i.test(segment.prompt));
        if (hits.length === 0 && times.length === 0 && ghosts.length === 0 && !noBoard) return segments;
        if (noBoard) console.log(`[prompts] frame ${frame.id}: storyboard line missing; rewriting`);
        if (hits.length) console.log(`[prompts] frame ${frame.id}: on-screen text (${hits.join(", ")}); rewriting`);
        if (times.length) console.log(`[prompts] frame ${frame.id}: timestamps in a V2 prompt (${times.join(", ")}); rewriting`);
        if (ghosts.length) console.log(`[prompts] frame ${frame.id}: undefined subjects in a V2 prompt (${ghosts.join(", ")}); rewriting`);
        const fixes = [
          hits.length ? onScreenTextFix(hits) : "",
          times.length ? timestampFix(times) : "",
          ghosts.length ? undefinedSubjectsFix(ghosts) : "",
          noBoard ? `CORRECTION: the <Picture 1> line is missing. ${storyboard[1]}` : "",
        ].filter(Boolean);
        return generate(`${user}

${fixes.join("\n\n")}`);
      }),
    );
    return NextResponse.json({ segments: perFrame.flat() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Prompt generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
