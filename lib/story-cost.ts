import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { replaceFile } from "./story-store";

// What the AI calls for each story cost, in US dollars as OpenRouter reports them (data/story-costs/<id>.json). Kept out
// of the story file so an open editor's saves never overwrite it. Counting started when this file was added.

export type StoryCost = { usd: number; calls: number; since: string; updatedAt: string };

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

export function addStoryCost(id: string, usd: number): Promise<unknown> {
  const file = costFile(id);
  if (!file || !(usd > 0)) return Promise.resolve();
  const task = (queues.get(id) || Promise.resolve()).then(async () => {
    const now = new Date().toISOString();
    const current = (await readStoryCost(id)) || { usd: 0, calls: 0, since: now, updatedAt: now };
    const next: StoryCost = { ...current, usd: current.usd + usd, calls: current.calls + 1, updatedAt: now };
    await mkdir(costsDir, { recursive: true });
    const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, JSON.stringify(next, null, 2), "utf8");
    await replaceFile(temp, file);
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
  try {
    id = (await headers()).get("x-story-id");
  } catch {
    return;
  }
  if (id) await addStoryCost(id, usd);
}

export async function removeStoryCost(id: string): Promise<void> {
  const file = costFile(id);
  if (file) await rm(file, { force: true });
}
