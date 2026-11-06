"use client";

import { Money } from "@/components/money";
import { VideoQueueTicker } from "@/components/video-queue-ticker";
import Link from "next/link";
import { useEffect, useState } from "react";

const REFRESH_MS = 60_000;

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

// Spend on the OpenRouter key, from our own /api/openrouter-usage (the key never reaches the browser), counted from
// the last reset (OpenRouter's own total cannot be reset, so the reset keeps the total at that moment). Purely
// informational: any failure keeps the badge hidden.
function UsageBadge() {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/openrouter-usage")
        .then((response) => response.json())
        .then((data) => {
          const next = asSpend(data);
          if (!cancelled && next) setSpend(next);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

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
}

export function TopBar() {
  return (
    <header className="topbar fixed inset-x-0 top-0 z-[45] flex items-center gap-4 border-b border-line bg-card px-5 sm:px-8">
      <Link href="/" className="shrink-0 truncate text-sm font-semibold tracking-tight">
        <span className="text-accent">H3</span> <span className="hidden sm:inline">Story Prompt Workshop</span>
      </Link>
      <div className="flex min-w-0 flex-1">
        <VideoQueueTicker />
      </div>
      <UsageBadge />
    </header>
  );
}
