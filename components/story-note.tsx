"use client";

import { useEffect, useRef, useState } from "react";

const SAVE_AFTER_MS = 700;

// A free note on a story in the story list. It saves itself a moment after you stop typing (and when you leave the box).
export function StoryNote({ storyId, initial }: { storyId: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"" | "saving" | "saved" | "failed">("");
  const saved = useRef(initial);
  const timer = useRef<number | null>(null);

  async function save(value: string) {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (value === saved.current) return;
    setState("saving");
    try {
      const response = await fetch(`/api/stories/${storyId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: value }),
      });
      if (!response.ok) throw new Error();
      saved.current = value;
      setState("saved");
    } catch {
      setState("failed");
    }
  }

  // A note still waiting when the page closes is sent anyway.
  useEffect(() => {
    const flush = () => {
      if (timer.current && text !== saved.current) {
        navigator.sendBeacon(`/api/stories/${storyId}/note`, new Blob([JSON.stringify({ note: text })], { type: "application/json" }));
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [storyId, text]);

  return (
    <label className="block">
      <span className="sr-only">Note</span>
      <textarea
        value={text}
        onChange={(event) => {
          const value = event.target.value;
          setText(value);
          setState("");
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void save(value), SAVE_AFTER_MS);
        }}
        onBlur={() => void save(text)}
        rows={text ? Math.min(6, text.split("\n").length + 1) : 1}
        maxLength={4000}
        placeholder="Note…"
        className="w-full resize-y rounded-lg border border-line bg-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent"
      />
      {state && (
        <span className={`text-xs ${state === "failed" ? "text-red-300" : "text-muted"}`}>
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Could not save the note. Type again to retry."}
        </span>
      )}
    </label>
  );
}
