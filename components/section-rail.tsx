"use client";

import { useEffect, useState } from "react";

// A column of small numbers fixed at the left edge: each scrolls to its section (by element id); the one on screen is
// lit. Hidden when there is nothing to jump between.
export function SectionRail({ ids, label = "Jump to prompt" }: { ids: string[]; label?: string }) {
  const [current, setCurrent] = useState("");
  const key = ids.join("|");

  useEffect(() => {
    const elements = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;
    // The section nearest the top third of the window is the current one.
    const update = () => {
      const line = window.innerHeight / 3;
      let best = elements[0];
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= line) best = element;
      }
      setCurrent(best.id);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [key]);

  if (ids.length < 2) return null;
  return (
    <nav
      aria-label={label}
      className="fixed left-1 top-1/2 z-30 flex max-h-[70vh] -translate-y-1/2 flex-col gap-1 overflow-y-auto rounded-full border border-line bg-card/90 p-1 shadow-lg backdrop-blur md:left-[248px] [scrollbar-width:none]"
    >
      {ids.map((id, index) => (
        <button
          key={id}
          type="button"
          onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
          aria-label={`${label} ${index + 1}`}
          aria-current={current === id ? "true" : undefined}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs ${
            current === id ? "bg-accent font-semibold text-accent-ink" : "text-muted hover:bg-background hover:text-foreground"
          }`}
        >
          {index + 1}
        </button>
      ))}
    </nav>
  );
}
