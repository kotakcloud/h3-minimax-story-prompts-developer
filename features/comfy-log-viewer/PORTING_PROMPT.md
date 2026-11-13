# Port ComfyLogViewer into this project

You are working in a Next.js project. Add **ComfyLogViewer**: a small floating terminal-style window that shows the last
lines of the ComfyUI log file. ComfyUI runs on the same machine, and the Next.js server can read its folder directly.

Keep everything under one feature folder, so it can be ported again.

## 1. Source reference

A working implementation exists at:

```
C:\myfiles\projects\my\story-scene-prompter\features\comfy-log-viewer
```

Its thin API routes are in `C:\myfiles\projects\my\story-scene-prompter\app\api\comfy-logs\`, and it is mounted in that
project's `app\layout.tsx`.

- If that path is readable, treat it as the reference implementation and read every file in it before you build.
- If it is not readable, build from the spec below, which is complete enough to do so.
- Do NOT blindly copy files. That project uses the App Router, TypeScript, plain CSS and no `src/` folder. Adapt to this
  project: its router, language, styling, aliases, naming and conventions.
- When the reference and this document disagree, follow this document.

## 2. Detect the target project first

Do this before writing any code, and state what you found.

1. App Router or Pages Router. TypeScript or JavaScript. Styling approach (Tailwind, CSS modules, global CSS, a component
   library). `src/` folder or not. Path aliases. Next.js and React versions.
2. Whether a ComfyUI path is already known: in code, config, constants or env files of this project, or in your own
   context. A ComfyUI URL does not count, but an output, input or models folder does, since the ComfyUI root can be derived
   from it. If you know the path, use it as described in section 3.1; the env vars are then not required.
3. Conflicts with the names used here: `/api/comfy-logs`, `features/comfy-log-viewer`, a `.data` folder, the
   `comfy-log-viewer:settings` localStorage key. On a conflict, pick a non-conflicting name, pass it through the
   `apiPath` / `settingsApiPath` props if it is a route, and report it.
4. Anything fixed to the bottom of the viewport, and its `z-index` (sticky notes, chat widgets, toasts, dev tools).
5. Global CSS rules on bare elements (`section`, `button`, `select`, `input`, `label`, `pre`). They WILL reach the window;
   see section 3.6.

## 3. Feature spec

### 3.1 Log path resolution

One server-side helper decides, so it is easy to change. The first of these that is set wins:

1. `COMFYUI_LOG_PATH`: the full path to the log file.
2. `COMFYUI_PATH`: the ComfyUI folder; the log is `<COMFYUI_PATH>/user/comfyui.log`.
3. The path this project already knows, from section 2. For example, an output folder setting gives
   `<parent of output>/user/comfyui.log`. If you know the path only from your own context, use a constant here.

The env vars come first on purpose: they are overrides, and a known path placed above them could never be overridden.
With neither set, which is the normal case when a path is known, the known path is used and no env var is needed.

Check that the file you resolve is the live log, meaning its modified time is recent. ComfyUI writes `user/comfyui.log`;
older installs can leave a stale `comfyui_8188.log` beside it. Report the resolved path and where it came from.

Add all three env vars used by this feature (these two and `COMFY_LOG_VIEWER_SETTINGS_PATH`) to `.env.example` as optional,
commented out, with a comment each. Create `.env.example` if the project has none.

### 3.2 Logs API: `GET /api/comfy-logs?lines=10`

- `lines`: default 10 when missing, empty or not a number; floor it; clamp to 1-200.
- Response JSON: `{ lines: string[], path: string, fetchedAt: ISOString, error?: string }`.
- Read-only. Never accept a file path, or any part of one, from the client.
- Node.js runtime, dynamic, no caching. Send `Cache-Control: no-store`. In the App Router, export `runtime = "nodejs"` and
  `dynamic = "force-dynamic"` from the route file itself, because Next reads them statically.
- Errors never crash the route. Keep the response shape, with `lines: []`:

| Case | Status | `error` |
|---|---|---|
| No path could be resolved | 500 | Says to set `COMFYUI_LOG_PATH` or `COMFYUI_PATH`; `path` is `""` |
| `ENOENT` | 404 | Log not found, with the path |
| `EACCES` / `EPERM` | 403 | No permission, with the path |
| Path is a folder | 500 | Path is a folder, not a file |
| Anything else | 500 | The error's message |

Tail reading rules:

- Read backwards from the end in 64 KB chunks. Never load the whole file. Hold at most 8 MB, however long the lines are.
- Stop once you have `count + 1` newlines: one ends the last line, one comes before the first line wanted.
- Find lines by the newline byte (`0x0a`) on the raw `Buffer`, and decode only at the end. That way a multi-byte UTF-8
  character is never cut at a chunk edge, which matters for non-English text in file names.
- Clean each line the way a terminal would show it: remove ANSI colour codes, remove trailing `\r` (the log uses CRLF on
  Windows), and for a line containing bare `\r` (progress bars redraw themselves) keep only the last segment.
- **Windows trap:** `open()` on a folder succeeds and `stat` reports size 0, so a folder path looks like an empty log with
  status 200. Check `isFile()` and fail.

```ts
const CHUNK_BYTES = 64 * 1024;
const MAX_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function cleanLine(line: string) {
  const parts = line.replace(ANSI, "").replace(/\r+$/, "").split("\r");
  return parts[parts.length - 1];
}

