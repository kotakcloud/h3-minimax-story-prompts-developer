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
