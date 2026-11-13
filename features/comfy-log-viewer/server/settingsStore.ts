import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../settings";
import type { SettingsResponse, ViewerSettings } from "../types";

const settingsFile = () => path.resolve(process.cwd(), process.env.COMFY_LOG_VIEWER_SETTINGS_PATH?.trim() || path.join(".data", "comfy-log-viewer.json"));

// A missing or corrupt file simply means nothing is saved.
async function readSaved(): Promise<Partial<ViewerSettings>> {
  try {
    return sanitizeSettings(JSON.parse(await fs.readFile(settingsFile(), "utf8")));
  } catch {
    return {};
  }
}

const withDefaults = (saved: Partial<ViewerSettings>): SettingsResponse => ({
  ...DEFAULT_SETTINGS,
  ...saved,
  savedKeys: Object.keys(saved) as (keyof ViewerSettings)[],
});

export const loadSettings = async () => withDefaults(await readSaved());

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

// One write at a time, so a slow save cannot overwrite a newer one with older values.
let writes: Promise<unknown> = Promise.resolve();

export function saveSettings(patch: Partial<ViewerSettings>): Promise<SettingsResponse> {
  const save = async () => {
    const merged = { ...(await readSaved()), ...patch };
    await writeAtomic(settingsFile(), JSON.stringify(merged, null, 2));
    return withDefaults(merged);
  };
  const result = writes.then(save, save);
  writes = result.catch(() => {});
  return result;
}
