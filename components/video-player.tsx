"use client";

import { useEffect, useRef, useState, type VideoHTMLAttributes } from "react";

// A video with a Picture-in-picture button, so it keeps playing in a small floating window while the page scrolls or
// another app is in front. Browsers without picture-in-picture (Firefox) do not show the button.
export function VideoPlayer(props: VideoHTMLAttributes<HTMLVideoElement>) {
  const video = useRef<HTMLVideoElement>(null);
  const [floating, setFloating] = useState(false);
  const supported = typeof document !== "undefined" && document.pictureInPictureEnabled;

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

  async function toggle() {
    const element = video.current;
    if (!element) return;
    try {
      if (document.pictureInPictureElement === element) await document.exitPictureInPicture();
      else await element.requestPictureInPicture();
    } catch {
      // The video has not loaded yet; the next click works.
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
            title="Play in a small floating window that stays on top"
            className="rounded-full border border-line px-3 py-1 text-xs text-foreground"
          >
            {floating ? "Back to page" : "Picture in picture"}
          </button>
        </div>
      )}
    </>
  );
}
