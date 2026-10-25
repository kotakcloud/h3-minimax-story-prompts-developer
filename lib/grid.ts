import type { Frame, ReferenceImage, Story } from "./types";

// A reference image can be a storyboard grid: rows x columns of scene panels read left to right,
// top to bottom. Tested on Veda Turbo (docs/RESEARCH_grid_reference_image.md, section 6): naming a
// panel by position makes H3 open that segment on it, with no grid borders in the video.

export type GridFeed = "whole" | "panels";

function rowWord(row: number, rows: number): string {
  if (row === 0) return "top";
  if (row === rows - 1) return "bottom";
  if (rows === 3) return "middle";
  return `row ${row + 1}`;
}

function colWord(col: number, cols: number): string {
  if (col === 0) return "left";
  if (col === cols - 1) return "right";
  if (cols === 3) return "center";
  return `column ${col + 1}`;
}

// "top-left panel" on a 2x2 grid; "top row, center panel" when a word is not a corner.
export function panelPosition(panel: number, rows: number, cols: number): string {
  const index = Math.max(0, panel - 1);
  const row = Math.floor(index / cols);
  const col = index % cols;
  const r = rows === 1 ? "" : rowWord(row, rows);
  const c = cols === 1 ? "" : colWord(col, cols);
  if (!r) return `${c} panel`;
  if (!c) return `${r} panel`;
  const corner = (r === "top" || r === "bottom") && (c === "left" || c === "right");
  return corner ? `${r}-${c} panel` : `${r} row, ${c} panel`;
}

export function selectedGrid(story: Pick<Story, "referenceImages" | "selectedImageId">): ReferenceImage | null {
  const image = story.referenceImages.find((item) => item.id === story.selectedImageId);
  return image?.grid ? image : null;
}

// Whether a segment starts a fresh shot: the first one, or one whose join is a cut.
export function isFreshShot(index: number, join: Frame["join"]): boolean {
  return index === 0 || join === "cut";
}

// Instructions for the prompt writer when a segment plays a storyboard panel.
export function storyboardInstructions(
  panel: number,
  rows: number,
  cols: number,
  feed: GridFeed,
  fresh: boolean,
): string[] {
  const lines = storyboardLines(panel, rows, cols, feed);
  return [
    feed === "whole"
      ? `STORYBOARD: <Picture 1> is a ${rows}x${cols} storyboard grid of scene panels (read left to right, top to bottom). This segment plays panel ${panel}, the ${panelPosition(panel, rows, cols)}.`
      : `STORYBOARD: <Picture 1> is panel ${panel} of the storyboard, cut out on its own, the frame this segment plays.`,
    `In subject_definitions, define each visible character as shown in ${lines.source}, and instead of any appearance-anchor or setting line for <Picture 1> write exactly this line: ${lines.picture}`,
    `In retention_analysis the <Picture 1> line is exactly: ${lines.retention}`,
    "The summary starts with [reference generation] and describes a single full-frame shot of this panel's moment.",
    fresh
      ? "This segment is a fresh shot (the first one, or a cut): it opens on the panel's composition, framing, light and setting. No already-in-progress or continuation opener, no carried-over frames."
      : "This segment continues the previous shot without a cut; the panel shows where it goes.",
    "Let the panel carry the composition; write the motion, camera move, dialogue, sound and the end state. Describe only the people visible in the panel.",
  ];
}

// The <Picture 1> lines a storyboard segment must carry (the wording of the render test).
export function storyboardLines(
  panel: number,
  rows: number,
  cols: number,
  feed: GridFeed,
): { picture: string; retention: string; source: string } {
  if (feed === "panels") {
    return {
      picture:
        "<Picture 1> is the storyboard frame for [Shot 1], defining its viewpoint, framing, subject placement, light and setting.",
      retention:
        "<Picture 1> (storyboard frame): partially_preserved - its composition, framing, light and setting are followed.",
      source: "<Picture 1>",
    };
  }
  const position = panelPosition(panel, rows, cols);
  return {
    picture: `<Picture 1> is a storyboard reference for [Shot 1]: its ${position} defines this shot's viewpoint, framing, subject placement, light and setting.`,
    retention: `<Picture 1> (storyboard reference): partially_preserved - only the ${position}'s composition, framing, light and setting are followed; the video is one full-frame shot.`,
    source: "the panels of <Picture 1>",
  };
}