export async function readTail(file: string, count: number): Promise<string[]> {
  const handle = await open(file, "r"); // node:fs/promises
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw Object.assign(new Error(`Not a file: ${file}`), { code: "EISDIR" });
    const chunks: Buffer[] = [];
    let position = stats.size;
    let total = 0;
    let newlines = 0;
    while (position > 0 && newlines <= count && total < MAX_BYTES) {
      const length = Math.min(CHUNK_BYTES, position);
      position -= length;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (!bytesRead) break; // the file shrank while reading
      const chunk = buffer.subarray(0, bytesRead);
      chunks.unshift(chunk);
      total += bytesRead;
      for (const byte of chunk) if (byte === NEWLINE) newlines++;
    }
    let data = Buffer.concat(chunks);
    if (position > 0) {
      // stopped mid-file: drop the partial first line
      const first = data.indexOf(NEWLINE);
      if (first >= 0) data = data.subarray(first + 1);
    }
    const lines = data.toString("utf8").split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines.slice(-count).map(cleanLine);
  } finally {
    await handle.close();
  }
}
```

### 3.3 Settings API: `GET` and `PUT /api/comfy-logs/settings`

- Stored as JSON at `.data/comfy-log-viewer.json` in the project root, or at `COMFY_LOG_VIEWER_SETTINGS_PATH` (a relative
  path resolves from the project root). Create the folder when needed. Add `.data/` to `.gitignore`.
- Same runtime and no-cache rules as the logs route.
- Schema, one function used for the PUT body, the file and the localStorage cache: keep only known keys whose value is in
  the allowed list, and drop everything else.
- `GET`: saved settings merged over the defaults, plus `savedKeys: string[]`, the keys really saved. A missing or corrupt
  file means nothing is saved, so it returns the defaults with `savedKeys: []`.
- `savedKeys` is an addition worth keeping. Without it the client cannot tell a saved value from a server default, and the
  `defaultLines` / `defaultInterval` props could never apply.
- `PUT`: a partial object, merged over what is saved. Not a JSON object: `400` with `{ error }`. No valid keys: write
  nothing and return the current settings. Write failure: `500` with `{ error }`. Success returns the same shape as `GET`.
- Writes are atomic (temp file in the same folder, then rename) and serialized, so a slow save cannot overwrite a newer one:

```ts
async function writeAtomic(file: string, text: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, text);
    await fs.rename(temp, file);
  } catch (e) {
    await fs.rm(temp, { force: true });
    throw e;
  }
}

let writes: Promise<unknown> = Promise.resolve();

