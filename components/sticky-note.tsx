"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadUiPrefs, patchStickyNote } from "@/lib/ui-prefs";

const ICON = 40;
const ICON_INSET = 20;
const DRAG_THRESHOLD = 5;
const PAD_RATIO = 0.8;
const PAD_MIN_W = 280;
const PAD_MIN_H = 160;
const VIEW_MARGIN = 8;

type Point = { x: number; y: number };
type Size = { width: number; height: number };

function defaultPark(): Point {
  return {
    x: Math.max(ICON_INSET, window.innerWidth - ICON - ICON_INSET),
    y: Math.max(ICON_INSET, window.innerHeight - ICON - ICON_INSET),
  };
}

function wasDragged(x: number, y: number) {
  return x !== 0 || y !== 0;
}

function clampIcon(x: number, y: number): Point {
  return {
    x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - ICON)),
    y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - ICON)),
  };
}

function padSize(): Size {
  const maxW = Math.max(0, window.innerWidth - VIEW_MARGIN * 2);
  const maxH = Math.max(0, window.innerHeight - VIEW_MARGIN * 2);
  return {
    width: Math.min(maxW, Math.max(PAD_MIN_W, window.innerWidth * PAD_RATIO)),
    height: Math.min(maxH, Math.max(PAD_MIN_H, window.innerHeight * PAD_RATIO)),
  };
}

function placePad(icon: Point, size: Size): Point {
  const maxX = Math.max(VIEW_MARGIN, window.innerWidth - size.width - VIEW_MARGIN);
  const maxY = Math.max(VIEW_MARGIN, window.innerHeight - size.height - VIEW_MARGIN);
  let x = icon.x;
  if (x + size.width > window.innerWidth - VIEW_MARGIN) {
    x = icon.x + ICON - size.width;
  }
  x = Math.min(Math.max(VIEW_MARGIN, x), maxX);

  let y = icon.y + ICON + VIEW_MARGIN;
  if (y + size.height > window.innerHeight - VIEW_MARGIN) {
    y = icon.y - size.height - VIEW_MARGIN;
  }
  y = Math.min(Math.max(VIEW_MARGIN, y), maxY);
  return { x, y };
}

function NoteGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M7 3.75h8.2L20.25 8.8V20.25H7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M15.2 3.75V8.8h5.05" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 12.25h6M10 15.75h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function StickyNote() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [icon, setIcon] = useState<Point>({ x: 0, y: 0 });
  const [pad, setPad] = useState<Point & Size>({ x: 0, y: 0, width: 0, height: 0 });
  const [savedText, setSavedText] = useState("");
  const [draft, setDraft] = useState("");
  const [dragging, setDragging] = useState(false);

  const iconRef = useRef(icon);
  const openRef = useRef(open);
  const storedPos = useRef({ x: 0, y: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const gesture = useRef({
    pointerId: -1,
    startClientX: 0,
    startClientY: 0,
    originX: 0,
    originY: 0,
    dragged: false,
    active: false,
  });

  iconRef.current = icon;
  openRef.current = open;

  const layoutPad = useCallback((nextIcon: Point) => {
    const size = padSize();
    const next = placePad(nextIcon, size);
    setPad({ ...next, ...size });
  }, []);

  const placeIcon = useCallback(
    (x: number, y: number) => {
      const next = wasDragged(x, y) ? clampIcon(x, y) : defaultPark();
      setIcon(next);
      layoutPad(next);
      return next;
    },
    [layoutPad],
  );

  useEffect(() => {
    const prefs = loadUiPrefs();
    storedPos.current = { x: prefs.stickyNote.x, y: prefs.stickyNote.y };
    setSavedText(prefs.stickyNote.text);
    setDraft(prefs.stickyNote.text);
    placeIcon(prefs.stickyNote.x, prefs.stickyNote.y);
    setReady(true);
  }, [placeIcon]);

  useEffect(() => {
    if (!ready) return;
    function onResize() {
      const { x, y } = storedPos.current;
      placeIcon(x, y);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [placeIcon, ready]);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  function persistPosition(next: Point) {
    storedPos.current = next;
    patchStickyNote({ x: next.x, y: next.y });
  }

  function toggleOpen() {
    setOpen((current) => {
      const next = !current;
      if (next) layoutPad(iconRef.current);
      return next;
    });
  }

  function moveFromPointer(clientX: number, clientY: number) {
    const current = gesture.current;
    const dx = clientX - current.startClientX;
    const dy = clientY - current.startClientY;
    if (!current.dragged && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    current.dragged = true;
    setDragging(true);
    const next = clampIcon(current.originX + dx, current.originY + dy);
    iconRef.current = next;
    setIcon(next);
    if (openRef.current) layoutPad(next);
  }

  function endGesture(clientX: number, clientY: number, pointerId?: number) {
    const current = gesture.current;
    if (!current.active) return;
    if (pointerId != null && current.pointerId !== pointerId) return;
    moveFromPointer(clientX, clientY);
    const button = buttonRef.current;
    if (button && current.pointerId >= 0 && button.hasPointerCapture(current.pointerId)) {
      button.releasePointerCapture(current.pointerId);
    }
    if (current.dragged) {
      persistPosition(iconRef.current);
    }
    current.active = false;
    current.pointerId = -1;
    setDragging(false);
    window.setTimeout(() => {
      current.dragged = false;
    }, 0);
  }

  useEffect(() => {
    function onWindowPointerMove(event: PointerEvent) {
      if (!gesture.current.active) return;
      if (event.pointerId !== gesture.current.pointerId) return;
      moveFromPointer(event.clientX, event.clientY);
    }
    function onWindowPointerUp(event: PointerEvent) {
      endGesture(event.clientX, event.clientY, event.pointerId);
    }
    function onWindowMouseMove(event: MouseEvent) {
      if (!gesture.current.active) return;
      moveFromPointer(event.clientX, event.clientY);
    }
    function onWindowMouseUp(event: MouseEvent) {
      endGesture(event.clientX, event.clientY);
    }
    window.addEventListener("pointermove", onWindowPointerMove);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, [layoutPad]);

  function beginGesture(clientX: number, clientY: number, pointerId: number, target: HTMLButtonElement) {
    gesture.current = {
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      originX: iconRef.current.x,
      originY: iconRef.current.y,
      dragged: false,
      active: true,
    };
    if (pointerId >= 0) {
      target.setPointerCapture(pointerId);
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    beginGesture(event.clientX, event.clientY, event.pointerId, event.currentTarget);
  }

  function onMouseDown(event: React.MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    if (gesture.current.active) return;
    beginGesture(event.clientX, event.clientY, -1, event.currentTarget);
  }

  function onClick(event: React.MouseEvent<HTMLButtonElement>) {
    if (gesture.current.dragged) {
      event.preventDefault();
      gesture.current.dragged = false;
      return;
    }
    toggleOpen();
  }

  function saveDraft() {
    setSavedText(draft);
    patchStickyNote({ text: draft });
  }

  if (!ready) return null;

  const dirty = draft !== savedText;

  return createPortal(
    <div className="pointer-events-none">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Note"
        aria-expanded={open}
        onPointerDown={onPointerDown}
        onMouseDown={onMouseDown}
        onClick={onClick}
        className={`pointer-events-auto fixed z-[81] flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg select-none touch-none ${
          dragging ? "cursor-grabbing" : "cursor-grab"
        } ${
          open
            ? "border-accent bg-accent text-accent-ink"
            : "border-line bg-card text-foreground"
        }`}
        style={{ left: icon.x, top: icon.y }}
      >
        <NoteGlyph />
      </button>

      {open && (
        <section
          aria-label="note"
          className="pointer-events-auto fixed z-[80] flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl"
          style={{ left: pad.x, top: pad.y, width: pad.width, height: pad.height }}
        >
          <header className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
            <p className="text-xs uppercase tracking-[0.18em] text-muted">note</p>
            <button
              type="button"
              onClick={saveDraft}
              disabled={!dirty}
              className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background"
            >
              Save
            </button>
          </header>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Scratch notes stay here. They are not part of a story."
            className="min-h-0 flex-1 resize-none bg-background px-3 py-2 text-sm leading-6 outline-none"
          />
        </section>
      )}
    </div>,
    document.body,
  );
}
