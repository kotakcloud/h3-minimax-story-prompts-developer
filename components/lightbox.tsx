"use client";

import { useEffect, useState } from "react";

export type Slide = { src: string; title: string; caption?: string };

// Full-size image viewer over the page (same behaviour as story-scene-prompter's): ← / → or the side buttons for
// previous / next, Esc or a click on the backdrop to close.
export function Lightbox({
  slides,
  index,
  onIndex,
  onClose,
}: {
  slides: Slide[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const go = (step: number) => onIndex((index + step + slides.length) % slides.length);

  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft") onIndex((index - 1 + slides.length) % slides.length);
      else if (event.key === "ArrowRight") onIndex((index + 1) % slides.length);
    }
    window.addEventListener("keydown", key);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = "";
    };
  }, [index, slides.length, onIndex, onClose]);

  const slide = slides[index];
  if (!slide) return null;
  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/90" onClick={onClose}>
      <div
        className="flex items-center gap-3 px-4 py-3 text-sm text-foreground"
        onClick={(event) => event.stopPropagation()}
      >
        <b className="truncate">{slide.title}</b>
        <span className="text-xs text-muted">
          {index + 1} / {slides.length}
        </span>
        <span className="flex-1" />
        <a href={slide.src} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
          Open original
        </a>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          className="rounded-full border border-line px-2.5 py-0.5 text-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-2 pb-4">
        {slides.length > 1 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            title="Previous (←)"
            className="shrink-0 rounded-full px-3 py-2 text-3xl text-muted hover:text-foreground"
          >
            ‹
          </button>
        )}
        <LightboxImage key={slide.src} src={slide.src} alt={slide.title} />
        {slides.length > 1 && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            title="Next (→)"
            className="shrink-0 rounded-full px-3 py-2 text-3xl text-muted hover:text-foreground"
          >
            ›
          </button>
        )}
      </div>
      {slide.caption && (
        <p className="px-4 pb-4 text-center text-xs text-muted" onClick={(event) => event.stopPropagation()}>
          {slide.caption}
        </p>
      )}
    </div>
  );
}

// Large pictures (a storyboard grid can be several MB) take a while to come from ComfyUI: say so meanwhile.
function LightboxImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative flex h-full min-w-0 flex-1 items-center justify-center">
      {!loaded && <p className="absolute text-sm text-muted">Loading…</p>}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onClick={(event) => event.stopPropagation()}
        className={`max-h-full min-w-0 max-w-full object-contain ${loaded ? "" : "opacity-0"}`}
      />
    </div>
  );
}
