import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Story, StorySummary } from "./types";

const storiesDir = path.join(process.cwd(), "data", "stories");

function emptyStory(id: string, now: string): Story {
  return {
    id,
    title: "Untitled story",
    step: "gist",
    gist: "",
    characters: [],
    frames: [],
    segments: [],
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
    step: raw.step === "frames" || raw.step === "prompts" || raw.step === "gist" ? raw.step : "gist",
    gist: typeof raw.gist === "string" ? raw.gist : "",
    characters: Array.isArray(raw.characters) ? (raw.characters as Story["characters"]) : [],
    frames: Array.isArray(raw.frames) ? (raw.frames as Story["frames"]) : [],
    segments: Array.isArray(raw.segments) ? (raw.segments as Story["segments"]) : [],
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