export function saveSettings(patch: Partial<ViewerSettings>) {
  const save = async () => {
    const merged = { ...(await readSaved()), ...patch };
    await writeAtomic(settingsFile(), JSON.stringify(merged, null, 2));
    return withDefaults(merged);
  };
  const result = writes.then(save, save); // runs after a failed write too
  writes = result.catch(() => {});
  return result;
}
```

### 3.4 Persisted settings

| Key | Allowed | Default |
|---|---|---|
| `autoReload` | `true`, `false` | `false` |
| `intervalSec` | `5`, `10`, `30` | `5` |
| `lines` | `5`, `10` | `10` |
| `windowState` | `"normal"`, `"minimized"`, `"maximized"` | `"normal"` |
| `dock` | `"left"`, `"center"`, `"right"` | `"right"` |

They must survive browser reloads and Next.js restarts.

Client behaviour, in order:

1. Start from the defaults, with props applied (section 3.7).
2. Before the first paint, read the localStorage cache (`comfy-log-viewer:settings`) in `useLayoutEffect`, sanitize it,
   apply it, and mark the settings ready. Render nothing until ready. The portal needs the browser anyway, and this avoids
   both a hydration mismatch and a flash of the wrong state.
3. Fetch the server's settings and reconcile: `{ ...defaults, ...savedValuesOnly }`, then re-apply any key the user has
   changed since load, so a slow server answer cannot undo a click. If the server cannot be reached, stay on the cache.
4. Mirror settings to localStorage on every change. Wrap every localStorage access in try/catch.
5. Save on change, debounced 300 ms, sending ONLY the changed keys. Sending the full object would save prop defaults the
   user never chose.
6. Flush a pending save on `pagehide` and on unmount with `fetch(..., { keepalive: true })`. Otherwise a change made just
   before a reload is lost, and the reload then shows the old server value.
7. If a save fails, put its keys back in the pending set so they go out with the next change, and show a small inline
   "Settings not saved" warning. Clear the warning on the next successful save.

### 3.5 Log fetching

- Fetch once on mount, as soon as the settings are ready, so the first request asks for the right line count. This also
  happens when the window starts minimized.
- Refetch when `lines` or `apiPath` changes. This aborts any running request.
- Poll only when `autoReload` is on and the window is not minimized. Restoring resumes polling on the next tick.
- Never overlap: polling ticks and the Refresh button are skipped while a request runs.
- Clear the interval when settings change and on unmount, and abort on unmount.
- On an error, keep the last good lines and `fetchedAt`, and show the error. A non-JSON response counts as an error.

```ts
const load = useCallback(
  async (replace = false) => {
    if (inFlight.current && !replace) return; // skip, never overlap
    inFlight.current?.abort();
    const request = new AbortController();
    inFlight.current = request;
    setLoading(true);
    try {
      const res = await fetch(`${apiPath}?lines=${lines}`, { cache: "no-store", signal: request.signal });
      const body = await res.json().catch(() => null);
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
        inFlight.current = null; // a replaced request must not clear its successor
        setLoading(false);
      }
    }
  },
  [apiPath, lines],
);

useEffect(() => { if (enabled) void load(true); }, [enabled, load]);

