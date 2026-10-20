import { NextResponse } from "next/server";
import { getOpenRouterUsage, type OpenRouterUsage } from "@/lib/openrouter-usage";

export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;

// Only a successful answer is reused; a failure is retried on the next request.
let cache: { data: OpenRouterUsage | null; fetchedAt: number } = { data: null, fetchedAt: 0 };

export async function GET() {
  const now = Date.now();
  if (cache.data && now - cache.fetchedAt < CACHE_MS) {
    return NextResponse.json(cache.data);
  }
  const data = await getOpenRouterUsage(process.env.OPENROUTER_API_KEY);
  cache = { data, fetchedAt: now };
  return NextResponse.json(data);
}
