# ComfyLogViewer

A small floating terminal window that shows the last lines of the ComfyUI log file. It docks to the bottom-left, center
or right, minimizes to its title bar, maximizes, and reloads on demand or on a timer. Read-only: it never writes to the
log, and the browser cannot choose which file is read.

## Mounting

Here it is mounted once in the root layout, so it is on every page and keeps running across page changes:

```tsx
// app/layout.tsx
import { ComfyLogViewer } from "@/features/comfy-log-viewer";

// inside <body>, after {children}
<ComfyLogViewer />
```

To show it on one page only, mount it in that page instead. To keep the right dock away from something in that corner, set
`--clv-right-margin` on `:root` (this project: 68px, clear of the sticky note icon). To sit above a bar fixed at the
bottom, set `--clv-bottom` to that bar's height (H3 Workshop: the Debug logs bar sets it from a ResizeObserver). The
window's `z-index` is in the CSS module (H3 Workshop: 75, between its dialogs and its sticky note; Story Scene Prompter
uses 998); change it to fit the project's layers.

All props are optional:

| Prop | Default | Meaning |
|---|---|---|
| `defaultLines` | `10` | Line count (5 or 10) until the user saves one |
| `defaultInterval` | `5` | Auto-reload seconds (5, 10 or 30) until the user saves one |
| `apiPath` | `/api/comfy-logs` | Logs route |
| `settingsApiPath` | `/api/comfy-logs/settings` | Settings route |
| `className` | | Extra class on the window |
| `title` | `ComfyUI Logs` | Title bar text |

Props only provide defaults: saved settings take precedence.

## Which log file

`server/paths.ts` is the only place that decides. The first of these that is set wins:

1. `COMFYUI_LOG_PATH`: the full path to the log file.
2. `COMFYUI_PATH`: the ComfyUI folder; the log is `<COMFYUI_PATH>/user/comfyui.log`.
3. The project's own `COMFYUI_OUTPUT_DIR` (`<ComfyUI>/output`): the log is `<ComfyUI>/user/comfyui.log`.

If none is set, or the file is missing or unreadable, the window shows the error and keeps working.

| Env var | Purpose |
|---|---|
| `COMFYUI_LOG_PATH` | Optional. Full path to the log file |
| `COMFYUI_PATH` | Optional. ComfyUI folder |
| `COMFY_LOG_VIEWER_SETTINGS_PATH` | Optional. Where the settings JSON is stored |

Porting to a project without `COMFYUI_OUTPUT_DIR`: set one of the first two, or change `resolveLogPath()`.

## Settings

Stored in `.data/comfy-log-viewer.json` in the project root, or in `COMFY_LOG_VIEWER_SETTINGS_PATH`. The folder is created
when needed and is in `.gitignore`. Saved: `autoReload`, `intervalSec`, `lines`, `windowState`, `dock`. They survive
Next.js restarts and browser reloads. The browser also keeps a copy in `localStorage` (`comfy-log-viewer:settings`), so
the window opens in the right state before the server answers.

To reset: delete `.data/comfy-log-viewer.json`. The next server answer brings the defaults back. A corrupt file counts as
no file.

## API

- `GET /api/comfy-logs?lines=10`: `{ lines, path, fetchedAt, error? }`. `lines` is clamped to 1-200 (default 10). Reads
  backwards from the end of the file in 64 KB chunks and holds at most 8 MB. Colour codes are removed, and a progress bar
  line shows only its last state.
- `GET /api/comfy-logs/settings`: saved settings merged over the defaults, plus `savedKeys` (which ones were really saved,
  so props can fill in the rest).
- `PUT /api/comfy-logs/settings`: a JSON object of settings to change. Unknown keys and values that are not allowed are
  ignored. Written atomically (temp file + rename).

## Porting

Copy `features/comfy-log-viewer/` and the two route files in `app/api/comfy-logs/` (they only re-export the handlers), and
keep the `@/` import alias or adjust it. There are no dependencies beyond Next.js and React. Styling is one CSS module,
with its own colours. Add `.data/` to `.gitignore`.

| File | Purpose |
|---|---|
| `index.ts` | The single entry: the component and its props type |
| `ComfyLogViewer.tsx`, `ComfyLogViewer.module.css` | The window |
| `hooks/useComfyLogs.ts` | Fetching, polling, no overlapping requests |
| `hooks/useViewerSettings.ts` | Loading, caching and debounced saving of settings |
| `settings.ts`, `types.ts` | Schema, defaults, shared types |
| `server/paths.ts` | Log path resolution |
| `server/tail.ts` | Reading the end of the file |
| `server/settingsStore.ts` | The settings JSON file |
| `server/handlers.ts` | The route handlers |
