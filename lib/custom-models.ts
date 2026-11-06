import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MODEL_OPTIONS } from "./models";
import { replaceFile } from "./story-store";

// Models the owner typed in that are not in the built-in list, kept once a call with them succeeded
// (data/custom-models.json), so every model box offers them from then on, with their OpenRouter price.

export type CustomModel = { id: string; label: string; addedAt: string };

const file = path.join(process.cwd(), "data", "custom-models.json");
let queue: Promise<unknown> = Promise.resolve();

export async function readCustomModels(): Promise<CustomModel[]> {
  try {
    const data = JSON.parse(await readFile(file, "utf8")) as { models?: CustomModel[] };
    return Array.isArray(data.models) ? data.models.filter((model) => typeof model?.id === "string") : [];
  } catch {
    return [];
  }
}

// "~$0.30 / $2.50 per M" from OpenRouter's public model list, or a plain note when it cannot be read.
async function priceLabel(id: string): Promise<string> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000) });
    const data = (await response.json()) as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
    const pricing = data.data?.find((model) => model.id === id)?.pricing;
    const perMillion = (value?: string) => {
      const usd = Number(value) * 1_000_000;
      return Number.isFinite(usd) ? `$${usd < 0.1 ? usd.toFixed(3) : Number(usd.toFixed(2))}` : "";
    };
    const input = perMillion(pricing?.prompt);
    const output = perMillion(pricing?.completion);
    if (input && output) return `added by you, ~${input} / ${output} per M`;
  } catch {
    // No price: still offered.
  }
  return "added by you";
}

// After a successful call: adds the model to the list unless it is built in or already there.
export function rememberModel(id: string): Promise<unknown> {
  if (!id || MODEL_OPTIONS.some((option) => option.id === id)) return Promise.resolve();
  const task = queue.then(async () => {
    const models = await readCustomModels();
    if (models.some((model) => model.id === id)) return;
    const next = [...models, { id, label: await priceLabel(id), addedAt: new Date().toISOString() }];
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, JSON.stringify({ models: next }, null, 2), "utf8");
    await replaceFile(temp, file);
    console.log(`[custom-models] added ${id}`);
  });
  queue = task.catch((error) => console.log(`[custom-models] ${id}: ${error instanceof Error ? error.message : error}`));
  return queue;
}
