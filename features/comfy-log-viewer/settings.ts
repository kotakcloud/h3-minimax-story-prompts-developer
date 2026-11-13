import type { Dock, IntervalSec, LineCount, ViewerSettings, WindowState } from "./types";

export const INTERVAL_OPTIONS: readonly IntervalSec[] = [5, 10, 30];
export const LINE_OPTIONS: readonly LineCount[] = [5, 10];
export const WINDOW_STATES: readonly WindowState[] = ["normal", "minimized", "maximized"];
export const DOCKS: readonly Dock[] = ["left", "center", "right"];

export const DEFAULT_SETTINGS: ViewerSettings = {
  autoReload: false,
  intervalSec: 5,
  lines: 10,
  windowState: "normal",
  dock: "right",
};

// The strict schema: the known keys and the values each may have.
const ALLOWED: { [K in keyof ViewerSettings]: readonly ViewerSettings[K][] } = {
  autoReload: [true, false],
  intervalSec: INTERVAL_OPTIONS,
  lines: LINE_OPTIONS,
  windowState: WINDOW_STATES,
  dock: DOCKS,
};

// Keeps only known keys with allowed values; anything else is dropped. Used on the PUT body, the settings file and the
// localStorage cache, so none of them can put a bad value into the window.
export function sanitizeSettings(value: unknown): Partial<ViewerSettings> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const clean: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(ALLOWED))
    if ((allowed as readonly unknown[]).includes(input[key])) clean[key] = input[key];
  return clean as Partial<ViewerSettings>;
}
