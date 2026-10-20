const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/auth/key";

export type OpenRouterUsage = { usage: number; limit: number | null };

// Total spend (and limit, if any) on this key, straight from OpenRouter. Null on any failure.
// Only the two numbers leave this function: the key's label can contain a fragment of the key.
export async function getOpenRouterUsage(apiKey: string | undefined): Promise<OpenRouterUsage | null> {
  if (!apiKey) return null;
  try {
    const response = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { usage?: unknown; limit?: unknown } };
    const usage = body.data?.usage;
    const limit = body.data?.limit;
    if (typeof usage !== "number") return null;
    return { usage, limit: typeof limit === "number" ? limit : null };
  } catch {
    return null;
  }
}
