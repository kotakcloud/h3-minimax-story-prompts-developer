import { useCallback, useEffect, useRef, useState } from "react";
import type { LogsResponse } from "../types";

type Options = {
  apiPath: string;
  lines: number;
  enabled: boolean; // false until the settings are known, so the first fetch asks for the right line count
  polling: boolean;
  intervalSec: number;
};

export function useComfyLogs({ apiPath, lines, enabled, polling, intervalSec }: Options) {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [fetchedAt, setFetchedAt] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  // `replace`: a new line count or API path makes a running request useless, so it is aborted. Polling ticks and the
  // Refresh button are skipped instead, so requests never overlap.
  const load = useCallback(
    async (replace = false) => {
      if (inFlight.current && !replace) return;
      inFlight.current?.abort();
      const request = new AbortController();
      inFlight.current = request;
      setLoading(true);
      try {
        const res = await fetch(`${apiPath}?lines=${lines}`, { cache: "no-store", signal: request.signal });
        const body = (await res.json().catch(() => null)) as LogsResponse | null;
        if (request.signal.aborted) return;
        if (!body) throw new Error(`Logs request failed (${res.status}).`);
        if (body.error) setError(body.error);
        else {
          setLogLines(body.lines);
          setFetchedAt(body.fetchedAt);
          setError("");
        }
      } catch (e) {
        if (!request.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (inFlight.current === request) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [apiPath, lines],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on start and on a new line count is the point
    if (enabled) void load(true);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || !polling) return;
    const timer = setInterval(() => void load(), intervalSec * 1000);
    return () => clearInterval(timer);
  }, [enabled, polling, intervalSec, load]);

  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
    },
    [],
  );

  return { lines: logLines, fetchedAt, error, loading, refresh: load };
}
