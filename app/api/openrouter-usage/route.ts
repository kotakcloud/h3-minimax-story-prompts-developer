import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getOpenRouterUsage, type OpenRouterUsage } from "@/lib/openrouter-usage";

export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;

// Only a successful answer is reused; a failure is retried on the next request.
let cache: { data: OpenRouterUsage | null; fetchedAt: number } = { data: null, fetchedAt: 0 };

// OpenRouter cannot reset a key's total, so "reset to 0" keeps the total at that moment (data/spend-reset.json) and the
// top bar shows what was spent since.
type SpendReset = { usage: number; at: string };
const resetFile = path.join(process.cwd(), "data", "spend-reset.json");

async function readReset(): Promise<SpendReset | null> {
  try {
    const data = JSON.parse(await readFile(resetFile, "utf8")) as SpendReset;
    return typeof data.usage === "number" && typeof data.at === "string" ? data : null;
  } catch {
    return null;
  }
}

async function usage(fresh = false): Promise<OpenRouterUsage | null> {
  const now = Date.now();
  if (!fresh && cache.data && now - cache.fetchedAt < CACHE_MS) return cache.data;
  const data = await getOpenRouterUsage(process.env.OPENROUTER_API_KEY);
  cache = { data, fetchedAt: now };
  return data;
}

// GET — the key's total (usage), its limit, and the total when the spend was last reset (resetUsage, resetAt).
export async function GET() {
  const [data, reset] = await Promise.all([usage(), readReset()]);
  if (!data) return NextResponse.json(data);
  return NextResponse.json({ ...data, resetUsage: reset?.usage ?? 0, resetAt: reset?.at ?? null });
}

// POST — resets the shown spend to 0 from now on.
export async function POST() {
  const data = await usage(true);
  if (!data) return NextResponse.json({ error: "Could not read the OpenRouter spend." }, { status: 502 });
  const reset: SpendReset = { usage: data.usage, at: new Date().toISOString() };
  await mkdir(path.dirname(resetFile), { recursive: true });
  await writeFile(resetFile, JSON.stringify(reset, null, 2), "utf8");
  return NextResponse.json({ ...data, resetUsage: reset.usage, resetAt: reset.at });
}
