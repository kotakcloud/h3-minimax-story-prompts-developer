import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { replaceFile } from "./story-store";
import { STORY_STEPS, isStoryStep, type StoryStep } from "./types";

// What the AI calls for each story cost, in US dollars as OpenRouter reports them (data/story-costs/<id>.json). Kept out
// of the story file so an open editor's saves never overwrite it. Counting started when this file was added.

export type StepCost = { usd: number; calls: number };
// byStep: the same calls split by the step that made them (counted from when the split was added, so older calls are
// only in the totals). copiedFrom: a story branched from another one starts with that story's costs up to Frames.
export type StoryCost = {
  usd: number;
  calls: number;
  since: string;
  updatedAt: string;
  byStep?: Partial<Record<StoryStep, StepCost>>;
  copiedFrom?: string;
  // The last step whose costs the copy took over.
  copiedUpTo?: StoryStep;
};

const costsDir = path.join(process.cwd(), "data", "story-costs");
// One write at a time per story: calls for the same story can finish together.
const queues = new Map<string, Promise<unknown>>();

function costFile(id: string): string | null {
  return /^[a-zA-Z0-9_-]+$/.test(id) ? path.join(costsDir, `${id}.json`) : null;
}

export async function readStoryCost(id: string): Promise<StoryCost | null> {
  const file = costFile(id);
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as StoryCost;
  } catch {
    return null;
  }
}

async function saveStoryCost(file: string, cost: StoryCost) {
  await mkdir(costsDir, { recursive: true });
  const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(cost, null, 2), "utf8");
  await replaceFile(temp, file);
}

export function addStoryCost(id: string, usd: number, step?: StoryStep | null): Promise<unknown> {
  const file = costFile(id);
  if (!file || !(usd > 0)) return Promise.resolve();
  const task = (queues.get(id) || Promise.resolve()).then(async () => {
    const now = new Date().toISOString();
    const current = (await readStoryCost(id)) || { usd: 0, calls: 0, since: now, updatedAt: now };
    const next: StoryCost = { ...current, usd: current.usd + usd, calls: current.calls + 1, updatedAt: now };
    if (step) {
      const before = current.byStep?.[step] || { usd: 0, calls: 0 };
      next.byStep = { ...current.byStep, [step]: { usd: before.usd + usd, calls: before.calls + 1 } };
    }
    await saveStoryCost(file, next);
  });
  const settled = task.catch((error) => console.log(`[story-cost] ${id}: ${error instanceof Error ? error.message : error}`));
  queues.set(id, settled);
  return settled;
}

// Adds a call's cost to the story the browser named in its X-Story-Id header (pages of one story send it). Calls made
// outside a request, or without the header, are not counted.
export async function recordCost(usd: unknown): Promise<void> {
  if (typeof usd !== "number" || !(usd > 0)) return;
  let id: string | null = null;
  let step: StoryStep | null = null;
  try {
    const list = await headers();
    id = list.get("x-story-id");
    const named = list.get("x-story-step") || "";
    step = isStoryStep(named) ? named : null;
  } catch {
    return;
  }
  if (id) await addStoryCost(id, usd, step);
}

// A copy of a story starts with what the source's steps it kept cost (the part of the source's costs counted per step;
// calls from before that split stay with the source only).
export async function copyCostUpTo(sourceId: string, copyId: string, upTo: StoryStep): Promise<void> {
  const file = costFile(copyId);
  const source = await readStoryCost(sourceId);
  if (!file || !source?.byStep) return;
  const steps = STORY_STEPS.slice(0, STORY_STEPS.indexOf(upTo) + 1);
  const byStep: Partial<Record<StoryStep, StepCost>> = {};
  for (const step of steps) {
    const cost = source.byStep[step];
    if (cost && cost.usd > 0) byStep[step] = { ...cost };
  }
  const usd = Object.values(byStep).reduce((sum, cost) => sum + (cost?.usd ?? 0), 0);
  const calls = Object.values(byStep).reduce((sum, cost) => sum + (cost?.calls ?? 0), 0);
  if (!(usd > 0)) return;
  const now = new Date().toISOString();
  await saveStoryCost(file, { usd, calls, since: now, updatedAt: now, byStep, copiedFrom: sourceId, copiedUpTo: upTo });
}

export async function removeStoryCost(id: string): Promise<void> {
  const file = costFile(id);
  if (file) await rm(file, { force: true });
}
