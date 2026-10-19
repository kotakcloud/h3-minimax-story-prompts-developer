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
};

export type VideoSettings = {
  devMode: boolean;
  seed: number;
};

export type VideoRunStatus = "queued" | "running" | "done" | "error";

export type VideoRun = {
  id: string;
  promptId: string;
  project: string;
  devMode: boolean;
  seed: number;
  segmentCount: number;
  revisionId: string;
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
};

export type PromptRevision = {
  id: string;
  createdAt: string;
  segments: PromptSegment[];
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
};

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
  updatedAt: string;
  frameCount: number;
  segmentCount: number;
};

export function isStoryStep(value: string): value is StoryStep {
  return STORY_STEPS.includes(value as StoryStep);
}

export function storyPath(id: string, step: StoryStep): string {
  return `/stories/${id}/${step}`;
}
