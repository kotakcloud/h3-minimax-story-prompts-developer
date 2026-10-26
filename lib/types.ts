export type Character = {
  id: string;
  name: string;
  look: string;
  voiceOnly?: boolean;
};

export const STORY_FORMATS = [
  "dialogue_reversal",
  "logic_twist",
  "visual_gag",
  "misunderstanding",
  "escalation",
  "callback",
  "narrative",
  "emotional_moment",
] as const;

export type StoryBeat = {
  id: string;
  purpose: string;
  delivery: string;
  content: string;
  seconds: number;
};

export type StoryAnalysis = {
  format: string;
  formatReason: string;
  premise: string;
  payoff: string;
  logicOk: boolean;
  logicIssue: string;
  suggestedGist: string;
  narrator: boolean;
  tone: string;
  sensitivity: string;
  beats: StoryBeat[];
};

export type StoryLocation = {
  name: string;
  description: string;
  generated: boolean;
};

export const IMAGE_ASPECT_RATIOS = [
  "16:9 (Widescreen)",
  "9:16 (Portrait Widescreen)",
  "1:1 (Square)",
  "4:3 (Standard)",
  "3:4 (Portrait Standard)",
  "3:2 (Photo)",
  "2:3 (Portrait Photo)",
  "21:9 (Ultrawide)",
] as const;

export type ImageSettings = {
  aspectRatio: string;
  megapixels: number;
  seed: number;
};

export type ReferenceImage = {
  id: string;
  filename: string;
  subfolder: string;
  type: string;
  prompt: string;
  seed: number;
  aspectRatio: string;
  megapixels: number;
  createdAt: string;
  // "upload" = the user's own picture (no prompt or seed); missing = generated in ComfyUI.
  source?: "upload";
  originalName?: string;
  // A storyboard grid of scene panels (read left to right, top to bottom). The panels are also
  // stored cut out, for the one-panel-per-segment feed.
  grid?: {
    rows: number;
    cols: number;
    panelAspectRatio: string;
    panels: { filename: string; subfolder: string; type: string }[];
  };
};

export type VideoEngine = "long-take" | "story-v2" | "veda-turbo" | "singularity-veda" | "sage-sla";

// How Ref2VA prompts are written: timestamped beats for the long take, or the
// timestamp-free style the Story V2 workflow was proven with.
export type PromptStyle = "long-take" | "story-v2";

export function isPromptStyle(value: unknown): value is PromptStyle {
  return value === "long-take" || value === "story-v2";
}

// Story V2 prompts carry no timestamps; the workflow was proven only without them.
const TIMESTAMP = /\b\d{2}:\d{2}(?:\.\d{1,3})?\b/g;

export function promptTimestamps(prompt: string): string[] {
  return [...new Set(prompt.match(TIMESTAMP) || [])];
}

// The style the current prompt set was written in: as recorded on its revision, else
// inferred (older sets were all written for the long take, with timestamps).
export function activePromptStyle(story: Pick<Story, "segments" | "promptRevisions" | "activeRevisionId">): PromptStyle {
  const recorded = story.promptRevisions.find((revision) => revision.id === story.activeRevisionId)?.promptStyle;
  if (recorded) return recorded;
  return story.segments.some((segment) => promptTimestamps(segment.prompt).length > 0) ? "long-take" : "story-v2";
}

export type VideoSettings = {
  devMode: boolean;
  seed: number;
  engine: VideoEngine;
  // Story V2 only: pass-1 megapixels and steps for FULL and DEV renders.
  v2Megapixels: number;
  v2Steps: number;
  v2DevMegapixels: number;
  v2DevSteps: number;
  // Enhancement LoRAs chosen in the LoRA popup (enabled or not, so strengths are remembered).
  loras: { name: string; strength: number; enabled: boolean }[];
  // Test mode: render only the first N segments (0 = all).
  onlyFirst: number;
};

export type VideoRunStatus = "queued" | "running" | "done" | "error" | "cancelled";

export type VideoRun = {
  id: string;
  promptId: string;
  project: string;
  devMode: boolean;
  seed: number;
  engine?: VideoEngine;
  megapixels?: number;
  steps?: number;
  // Veda Turbo / Sage SLA canvas.
  width?: number;
  height?: number;
  segmentCount: number;
  revisionId: string;
  // Recorded at queue time (older runs lack them; the list derives what it can).
  promptStyle?: PromptStyle;
  durations?: number[];
  aspectRatio?: string;
  imageId?: string;
  imageFilename?: string;
  // Set when the reference was a storyboard grid: what H3 got on each segment.
  gridFeed?: "whole" | "panels";
  // Enhancement LoRAs used, and how many of the prompt set's segments were rendered.
  loras?: { name: string; strength: number }[];
  totalSegments?: number;
  // The owner's own rating (1-5 stars) and note.
  rating?: number;
  note?: string;
  // Set when the card was expanded or collapsed by hand (otherwise rated = collapsed).
  collapsed?: boolean;
  status: VideoRunStatus;
  segmentsDone: number;
  error: string;
  video: { filename: string; subfolder: string; type: string } | null;
  createdAt: string;
  finishedAt: string;
};