useEffect(() => {
  if (!enabled || !polling) return;
  const timer = setInterval(() => void load(), intervalSec * 1000);
  return () => clearInterval(timer);
}, [enabled, polling, intervalSec, load]);
```

### 3.6 UI

A compact, dark, monospace mini terminal, rendered through a portal into `document.body`, fixed to the bottom of the
viewport. It uses its own dark colours in both light and dark themes. In the reference: width `min(560px, 100vw - 24px)`,
height from the line count (about 18 px per line plus the title bar, controls and status bar), and a 12 px margin.

**Title bar**, labelled "ComfyUI Logs" (the `title` prop):

- Three dock buttons, snapping to bottom-left, bottom-center and bottom-right, with the current one marked by
  `aria-pressed`. They are disabled while maximized, since docking has no visible effect then.
- Minimize. While minimized it becomes Restore.
- Maximize. While maximized it becomes Restore size.
- A small dot while auto-reload is on, greyed while minimized.
- Inline SVG icons, with no icon dependency. Every button has `title` and `aria-label`.

**Window states**, all animated subtly over about 180 ms:

- `normal`: docked at the bottom, sized by the line count.
- `minimized`: only the title bar, about 260 px wide, in the bottom bar at the docked position. Clicking the bar restores
  it. Buttons on the bar must `stopPropagation`, or a dock click also restores.
- `maximized`: fills the viewport with a 12 px margin, using `100dvh`.
- Restoring always returns to `normal`.

Animate docking with `left` plus `transform`. Switching between `left` and `right` values does not animate:

```css
.dock-left   { left: var(--clv-margin); transform: translateX(0); }
.dock-center { left: 50%; transform: translateX(-50%); }
.dock-right  { left: 100%; transform: translateX(calc(-100% - var(--clv-right-margin, var(--clv-margin)))); }
```

**Controls**, hidden when minimized: a Refresh button with a spinner, disabled while loading, with `aria-busy`; an
Auto-reload checkbox, unchecked by default; an interval select (5s, 10s, 30s), disabled unless auto-reload is on; a lines
select (5, 10).

**Log body:** `<pre>` with whitespace preserved, long lines wrapped, `tabIndex={0}` and an `aria-label`. Scroll to the bottom
when the text changes or the window state changes, comparing the joined text, so an identical reload does not move the
reader's scroll position. Placeholder text: "Log unavailable." on an error, "Loading…" while loading, "No log lines."
otherwise.

**Status bar:** "Last updated <time>", or the error with `role="alert"`, plus the "Settings not saved" warning.

**Narrow screens** (640 px and below): full width with no side margin or transform, dock buttons hidden, and more height,
because the controls wrap to two rows. Check that there is no horizontal page scroll.

**`prefers-reduced-motion`:** no transitions.

**Coexisting with the page.** These came up in the reference project, so check them here:

- Bare-element global CSS reaches the window. A global `section` rule added padding and a margin to it. Explicitly reset
  `margin` and `padding` on the root, and give every control its own `font`, `color`, `background` and `border`. Check the
  computed styles.
- Choose the `z-index` from what you found in section 2: above page content, below anything that must stay clickable.
- If something sits in the bottom-right corner, set `--clv-right-margin` on `:root` to clear it. This is optional and the
  feature falls back to the normal margin.

**Styling:** follow this project's approach. If it uses Tailwind, use utilities where they are enough; the dock transforms
and the height from the line count are easier as a small CSS module or inline CSS variables (`--clv-lines`), and that is
acceptable. With global CSS only, still use a CSS module if the project supports it, so the feature stays self-contained.

### 3.7 Props

| Prop | Default | Purpose |
|---|---|---|
| `defaultLines` | `10` | Line count until one is saved |
| `defaultInterval` | `5` | Interval until one is saved |
| `apiPath` | `/api/comfy-logs` | Logs route |
| `settingsApiPath` | `/api/comfy-logs/settings` | Settings route |
| `className` | | Extra class on the root |
| `title` | `ComfyUI Logs` | Title bar text and accessible name |

Props provide defaults only: saved settings take precedence, key by key, using `savedKeys`.

### 3.8 Folder structure

Adjust the location to this project (for example `src/features/...`) and the extensions to its language.

```
features/comfy-log-viewer/
  index.ts                     The single entry: exports the component and its props type. Never exports server code.
  ComfyLogViewer.tsx           The client component: portal, title bar, controls, body, status bar.
  ComfyLogViewer.module.css    The window's styles (or this project's equivalent).
  types.ts                     Shared types: settings, API responses, props.
  settings.ts                  Allowed values, defaults, sanitizeSettings(). No Node imports: the client uses it too.
  hooks/useComfyLogs.ts        Fetching, polling, no overlap, abort.
  hooks/useViewerSettings.ts   Cache, server reconcile, debounced saving, flush on leave.
  server/paths.ts              resolveLogPath(), the one place for path resolution.
  server/tail.ts               readTail(), the backward chunked reader.
  server/settingsStore.ts      Reading and atomically writing the settings file.
  server/handlers.ts           Route logic: parsing, clamping, error mapping, no-store headers.
  README.md                    What it does, configuration, where settings live, how to reset them.
