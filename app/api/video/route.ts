import { NextResponse } from "next/server";
import { queueFastStory, queueLongTake, queueStoryV2, type StorySegment } from "@/lib/comfyui";
import { isFastEngine } from "@/lib/engines";
import { IMAGE_ASPECT_RATIOS } from "@/lib/types";

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      storyId?: string;
      segments?: { duration?: number; prompt?: string; join?: string; panel?: number }[];
      image?: { filename?: string; subfolder?: string; type?: string };
      devMode?: boolean;
      seed?: number;
      engine?: string;
      aspectRatio?: string;
      megapixels?: number;
      steps?: number;
      devMegapixels?: number;
      devSteps?: number;
      // Storyboard grid: "whole" = the grid on every segment, "panels" = each segment's own panel.
      grid?: { feed?: string; panels?: { filename?: string; subfolder?: string; type?: string }[] };
    };

    const storyId = /^[a-zA-Z0-9_-]+$/.test(body.storyId || "") ? String(body.storyId) : "";
    if (!storyId) {
      return NextResponse.json({ error: "Missing story id." }, { status: 400 });
    }
    const safeImage = (item?: { filename?: string; subfolder?: string; type?: string }) =>
      item?.filename && !/[\\/]/.test(item.filename) && !(item.subfolder || "").includes("..")
        ? { filename: item.filename, subfolder: item.subfolder || "", type: item.type || "output" }
        : null;
    const grid = body.grid && typeof body.grid === "object" ? body.grid : null;
    const panels = (Array.isArray(grid?.panels) ? grid.panels : []).map(safeImage);
    const segments = (Array.isArray(body.segments) ? body.segments : [])
      .map((segment) => {
        const panel = Math.round(Number(segment.panel) || 0);
        const own = grid?.feed === "panels" && panel >= 1 ? panels[panel - 1] : null;
        return {
          duration: Number(segment.duration),
          prompt: segment.prompt?.trim() || "",
          ...(segment.join === "cut" || segment.join === "continuous" ? { join: segment.join } : {}),
          ...(own ? { image: own } : {}),
        } as StorySegment;
      })
      .filter((segment) => segment.prompt && segment.duration >= 4 && segment.duration <= 15);
    if (segments.length === 0 || segments.length !== (body.segments || []).length) {
      return NextResponse.json({ error: "Every segment needs a prompt and a 4–15 s duration." }, { status: 400 });
    }
    const image = body.image;
    if (!image?.filename || /[\\/]/.test(image.filename) || (image.subfolder || "").includes("..")) {
      return NextResponse.json({ error: "Select a reference image first." }, { status: 400 });
    }

    const aspectRatio = (IMAGE_ASPECT_RATIOS as readonly string[]).includes(body.aspectRatio || "")
      ? String(body.aspectRatio)
      : "16:9 (Widescreen)";
    const comfyImage = { filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" };
    // Storyboard grids need "max" so each panel keeps its detail (render test, docs/RESEARCH_grid_reference_image.md).
    const refImageSize = grid ? ("max" as const) : undefined;
    if (grid && body.engine !== "story-v2" && !isFastEngine(body.engine)) {
      return NextResponse.json(
        { error: "Storyboard grids need a ref2va workflow (Veda Turbo, Sage SLA or Story V2), not the long take." },
        { status: 400 },
      );
    }

    // Veda Turbo / Sage SLA: single pass with the workflow's own steps; DEV switches the canvas.
    if (isFastEngine(body.engine)) {
      const queued = await queueFastStory({
        engine: body.engine,
        segments,
        image: comfyImage,
        devMode: body.devMode !== false,
        seed: Math.max(0, Math.floor(Number(body.seed) || 0)),
        aspectRatio,
        projectBase: `h3s_${storyId.slice(0, 8)}_${body.engine === "veda-turbo" ? "veda" : "sage"}`,
        refImageSize,
      });
      return NextResponse.json(queued);
    }

    if (body.engine === "story-v2") {
      // Megapixels move in 0.1 steps (Easy-Media rounds anything finer).
      const mp = (value: unknown) => Math.round(clampNumber(value, 0.1, 2, 0.3) * 10) / 10;
      const steps = (value: unknown) => Math.round(clampNumber(value, 4, 60, 10));
      const queued = await queueStoryV2({
        segments,
        image: comfyImage,
        devMode: body.devMode !== false,
        seed: Math.max(0, Math.floor(Number(body.seed) || 0)),
        megapixels: mp(body.megapixels),
        steps: steps(body.steps),
        devMegapixels: mp(body.devMegapixels),
        devSteps: steps(body.devSteps),
        aspectRatio,
        projectBase: `h3s_${storyId.slice(0, 8)}_v2`,
        refImageSize,
      });
      return NextResponse.json(queued);
    }

    const { promptId, project } = await queueLongTake({
      segments,
      image: { filename: image.filename, subfolder: image.subfolder || "", type: image.type || "output" },
      devMode: body.devMode !== false,
      seed: Math.max(0, Math.floor(Number(body.seed) || 0)),
      projectBase: `h3s_${storyId.slice(0, 8)}`,
    });

    return NextResponse.json({ promptId, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the video.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