export type Frame = {
  id: string;
  title: string;
  summary: string;
  duration: number;
  // Storyboard grid stories: the panel this frame plays (1-based) and how it joins the previous
  // frame. Without a join every frame after the first continues the take (the long-take default).
  panel?: number;
  join?: "cut" | "continuous";
};

export type BreakdownResult = {
  title: string;
  characters: Character[];
  frames: Frame[];
};

export type PromptSegment = {
  id: string;
  duration: number;
  prompt: string;
  // Copied from the frame when the prompts are written (storyboard grid stories).
  panel?: number;
  join?: "cut" | "continuous";
};

export type PromptRevision = {
  id: string;
  createdAt: string;
  segments: PromptSegment[];
  promptStyle?: PromptStyle;
  // Set on a copy whose spoken lines were translated (e.g. "Gujarati").
  language?: string;
};

export const STORY_STEPS = ["gist", "cast", "image", "frames", "prompts", "video"] as const;
export type StoryStep = (typeof STORY_STEPS)[number];

export function stepLabel(step: StoryStep): string {
  if (step === "gist") return "Gist";
  if (step === "cast") return "Cast";
  if (step === "image") return "Image";
  if (step === "frames") return "Frames";
  if (step === "prompts") return "Prompts";
  return "Video";
}

// The gist every later step works from: the analysis' corrected version when the
// original had a logic problem, unless the user chose to keep the original.
export function effectiveGist(story: Pick<Story, "gist" | "analysis" | "useOriginalGist">): string {
  const suggested = story.analysis && !story.analysis.logicOk ? story.analysis.suggestedGist.trim() : "";
  return suggested && !story.useOriginalGist ? suggested : story.gist;
}

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  devMode: true,
  seed: 907327329980779,
  // Veda Turbo is the fastest workflow and the default for new stories.
  engine: "veda-turbo",
  v2Megapixels: 0.3,
  v2Steps: 10,
  v2DevMegapixels: 0.3,
  v2DevSteps: 10,
  loras: [],
  onlyFirst: 0,
};

// Story V2 is proven with 3–8 s segments only (Themed Transformation Pipeline renders).
export const STORY_V2_MAX_SEGMENT_SECONDS = 8;

export const DEFAULT_IMAGE_SETTINGS: ImageSettings = {
  aspectRatio: "16:9 (Widescreen)",
  megapixels: 0.6,
  seed: 42,
};

export type Story = {
  id: string;
  title: string;
  step: StoryStep;
  gist: string;
  analysis: StoryAnalysis | null;
  useOriginalGist: boolean;
  characters: Character[];
  location: StoryLocation;
  imagePrompt: string;
  imageNegative: string;
  imageLayout: string;
  imageSettings: ImageSettings;
  referenceImages: ReferenceImage[];
  selectedImageId: string;
  videoSettings: VideoSettings;
  videos: VideoRun[];
  promptStyle: PromptStyle;
  // Include the optional H3 prompting tips (comedy, continuity, emotion…) when writing prompts.
  h3Tips: boolean;
  // OpenRouter model (or comma-separated fallback chain) for every AI step; blank = .env default.
  aiModel: string;
  // Storyboard grid: give H3 the whole grid on every segment, or only the segment's own panel.
  gridFeed: "whole" | "panels";
  // Archived stories are hidden from the story lists until unarchived.
  archived: boolean;
  frames: Frame[];
  segments: PromptSegment[];
  promptRevisions: PromptRevision[];
  activeRevisionId: string;
  createdAt: string;
  updatedAt: string;
};

export function storyRevisions(story: Story): PromptRevision[] {
  if (story.promptRevisions.length > 0) return story.promptRevisions;
  if (story.segments.length === 0) return [];
  return [
    {
      id: story.activeRevisionId || "1",
      createdAt: story.updatedAt,
      segments: story.segments,
    },
  ];
}

export type StorySummary = {
  id: string;
  title: string;
  step: StoryStep;
  createdAt: string;
  updatedAt: string;
  frameCount: number;
  segmentCount: number;
  archived: boolean;
};

export function isStoryStep(value: string): value is StoryStep {
  return STORY_STEPS.includes(value as StoryStep);
}

export function storyPath(id: string, step: StoryStep): string {
  return `/stories/${id}/${step}`;
}
