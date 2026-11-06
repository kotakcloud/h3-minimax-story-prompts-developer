"use client";

import { useEffect, useRef, useState, type VideoHTMLAttributes } from "react";

// Chrome and Brave: an always-on-top window of its own, which stays open while you switch browser tabs.
type DocumentPip = {
  window: Window | null;
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};

function documentPip(): DocumentPip | null {
  return typeof window !== "undefined" && "documentPictureInPicture" in window
    ? ((window as unknown as { documentPictureInPicture: DocumentPip }).documentPictureInPicture)
    : null;
}

// Width of the floating window; the height follows the video.
const FLOAT_WIDTH = 480;

// Set once this browser refuses the floating window (the Claude app's browser pane does), for every player on the page.
let windowRefused = false;

// A video with a Picture-in-picture button, so it keeps playing in a small floating window while you scroll, switch
// tabs or use another app. Where the browser has document picture-in-picture (Chrome, Brave, Edge) a copy of the video
// plays in that window and hands its position back when the window closes; otherwise, or when the browser refuses the
// window (embedded browsers do), the video's own picture-in-picture is used. Browsers with neither (Firefox) do not
// show the button.
// onFloat: called when the video goes into picture in picture (the floating window keeps playing when the page moves on).
export function VideoPlayer({ onFloat, ...props }: VideoHTMLAttributes<HTMLVideoElement> & { onFloat?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [floating, setFloating] = useState(false);
  const [retry, setRetry] = useState(false);
  const supported = typeof document !== "undefined" && (documentPip() !== null || document.pictureInPictureEnabled);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const enter = () => setFloating(true);
    const leave = () => setFloating(false);
    element.addEventListener("enterpictureinpicture", enter);
    element.addEventListener("leavepictureinpicture", leave);
    return () => {
      element.removeEventListener("enterpictureinpicture", enter);
      element.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  async function floatWindow(pip: DocumentPip, element: HTMLVideoElement) {
    const ratio = element.videoWidth && element.videoHeight ? element.videoHeight / element.videoWidth : 9 / 16;
    const win = await pip.requestWindow({ width: FLOAT_WIDTH, height: Math.round(FLOAT_WIDTH * ratio) });
    win.document.title = document.title;
    win.document.body.style.cssText = "margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh";
    const copy = win.document.createElement("video");
    copy.controls = true;
    copy.style.cssText = "width:100%;height:100%;object-fit:contain";
    const playing = !element.paused;
    const start = element.currentTime;
    element.pause();
    copy.src = element.currentSrc;
    copy.addEventListener(
      "loadedmetadata",
      () => {
        copy.currentTime = start;
        if (playing) void copy.play().catch(() => {});
      },
      { once: true },
    );
    win.document.body.append(copy);
    setFloating(true);
    onFloat?.();
    // Closed by its own button, by Back to page, or by another video taking the window.
    win.addEventListener("pagehide", () => {
      element.currentTime = copy.currentTime;
      setFloating(false);
    });
  }

  async function toggle() {
    const element = video.current;
    if (!element) return;
    const pip = windowRefused ? null : documentPip();
    setRetry(false);
    try {
      if (pip && floating && pip.window) {
        pip.window.close();
      } else if (pip && !floating) {
        // A refused window uses up the click, so the video's own picture-in-picture waits for the next one.
        await floatWindow(pip, element).catch(() => {
          windowRefused = true;
          setRetry(true);
        });
      } else if (document.pictureInPictureElement === element) {
        await document.exitPictureInPicture();
      } else {
        await element.requestPictureInPicture();
        onFloat?.();
      }
    } catch {
      // The video has not loaded yet, or the browser refused; the next click tries again.
    }
  }

  return (
    <>
      <video ref={video} controls {...props} />
      {supported && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={() => void toggle()}
            title="Play in a small floating window that stays on top, also when you switch tabs"
            className="rounded-full border border-line px-3 py-1 text-xs text-foreground"
          >
            {floating ? "Back to page" : retry ? "Click again" : "Picture in picture"}
          </button>
        </div>
      )}
    </>
  );
}
