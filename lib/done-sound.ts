// A short rising chime when a video is done. Browsers may keep it silent on a page nobody has clicked since it loaded.
export function playDoneSound() {
  try {
    const context = new AudioContext();
    [660, 880, 1175].forEach((frequency, index) => {
      const start = context.currentTime + index * 0.18;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.4);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.42);
    });
    window.setTimeout(() => void context.close(), 1500);
  } catch {
    // No audio on this device.
  }
}
