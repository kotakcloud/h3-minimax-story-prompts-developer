import { sanitizeSettings } from "../settings";
import type { LogsResponse } from "../types";
import { resolveLogPath } from "./paths";
import { loadSettings, saveSettings } from "./settingsStore";
import { readTail } from "./tail";

const DEFAULT_LINES = 10;
const MAX_LINES = 200;

const noStore = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function parseLines(value: string | null) {
  const n = value === null || value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(MAX_LINES, Math.max(1, Math.floor(n))) : DEFAULT_LINES;
}

function readError(e: unknown, file: string): { status: number; error: string } {
  const code = (e as NodeJS.ErrnoException).code;
  if (code === "ENOENT") return { status: 404, error: `ComfyUI log not found: ${file}` };
  if (code === "EISDIR") return { status: 500, error: `ComfyUI log path is a folder, not a file: ${file}` };
  if (code === "EACCES" || code === "EPERM") return { status: 403, error: `No permission to read the ComfyUI log: ${file}` };
  return { status: 500, error: `Could not read the ComfyUI log: ${e instanceof Error ? e.message : String(e)}` };
}

// GET /api/comfy-logs?lines=10. Read-only; the file comes from the server's config, never from the request.
export async function getLogs(req: Request) {
  const count = parseLines(new URL(req.url).searchParams.get("lines"));
  const fetchedAt = new Date().toISOString();
  const file = resolveLogPath();
  if (!file) {
    const error = "ComfyUI log path is not set. Set COMFYUI_LOG_PATH or COMFYUI_PATH.";
    return noStore({ lines: [], path: "", fetchedAt, error } satisfies LogsResponse, 500);
  }
  try {
    return noStore({ lines: await readTail(file, count), path: file, fetchedAt } satisfies LogsResponse);
  } catch (e) {
    const { status, error } = readError(e, file);
    return noStore({ lines: [], path: file, fetchedAt, error } satisfies LogsResponse, status);
  }
}

export const getSettings = async () => noStore(await loadSettings());

// PUT /api/comfy-logs/settings: known keys with allowed values are saved, anything else is ignored.
export async function putSettings(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) return noStore({ error: "Expected a JSON object." }, 400);
  const patch = sanitizeSettings(body);
  if (!Object.keys(patch).length) return noStore(await loadSettings());
  try {
    return noStore(await saveSettings(patch));
  } catch (e) {
    return noStore({ error: `Could not save settings: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }
}
