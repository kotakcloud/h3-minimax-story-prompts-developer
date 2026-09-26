export type Character = {
  id: string;
  name: string;
  look: string;
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

export const STORY_STEPS = ["gist", "frames", "prompts"] as const;
export type StoryStep = (typeof STORY_STEPS)[number];

export type Story = {
  id: string;
  title: string;
  step: StoryStep;
  gist: string;
  characters: Character[];
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
