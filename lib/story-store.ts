import { mkdir, readdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StepModels, Story, StoryStep, StorySummary, StoryType } from "./types";
import { RECOMMENDED_MODEL } from "./models";
import { DEFAULT_IMAGE_SETTINGS, DEFAULT_PROJECT_ID, DEFAULT_VIDEO_SETTINGS, isPromptStyle, isStoryStep, isStoryType } from "./types";

const storiesDir = path.join(process.cwd(), "data", "stories");

function emptyStory(id: string, now: string): Story {
  return {
    id,
    projectId: DEFAULT_PROJECT_ID,
    framesApproved: true,
    stepModels: {},
    note: "",
    frameInstructions: "",
    title: "Untitled story",
    titleEdited: false,
    storyType: "regular",
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
    comparisons: [],
    promptStyle: "long-take",
    h3Tips: true,
    // New stories start on the recommended model; older ones without the field keep the .env default.
    aiModel: RECOMMENDED_MODEL,
    archived: false,
    imported: null,
    gridFeed: "whole",
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
    projectId: typeof raw.projectId === "string" && raw.projectId ? raw.projectId : DEFAULT_PROJECT_ID,
    // Stories from before the approval step count as approved.
    framesApproved: raw.framesApproved !== false,
    note: typeof raw.note === "string" ? raw.note : "",
    stepModels: (() => {
      const value = raw.stepModels && typeof raw.stepModels === "object" ? (raw.stepModels as Record<string, unknown>) : {};
      const text = (item: unknown) => (typeof item === "string" && item.trim() ? item.trim() : undefined);
      return { frames: text(value.frames), prompts: text(value.prompts) };
    })(),
    frameInstructions: typeof raw.frameInstructions === "string" ? raw.frameInstructions : "",
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title : base.title,
    titleEdited: raw.titleEdited === true,
    storyType: isStoryType(raw.storyType) ? raw.storyType : "regular",
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
    comparisons: Array.isArray(raw.comparisons) ? (raw.comparisons as Story["comparisons"]) : [],
    promptStyle: isPromptStyle(raw.promptStyle) ? raw.promptStyle : base.promptStyle,
    h3Tips: raw.h3Tips !== false,
    aiModel: typeof raw.aiModel === "string" ? raw.aiModel : "",
    archived: raw.archived === true,
    imported: raw.imported && typeof raw.imported === "object" ? (raw.imported as Story["imported"]) : null,
    gridFeed: raw.gridFeed === "panels" ? "panels" : "whole",
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
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
    frameCount: story.frames.length,
    segmentCount: story.segments.length,
    archived: story.archived,
    imported: story.imported !== null,
    storyType: story.storyType,
    projectId: story.projectId,
    aiModel: story.aiModel,
    stepModels: story.stepModels,
    note: story.note,
    latestVideo: (() => {
      const run = story.videos
        .filter((item) => item.status === "done" && item.video)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return run?.video
        ? { ...run.video, createdAt: run.createdAt, devMode: run.devMode, ultraFast: Boolean(run.ultraFast), rating: run.rating || 0 }
        : null;
    })(),
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

export async function createStory(storyType: StoryType = "regular", projectId: string = DEFAULT_PROJECT_ID): Promise<Story> {
  await ensureDir();
  const now = new Date().toISOString();
  // type-1 stories give H3 only each segment's own panel of a storyboard grid unless changed.
  const story: Story = { ...emptyStory(randomUUID(), now), storyType, projectId, gridFeed: storyType === "type-1" ? "panels" : "whole" };
  await writeStory(story);
  return story;
}

// A story made from given fields (an imported video file).
export async function addStory(id: string, fields: Partial<Story>): Promise<Story> {
  await ensureDir();
  return writeStory({ ...emptyStory(id, new Date().toISOString()), ...fields, id });
}

// A copy of a story under a new id: everything but its generated videos and comparisons (their files belong to
// the original). Reference images are shared (same ComfyUI files), prompt sets and settings are copied.
// With fromFrames, the copy stops at the Frames step: no prompt sets and no note, and it opens on Prompts (to try
// another model on the same frames).
export async function duplicateStory(
  id: string,
  options: { fromFrames?: boolean; stepModels?: StepModels; title?: string } = {},
): Promise<Story | null> {
  const source = await readStory(id);
  if (!source) return null;
  const now = new Date().toISOString();
  const copy: Story = {
    ...source,
    id: randomUUID(),
    title: options.title?.trim().slice(0, 200) || `${source.title} (copy)`,
    titleEdited: options.title?.trim() ? true : source.titleEdited,
    videos: [],
    comparisons: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  if (options.stepModels) copy.stepModels = options.stepModels;
  if (options.fromFrames) {
    copy.segments = [];
    copy.promptRevisions = [];
    copy.activeRevisionId = "";
    copy.note = "";
    copy.step = "prompts";
  }
  return writeStory(copy);
}

// Windows refuses to replace a file while a reader has it open (a story list or load, for milliseconds).
export async function replaceFile(temp: string, file: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 20));
    }
  }
}

export async function writeStory(story: Story, options: { touch?: boolean } = {}): Promise<Story> {
  await ensureDir();
  const next = options.touch === false ? story : { ...story, updatedAt: new Date().toISOString() };
  const file = storyFile(next.id);
  // A unique temp name per write: overlapping saves of one story must not share a file.
  const temp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
    await replaceFile(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return next;
}

export async function updateStory(id: string, patch: Partial<Story>): Promise<Story | null> {
  const current = await readStory(id);
  if (!current) return null;
  const rest = { ...patch };
  delete rest.id;
  delete rest.createdAt;
  // Only setArchived changes this, so an open editor's autosave cannot unarchive a story.
  delete rest.archived;
  // Only setProject moves a story, so a page left open on it cannot move it back.
  delete rest.projectId;
  // Only setNote writes the note, so a page left open on the story cannot overwrite it.
  delete rest.note;
  return writeStory({
    ...current,
    ...rest,
    id: current.id,
    createdAt: current.createdAt,
  });
}

// Archiving keeps updatedAt, so an unarchived story returns to its old place in the list.
export async function setArchived(id: string, archived: boolean): Promise<Story | null> {
  const current = await readStory(id);
  if (!current) return null;
  return writeStory({ ...current, archived }, { touch: false });
}

// The story list's note; it does not count as an edit, so the story keeps its place in the list.
export async function setNote(id: string, note: string): Promise<Story | null> {
  const current = await readStory(id);
  if (!current) return null;
  return writeStory({ ...current, note }, { touch: false });
}

export async function setProject(id: string, projectId: string): Promise<Story | null> {
  const current = await readStory(id);
  if (!current) return null;
  return writeStory({ ...current, projectId }, { touch: false });
}

export async function deleteStory(id: string): Promise<boolean> {
  try {
    await unlink(storyFile(id));
    // Its comparison videos (data/comparisons/<id>) belong to it alone; ComfyUI's files are left alone.
    await rm(path.join(process.cwd(), "data", "comparisons", id), { recursive: true, force: true });
    await rm(path.join(process.cwd(), "data", "story-costs", `${id}.json`), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function withStep(story: Story, step: StoryStep): Story {
  return { ...story, step };
}