```

API route files stay thin and only import from the feature folder:

```ts
// app/api/comfy-logs/route.ts
import { getLogs } from "@/features/comfy-log-viewer/server/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = getLogs;
```

`app/api/comfy-logs/settings/route.ts` is the same shape, with `GET = getSettings` and `PUT = putSettings`.

**Pages Router:** use `pages/api/comfy-logs/index.ts` and `pages/api/comfy-logs/settings.ts`. Handlers take `(req, res)`, so
adapt `server/handlers.ts`: read `req.query.lines`, use the already parsed `req.body`, allow only the expected methods
(`405` otherwise), and set `Cache-Control: no-store` with `res.setHeader`. Routes are Node.js by default, and dynamic.

**JavaScript projects:** drop the types, and keep the same files and allowed-value checks. Validation matters more without
types, not less.

Add no dependencies. `index.ts` must never pull `node:` modules into the client bundle.

## 4. Mounting

Add a demo page first, and verify there.

**Demo page:** `/comfy-logs`, or a non-conflicting name. A short explanation plus `<ComfyLogViewer />`. On a page with
sticky-position content, make sure the window does not hide anything needed for testing.

**On every page, instead of the demo page.** Mount it once and remove it from the demo page, otherwise two windows appear.

```tsx
// App Router: app/layout.tsx, inside <body>, after {children}
import { ComfyLogViewer } from "@/features/comfy-log-viewer";

<ComfyLogViewer />
```

```tsx
// Pages Router: pages/_app.tsx
import { ComfyLogViewer } from "@/features/comfy-log-viewer";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Component {...pageProps} />
      <ComfyLogViewer />
    </>
  );
}
```

Mounted in a layout, the window survives client-side navigation, so polling is not restarted by moving between pages.

Do the demo page unless the user asked for it on every page, and describe the other option in the feature README.

## 5. Verification checklist

Run these for real, in a browser where you can, and report any you could not run.

**Logs**

- [ ] Logs load on mount, and the lines match the end of the real log file.
- [ ] Refresh refetches and shows its loading state.
- [ ] Auto-reload is off by default. When on, requests arrive at the chosen interval, and none overlap.
- [ ] Polling makes no requests while minimized, and resumes after restore.
- [ ] Changing lines refetches once and shows that many lines.
- [ ] `lines=999` gives 200 lines, `0` gives 1, `abc` and empty give 10.
- [ ] The view scrolls to the bottom on new content, and does not jump on an identical reload.
- [ ] Line cleaning works on a real log: no colour codes, no stray `\r`, and non-English text is intact.

**Window**

- [ ] Minimize, maximize and restore all work, and clicking the minimized bar restores it.
- [ ] All three dock positions work. Measure the final position; CSS transitions can make an early reading stale.
- [ ] Clicking a dock button on the minimized bar docks it without restoring.
- [ ] The root element's computed `margin` and `padding` are 0, so global CSS is not leaking in.
- [ ] Nothing it overlaps has become unclickable.
- [ ] Mobile width: full width, no horizontal scroll, and all three window states fit.

**Settings**

- [ ] Settings survive a browser reload.
- [ ] Settings survive a Next.js dev server restart. Actually stop and start it.
- [ ] A change made immediately before a reload is not lost.
- [ ] A PUT with bad keys and values saves only the valid ones; a non-JSON body gives 400.
- [ ] A corrupt settings file gives defaults, not an error.
- [ ] A saved value beats a prop, and a prop applies to a value that was never saved.
- [ ] A failed save shows the inline warning, and the next successful save clears it.

**Errors and build**

- [ ] A missing log file shows a clear error in the window, with status 404, and nothing crashes.
- [ ] A log path pointing at a folder shows a clear error. It must not look like an empty log.
- [ ] Typecheck passes. Lint passes, if the project has it.
- [ ] Production build passes.

**Two traps when running these checks:**

- Do not run `next build` while the dev server is running; both write to `.next`. Stop it first, or use a separate
  `distDir`.
- To test a bad log path, use a temporary env file, then blank the variable (`COMFYUI_LOG_PATH=`) before removing the file
  and check that the real path is back. A running dev server keeps the variable in memory after an env file is deleted,
  and only a blank value or a restart clears it. Do not leave the server on your test value, and do not edit real secrets
  files for this. Delete test settings files too, so the user starts on the defaults.

## 6. Deliverable

When done, report:

1. Every file created or modified.
2. Env vars used, and which ones are actually set.
3. The resolved ComfyUI log path, and where it came from.
4. What you detected in section 2.
5. Renamed routes, folders or keys, and why.
6. Any deviation from this spec, and why.
7. Which checklist items you verified, and any you could not run.

Also write the feature's `README.md`: what it does, how to configure it, where settings are stored, how to reset them
(delete the JSON file), and how to mount it globally.
