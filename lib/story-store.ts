import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Story, StoryStep, StorySummary } from "./types";
import { DEFAULT_IMAGE_SETTINGS, DEFAULT_VIDEO_SETTINGS, isPromptStyle, isStoryStep } from "./types";

const storiesDir = path.join(process.cwd(), "data", "stories");

function emptyStory(id: string, now: string): Story {
  return {
    id,
    title: "Untitled story",
    step: "gist",
    gist: "",
    analysis: null,
    useOriginalGist: false,
    characters: [],
    location: { name: "", description: "", generated: false },
    imagePrompt: "",
    imageNegative: "",
    imageLayout: "",
    imageSettings: { ...DEFAULT_IMAGE_SETTINGS },
    referenceImages: [],
    selectedImageId: "",
    videoSettings: { ...DEFAULT_VIDEO_SETTINGS },
    videos: [],
    promptStyle: "long-take",
    h3Tips: true,
    aiModel: "",
    frames: [],
    segments: [],
    promptRevisions: [],
    activeRevisionId: "",
    createdAt: now,
    updatedAt: now,
  };
}

async function ensureDir() {
  await mkdir(storiesDir, { recursive: true });
}

function storyFile(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error("Invalid story id.");
  }
  return path.join(storiesDir, `${id}.json`);
}

function asStory(value: unknown, fallbackId: string): Story {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const now = new Date().toISOString();
  const base = emptyStory(fallbackId, now);
  return {
    ...base,
    ...raw,
    id: typeof raw.id === "string" ? raw.id : fallbackId,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : base.title,
    step: typeof raw.step === "string" && isStoryStep(raw.step) ? raw.step : "gist",
    gist: typeof raw.gist === "string" ? raw.gist : "",
    analysis: raw.analysis && typeof raw.analysis === "object" ? (raw.analysis as Story["analysis"]) : null,
    useOriginalGist: raw.useOriginalGist === true,
    characters: Array.isArray(raw.characters) ? (raw.characters as Story["characters"]) : [],
    location:
      raw.location && typeof raw.location === "object"
        ? { ...base.location, ...(raw.location as Story["location"]) }
        : base.location,
    imagePrompt: typeof raw.imagePrompt === "string" ? raw.imagePrompt : "",
    imageNegative: typeof raw.imageNegative === "string" ? raw.imageNegative : "",
    imageLayout: typeof raw.imageLayout === "string" ? raw.imageLayout : "",
    imageSettings:
      raw.imageSettings && typeof raw.imageSettings === "object"
        ? { ...base.imageSettings, ...(raw.imageSettings as Story["imageSettings"]) }
        : base.imageSettings,
    referenceImages: Array.isArray(raw.referenceImages)
      ? (raw.referenceImages as Story["referenceImages"])
      : [],
    selectedImageId: typeof raw.selectedImageId === "string" ? raw.selectedImageId : "",
    videoSettings:
      raw.videoSettings && typeof raw.videoSettings === "object"
        ? { ...base.videoSettings, ...(raw.videoSettings as Story["videoSettings"]) }
        : base.videoSettings,
    videos: Array.isArray(raw.videos) ? (raw.videos as Story["videos"]) : [],
    promptStyle: isPromptStyle(raw.promptStyle) ? raw.promptStyle : base.promptStyle,
    h3Tips: raw.h3Tips !== false,
    aiModel: typeof raw.aiModel === "string" ? raw.aiModel : "",
    frames: Array.isArray(raw.frames) ? (raw.frames as Story["frames"]) : [],
    segments: Array.isArray(raw.segments) ? (raw.segments as Story["segments"]) : [],
    promptRevisions: Array.isArray(raw.promptRevisions)
      ? (raw.promptRevisions as Story["promptRevisions"])
      : [],
    activeRevisionId: typeof raw.activeRevisionId === "string" ? raw.activeRevisionId : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
}

function toSummary(story: Story): StorySummary {
  return {
    id: story.id,
    title: story.title,
    step: story.step,
    updatedAt: story.updatedAt,
    frameCount: story.frames.length,
    segmentCount: story.segments.length,
  };
}

export async function listStories(): Promise<StorySummary[]> {
  await ensureDir();
  const names = await readdir(storiesDir);
  const stories = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map(async (name) => {
        const id = name.replace(/\.json$/, "");
        const story = await readStory(id);
        return story ? toSummary(story) : null;
      }),
  );
  return stories
    .filter((item): item is StorySummary => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readStory(id: string): Promise<Story | null> {
  await ensureDir();
  try {
    const text = await readFile(storyFile(id), "utf8");
    return asStory(JSON.parse(text), id);
  } catch {
    return null;
  }
}

export async function createStory(): Promise<Story> {
  await ensureDir();
  const now = new Date().toISOString();
  const story = emptyStory(randomUUID(), now);
  await writeStory(story);
  return story;
}

export async function writeStory(story: Story): Promise<Story> {
  await ensureDir();
  const next = { ...story, updatedAt: new Date().toISOString() };
  const file = storyFile(next.id);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
  await rename(temp, file);
  return next;
}

export async function updateStory(id: string, patch: Partial<Story>): Promise<Story | null> {
  const current = await readStory(id);
  if (!current) return null;
  const rest = { ...patch };
  delete rest.id;
  delete rest.createdAt;
  return writeStory({
    ...current,
    ...rest,
    id: current.id,
    createdAt: current.createdAt,
  });
}

export async function deleteStory(id: string): Promise<boolean> {
  try {
    await unlink(storyFile(id));
    return true;
  } catch {
    return false;
  }
}

export function withStep(story: Story, step: StoryStep): Story {
  return { ...story, step };
}
