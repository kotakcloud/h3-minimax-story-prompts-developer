"use client";

import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useComfyLogs } from "./hooks/useComfyLogs";
import { useViewerSettings } from "./hooks/useViewerSettings";
import { DEFAULT_SETTINGS, DOCKS, INTERVAL_OPTIONS, LINE_OPTIONS } from "./settings";
import styles from "./ComfyLogViewer.module.css";
import type { ComfyLogViewerProps, Dock, IntervalSec, LineCount } from "./types";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      {children}
    </svg>
  );
}

// A little window with a bar on the side it docks to.
const DOCK_BAR: Record<Dock, string> = { left: "M4 11h3", center: "M6.5 11h3", right: "M9 11h3" };

function WindowButton(props: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={styles.windowButton}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation(); // a click on the minimized bar itself restores it
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

// A small floating terminal with the last lines of the ComfyUI log. See README.md.
export function ComfyLogViewer({
  defaultLines = DEFAULT_SETTINGS.lines,
  defaultInterval = DEFAULT_SETTINGS.intervalSec,
  apiPath = "/api/comfy-logs",
  settingsApiPath = "/api/comfy-logs/settings",
  className,
  title = "ComfyUI Logs",
}: ComfyLogViewerProps) {
  const defaults = useMemo(() => ({ ...DEFAULT_SETTINGS, lines: defaultLines, intervalSec: defaultInterval }), [defaultLines, defaultInterval]);
  const { settings, ready, saveFailed, update } = useViewerSettings(defaults, settingsApiPath);
  const { windowState, dock, autoReload, intervalSec, lines } = settings;
  const minimized = windowState === "minimized";
  const maximized = windowState === "maximized";

  const logs = useComfyLogs({ apiPath, lines, enabled: ready, polling: autoReload && !minimized, intervalSec });

  // Follow the end of the log, but only when there is something new: an unchanged reload must not move the scroll.
  const body = useRef<HTMLPreElement>(null);
  const text = logs.lines.join("\n");
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [text, windowState]);

  if (!ready) return null; // the portal needs the browser, and the cached state must be known before the first paint

  const rootClass = [styles.root, styles[`dock-${dock}`], styles[windowState], className].filter(Boolean).join(" ");
  return createPortal(
    <section className={rootClass} style={{ "--clv-lines": lines } as CSSProperties} aria-label={title}>
      <header className={styles.titleBar} onClick={minimized ? () => update({ windowState: "normal" }) : undefined}>
        <span className={styles.title}>{title}</span>
        {autoReload && <span className={`${styles.liveDot} ${minimized ? styles.paused : ""}`} title={minimized ? "Auto-reload paused while minimized" : `Auto-reload every ${intervalSec}s`} />}
        <span className={styles.windowButtons}>
          <span className={styles.dockButtons}>
            {DOCKS.map((d) => (
              <WindowButton key={d} label={`Dock ${d}`} pressed={dock === d} disabled={maximized} onClick={() => update({ dock: d })}>
                <Icon>
                  <rect x="2" y="3" width="12" height="10" rx="1.5" />
                  <path d={DOCK_BAR[d]} strokeWidth="2.5" />
                </Icon>
              </WindowButton>
            ))}
          </span>
          <WindowButton label={minimized ? "Restore" : "Minimize"} onClick={() => update({ windowState: minimized ? "normal" : "minimized" })}>
            <Icon>{minimized ? <path d="M4 10l4-4 4 4" /> : <path d="M3 12h10" />}</Icon>
          </WindowButton>
          <WindowButton label={maximized ? "Restore size" : "Maximize"} onClick={() => update({ windowState: maximized ? "normal" : "maximized" })}>
            <Icon>
              {maximized ? (
                <>
                  <rect x="2.5" y="5.5" width="8" height="8" rx="1" />
                  <path d="M5.5 3h7.5v7.5" />
                </>
              ) : (
                <rect x="3" y="3" width="10" height="10" rx="1" />
              )}
            </Icon>
          </WindowButton>
        </span>
      </header>

      {!minimized && (
        <>
          <div className={styles.controls}>
            <button type="button" className={styles.refresh} disabled={logs.loading} aria-busy={logs.loading} onClick={() => void logs.refresh()}>
              <span className={`${styles.refreshIcon} ${logs.loading ? styles.spinning : ""}`}>
                <Icon>
                  <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" />
                </Icon>
              </span>
              Refresh
            </button>
            <label className={styles.control}>
              <input type="checkbox" checked={autoReload} onChange={(e) => update({ autoReload: e.target.checked })} />
              Auto-reload
            </label>
            <label className={styles.control}>
              Every
              <select value={intervalSec} disabled={!autoReload} onChange={(e) => update({ intervalSec: Number(e.target.value) as IntervalSec })}>
                {INTERVAL_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}s
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.control}>
              Lines
              <select value={lines} onChange={(e) => update({ lines: Number(e.target.value) as LineCount })}>
                {LINE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <pre ref={body} className={styles.body} tabIndex={0} aria-label={`${title} output`}>
            {text || <span className={styles.placeholder}>{logs.error ? "Log unavailable." : logs.loading ? "Loading…" : "No log lines."}</span>}
          </pre>
          <footer className={styles.status}>
            {logs.error ? (
              <span className={styles.error} role="alert">
                {logs.error}
              </span>
            ) : (
              <span>{logs.fetchedAt ? `Last updated ${new Date(logs.fetchedAt).toLocaleTimeString()}` : " "}</span>
            )}
            {saveFailed && <span className={styles.warning}>Settings not saved</span>}
          </footer>
        </>
      )}
    </section>,
    document.body,
  );
}
