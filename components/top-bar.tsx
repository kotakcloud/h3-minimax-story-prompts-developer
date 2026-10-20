"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const REFRESH_MS = 60_000;

// Total spend on the OpenRouter key, from our own /api/openrouter-usage (the key never
// reaches the browser). Purely informational: any failure keeps the badge hidden.
function UsageBadge() {
  const [text, setText] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetch("/api/openrouter-usage")
        .then((response) => response.json())
        .then((data: { usage?: unknown; limit?: unknown } | null) => {
          if (cancelled || !data || typeof data.usage !== "number") return;
          const limit = typeof data.limit === "number" ? ` / $${data.limit.toFixed(2)}` : "";
          setText(`Spent: $${data.usage.toFixed(2)}${limit}`);
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

  return (
    <span
      hidden={!text}
      title="Total spent on this OpenRouter API key (all projects using it)"
      className="shrink-0 rounded-full border border-line px-3 py-0.5 text-xs text-muted"
    >
      {text}
    </span>
  );
}

export function TopBar() {
  return (
    <header className="topbar fixed inset-x-0 top-0 z-[45] flex items-center gap-4 border-b border-line bg-card px-5 sm:px-8">
      <Link href="/" className="mr-auto truncate text-sm font-semibold tracking-tight">
        <span className="text-accent">H3</span> Story Prompt Workshop
      </Link>
      <UsageBadge />
    </header>
  );
}
