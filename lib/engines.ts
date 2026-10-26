import type { VideoEngine } from "./types";

// Video workflows offered on the Video tab (client-safe; lib/comfyui.ts builds the graphs).
export const VIDEO_ENGINES: { id: VideoEngine; label: string; detail: string }[] = [
  {
    id: "veda-turbo",
    label: "Veda Turbo (ref2va mixed, 4 steps)",
    detail: "Veda Turbo (ref2va w4a8 mixed + Taomate 3-step LoRA, Veda sparse attention, single pass)",
  },
  {
    id: "singularity-veda",
    label: "Singularity Veda (Singularity v2, 3 steps)",
    detail: "Singularity Veda (Singularity v2 ref2va w4a8 + Taomate 3-step LoRA, Veda sparse attention, single pass)",
  },
  {
    id: "sage-sla",
    label: "Sage SLA (ref2va mixed, 10 steps)",
    detail: "Sage SLA (ref2va w4a8 mixed + ref2v turbo 8-step LoRA, Sage + H3 SLA 0.85, single pass)",
  },
  { id: "story-v2", label: "Story V2 (ref2va, dual pass)", detail: "Story V2 (ref2va, dual pass, x1.25 refine)" },
  { id: "long-take", label: "Long take (fl2va, single pass + VSR)", detail: "Long take (fl2va, single pass + RTX VSR)" },
];

export function engineInfo(engine: VideoEngine | undefined) {
  return VIDEO_ENGINES.find((item) => item.id === (engine || "long-take")) || VIDEO_ENGINES[3];
}

export function isVideoEngine(value: unknown): value is VideoEngine {
  return VIDEO_ENGINES.some((item) => item.id === value);
}

// The two "Story Speed Tests" workflows: same graph layout, single pass, fixed steps.
export type FastStoryEngine = "veda-turbo" | "singularity-veda" | "sage-sla";

export function isFastEngine(engine: unknown): engine is FastStoryEngine {
  return engine === "veda-turbo" || engine === "singularity-veda" || engine === "sage-sla";
}

export const FAST_ENGINE_STEPS: Record<FastStoryEngine, number> = {
  "veda-turbo": 4,
  "singularity-veda": 3,
  "sage-sla": 10,
};

// Short tag in the ComfyUI project folder name (h3s_<id>_<tag>[_dev]).
export const FAST_ENGINE_TAG: Record<FastStoryEngine, string> = {
  "veda-turbo": "veda",
  "singularity-veda": "sveda",
  "sage-sla": "sage",
};

export type Size = { width: number; height: number };

// Editor presets the workflows were tuned with (FULL ~1.03 MP, DEV ~0.52 MP).
const FAST_PRESETS: Record<string, { size: string; devSize: string }> = {
  "9:16": { size: "768 x 1344 (9:16)", devSize: "544 x 960 (9:16)" },
  "16:9": { size: "1344 x 768 (16:9)", devSize: "960 x 544 (16:9)" },
};
const FULL_PIXELS = 768 * 1344;
const DEV_PIXELS = 544 * 960;

function customSize(aspectRatio: string, pixels: number): Size {
  const [w, h] = aspectRatio.split(" ")[0].split(":").map(Number);
  const ratio = w > 0 && h > 0 ? w / h : 9 / 16;
  const snap = (value: number) => Math.max(64, Math.round(value / 16) * 16);
  return { width: snap(Math.sqrt(pixels * ratio)), height: snap(Math.sqrt(pixels / ratio)) };
}

// The canvas for an aspect ratio: the editor preset when there is one, else a custom size with
// the same pixel count.
export function fastStorySize(aspectRatio: string, devMode: boolean): { preset: string | null; size: Size } {
  const preset = FAST_PRESETS[aspectRatio.split(" ")[0]];
  if (preset) {
    const name = devMode ? preset.devSize : preset.size;
    const [width, height] = name.split(" (")[0].split(" x ").map(Number);
    return { preset: name, size: { width, height } };
  }
  return { preset: null, size: customSize(aspectRatio, devMode ? DEV_PIXELS : FULL_PIXELS) };
}
