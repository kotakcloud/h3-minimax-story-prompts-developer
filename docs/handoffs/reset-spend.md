# Handoff: a "reset spend to 0" button next to the cost in the top header

Goal: the header already shows how much has been spent (for example, an OpenRouter key's total). Add a small **↺** button
next to it. It resets the shown amount to 0 after a confirm. From then on the badge reads **Spent since reset: X**,
counted from that moment.

This already works in another project (H3 Story Prompt Workshop, Next.js). Copy that pattern here and adapt the names to
this app's existing cost badge and API route.

## How it works

- **The real total can't be reset.** The provider has no "reset usage" call. So a reset only remembers the total at that moment, the *baseline*, in a small JSON file on the server: `data/spend-reset.json`, holding `{ "usage": <total at reset>, "at": "<ISO time>" }`.
- **The shown amount** is `max(0, total - baseline)`.
- **Without the file,** the baseline is 0 and the badge shows the full total, as before.
- **Shared by every device.** The baseline lives on the server, so the phone, other tabs and the tunnel all see the same reset.
- **Undo:** to go back to the full total, delete `data/spend-reset.json`. Add it to `.gitignore` (`/data/spend-reset.json`) if `data/` isn't ignored already.

## 1. Server: the route that already returns the spend

Find the API route the header badge fetches (in the reference app, `app/api/openrouter-usage/route.ts`, which calls
OpenRouter's `GET /api/v1/auth/key` and returns `{ usage, limit }`).

1. **GET** (change): also return the baseline.
2. **POST** (new): re-read the total fresh (bypassing any cache), save it as the baseline, and return the same shape.

Reference implementation. `getOpenRouterUsage` and the 60 s cache are what that app had; keep this app's own fetch and
caching:

```ts
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
```

If this app's data folder lives somewhere else (an env var, a different root), put `spend-reset.json` there instead.

## 2. Header badge: subtract the baseline and add the ↺ button

In the header component that shows the cost (in the reference app, `components/top-bar.tsx`, `UsageBadge`):

- Keep `resetUsage` and `resetAt` from the response along with `usage` and `limit`.
- Show `Spent since reset: <usage - resetUsage>` when `resetAt` is set, otherwise `Spent: <usage> / <limit>` as before.
- Put the limit only on the full-total form; it means nothing next to a since-reset amount.
- The tooltip gives the full key total and when it was reset.
- **↺** asks for a confirm, POSTs, and shows the answer. It is disabled while the reset is in progress.

Reference (`<Money usd={…} />` is that app's money formatter; use whatever this app already uses to print amounts):

```tsx
type Spend = { usage: number; limit: number | null; resetUsage: number; resetAt: string | null };

function asSpend(data: { usage?: unknown; limit?: unknown; resetUsage?: unknown; resetAt?: unknown } | null): Spend | null {
  if (!data || typeof data.usage !== "number") return null;
  return {
    usage: data.usage,
    limit: typeof data.limit === "number" ? data.limit : null,
    resetUsage: typeof data.resetUsage === "number" ? data.resetUsage : 0,
    resetAt: typeof data.resetAt === "string" ? data.resetAt : null,
  };
}

// inside the badge component, next to the existing load/refresh logic:
const [resetting, setResetting] = useState(false);

async function reset() {
  if (!window.confirm("Reset the spend shown here to 0? It then counts from now. OpenRouter's own total is not changed.")) return;
  setResetting(true);
  try {
    const next = asSpend(await fetch("/api/openrouter-usage", { method: "POST" }).then((response) => response.json()));
    if (next) setSpend(next);
  } catch {
    // Left as it was; try again.
  } finally {
    setResetting(false);
  }
}

// render:
if (!spend) return null;
const since = spend.resetAt ? new Date(spend.resetAt).toLocaleString() : "";
return (
  <span className="flex shrink-0 items-center gap-1">
    <span
      title={[
        since ? `Spent on this OpenRouter API key since ${since} (all projects using it).` : "Total spent on this OpenRouter API key (all projects using it).",
        `Key total: $${spend.usage.toFixed(2)}${spend.limit !== null ? ` of a $${spend.limit.toFixed(2)} limit` : ""}.`,
      ].join("\n")}
      className="rounded-full border border-line px-3 py-0.5 text-xs text-muted"
    >
      Spent{since ? " since reset" : ""}: <Money usd={Math.max(0, spend.usage - spend.resetUsage)} />
      {!since && spend.limit !== null && (
        <>
          {" / "}
          <Money usd={spend.limit} />
        </>
      )}
    </span>
    <button
      type="button"
      onClick={() => void reset()}
      disabled={resetting}
      aria-label="Reset spend to 0"
      title="Reset the spend shown here to 0 (counts from now on)"
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-sm text-muted hover:text-foreground disabled:opacity-50"
    >
      ↺
    </button>
  </span>
);
```

Notes:
- **Keep the existing badge behaviour:** periodic refresh, refresh when the tab becomes visible, and staying hidden on failure. Only the reset is added.
- **Match the styling** (class names, colours) to this app's header.
- **Never send the API key to the browser.** Only the numbers.

## 3. Check it

1. Typecheck (`npx tsc --noEmit`).
2. With the app running, call `GET` on the route. It should return `resetUsage: 0, resetAt: null` while no file exists.
3. **Don't press reset or POST to the route without the owner's OK.** A reset changes what they see, and the only undo is deleting the file. If you do test it with their OK, check that the badge shows about 0 afterwards and that `data/spend-reset.json` was written.
4. Check the header still fits on a narrow (phone-width) window.

## 4. Docs

Add a short note to `usage.md` (and `README.md` if the project keeps one). It should say:

- **↺** resets the shown spend to 0 after a confirm, and the badge then says *Spent since reset*;
- the provider's real total is unchanged;
- the baseline is kept in `data/spend-reset.json`, and deleting that file goes back to the full total;
- hovering the badge shows the full total and when it was reset.

Commit when verified; don't push.
