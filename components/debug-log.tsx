"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Icons } from "@/components/icons";

export type DebugStatus = "waiting" | "ok" | "error";

export type DebugEntry = {
  id: string;
  at: number;
  method: string;
  url: string;
  status: DebugStatus;
  statusCode?: number;
  durationMs?: number;
  message?: string;
};

type DebugLogContextValue = {
  entries: DebugEntry[];
  logStart: (method: string, url: string) => string;
  logEnd: (
    id: string,
    patch: Pick<DebugEntry, "status"> &
      Partial<Pick<DebugEntry, "statusCode" | "durationMs" | "message">>,
  ) => void;
  clear: () => void;
};

const DebugLogContext = createContext<DebugLogContextValue | null>(null);

function shortUrl(url: string) {
  try {
    const parsed = new URL(url, "http://local");
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

export function DebugLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<DebugEntry[]>([]);

  const logStart = useCallback((method: string, url: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setEntries((current) =>
      [
        {
          id,
          at: Date.now(),
          method: method.toUpperCase(),
          url,
          status: "waiting" as const,
        },
        ...current,
      ].slice(0, 80),
    );
    return id;
  }, []);

  const logEnd = useCallback<DebugLogContextValue["logEnd"]>((id, patch) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const value = useMemo(
    () => ({ entries, logStart, logEnd, clear }),
    [entries, logStart, logEnd, clear],
  );

  return <DebugLogContext.Provider value={value}>{children}</DebugLogContext.Provider>;
}

export function useDebugLog() {
  const context = useContext(DebugLogContext);
  if (!context) {
    throw new Error("useDebugLog must be used inside DebugLogProvider.");
  }
  return context;
}

export function useLoggedFetch() {
  const { logStart, logEnd } = useDebugLog();

  return useCallback(
    async (url: string, init?: RequestInit) => {
      const id = logStart(init?.method || "GET", url);
      const started = Date.now();
      try {
        const response = await fetch(url, init);
        logEnd(id, {
          status: response.ok ? "ok" : "error",
          statusCode: response.status,
          durationMs: Date.now() - started,
          message: response.ok ? undefined : `HTTP ${response.status}`,
        });
        return response;
      } catch (error) {
        logEnd(id, {
          status: "error",
          durationMs: Date.now() - started,
          message: error instanceof Error ? error.message : "Request failed.",
        });
        throw error;
      }
    },
    [logStart, logEnd],
  );
}

function formatTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number | undefined, waitingSince: number, now: number) {
  const value = ms ?? Math.max(0, now - waitingSince);
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function DebugLogFooter() {
  const { entries, clear } = useDebugLog();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const waiting = entries.filter((entry) => entry.status === "waiting").length;

  useEffect(() => {
    if (waiting === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [waiting]);

  return (
    <footer className="fixed inset-x-0 bottom-0 z-[70] border-t border-line bg-card/95 backdrop-blur">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs"
      >
        <span className="font-medium tracking-wide">Debug logs</span>
        <span className="text-muted">
          {waiting > 0 ? `${waiting} waiting · ` : ""}
          {entries.length} {entries.length === 1 ? "call" : "calls"}
          {open ? " · Hide" : " · Show"}
        </span>
      </button>
      {open && (
        <div className="border-t border-line">
          <div className="flex items-center justify-between px-4 py-2">
            <p className="text-xs text-muted">API calls from this browser tab.</p>
            <button
              type="button"
              onClick={clear}
              title="Clear logs"
              aria-label="Clear logs"
              className="inline-flex h-7 w-7 items-center justify-center text-muted hover:text-foreground"
            >
              {Icons.trash}
            </button>
          </div>
          <ol className="max-h-56 overflow-y-auto px-4 pb-3 font-mono text-xs leading-5">
            {entries.length === 0 ? (
              <li className="text-muted">No API calls yet.</li>
            ) : (
              entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap gap-x-3 gap-y-1 border-b border-line/70 py-1.5">
                  <span className="text-muted">{formatTime(entry.at)}</span>
                  <span>{entry.method}</span>
                  <span className="min-w-0 break-all">{shortUrl(entry.url)}</span>
                  <span
                    className={
                      entry.status === "waiting"
                        ? "text-accent"
                        : entry.status === "error"
                          ? "text-red-300"
                          : "text-muted"
                    }
                  >
                    {entry.status === "waiting"
                      ? "waiting"
                      : entry.statusCode
                        ? `${entry.status} ${entry.statusCode}`
                        : entry.status}
                  </span>
                  <span className="text-muted">
                    {formatDuration(entry.durationMs, entry.at, now)}
                  </span>
                  {entry.message && <span className="text-red-300">{entry.message}</span>}
                </li>
              ))
            )}
          </ol>
        </div>
      )}
    </footer>
  );
}
