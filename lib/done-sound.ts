// The sound when a video is done. Browsers may keep it silent on a page nobody has clicked since it loaded.
export function playDoneSound() {
  new Audio("/notify-2.mp3").play().catch(() => {
    // Blocked by the browser, or no audio on this device.
  });
}
