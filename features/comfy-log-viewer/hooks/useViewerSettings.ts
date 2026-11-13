import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { sanitizeSettings } from "../settings";
import type { SettingsResponse, ViewerSettings } from "../types";

const CACHE_KEY = "comfy-log-viewer:settings";
const SAVE_DELAY_MS = 300;

function readCache(): Partial<ViewerSettings> {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"));
  } catch {
    return {};
  }
}

function writeCache(settings: ViewerSettings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(settings));
  } catch {
    // private window or blocked storage: the server copy still works
  }
}

// Settings live on the server. localStorage mirrors them, so the window opens in the right state before the server
// answers (`ready` turns true before the first paint); the server's values then replace the cache.
export function useViewerSettings(defaults: ViewerSettings, settingsApiPath: string) {
  const [settings, setSettings] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const pending = useRef<Partial<ViewerSettings>>({}); // changed, not saved yet
  const touched = useRef(new Set<keyof ViewerSettings>()); // changed here since load: beats a late server answer
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser, read before first paint
    setSettings((s) => ({ ...s, ...readCache() }));
    setReady(true);
  }, []);

  useEffect(() => {
    let stop = false;
    fetch(settingsApiPath, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as SettingsResponse;
        if (stop) return;
        const saved = sanitizeSettings(Object.fromEntries(body.savedKeys.map((k) => [k, body[k]])));
        setSettings((current) => {
          const next = { ...defaults, ...saved };
          for (const key of touched.current) Object.assign(next, { [key]: current[key] });
          return next;
        });
      })
      .catch(() => {}); // server unreachable: stay on the cached values
    return () => {
      stop = true;
    };
  }, [settingsApiPath, defaults]);

  useEffect(() => {
    if (ready) writeCache(settings);
  }, [ready, settings]);

  const flush = useCallback(
    async (leaving = false) => {
      clearTimeout(timer.current);
      const patch = pending.current;
      if (!Object.keys(patch).length) return;
      pending.current = {};
      try {
        const res = await fetch(settingsApiPath, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          keepalive: leaving, // finishes even if the page is going away
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveFailed(false);
      } catch {
        pending.current = { ...patch, ...pending.current }; // sent again with the next change
        setSaveFailed(true);
      }
    },
    [settingsApiPath],
  );

  // A change inside the debounce window must not be lost when the page reloads or the component goes away.
  useEffect(() => {
    const leave = () => void flush(true);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [flush]);

  const update = useCallback(
    (patch: Partial<ViewerSettings>) => {
      for (const key of Object.keys(patch)) touched.current.add(key as keyof ViewerSettings);
      pending.current = { ...pending.current, ...patch };
      setSettings((s) => ({ ...s, ...patch }));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  return { settings, ready, saveFailed, update };
}
