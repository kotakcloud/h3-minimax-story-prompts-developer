export type StickyNotePrefs = {
  x: number;
  y: number;
  text: string;
};

export type UiPrefs = {
  stickyNote: StickyNotePrefs;
};

export type UiPrefsPatch = Omit<Partial<UiPrefs>, "stickyNote"> & {
  stickyNote?: Partial<StickyNotePrefs>;
};

const STORAGE_KEY = "h3-workshop-ui-prefs";

const defaultStickyNote: StickyNotePrefs = { x: 0, y: 0, text: "" };

let loaded = false;
let writeSeq = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStickyNote(value: unknown): StickyNotePrefs {
  if (!isRecord(value)) return { ...defaultStickyNote };
  return {
    x: typeof value.x === "number" && Number.isFinite(value.x) ? value.x : 0,
    y: typeof value.y === "number" && Number.isFinite(value.y) ? value.y : 0,
    text: typeof value.text === "string" ? value.text : "",
  };
}

function asUiPrefs(value: unknown): UiPrefs {
  const raw = isRecord(value) ? value : {};
  return {
    ...raw,
    stickyNote: asStickyNote(raw.stickyNote),
  };
}

function readStored(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { stickyNote: { ...defaultStickyNote } };
    return asUiPrefs(JSON.parse(raw));
  } catch {
    return { stickyNote: { ...defaultStickyNote } };
  }
}

function writeStored(prefs: UiPrefs) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

export function loadUiPrefs(): UiPrefs {
  const prefs = readStored();
  loaded = true;
  return prefs;
}

export function patchUiPrefs(patch: UiPrefsPatch): UiPrefs | null {
  if (!loaded) return null;
  const seq = ++writeSeq;
  const current = readStored();
  const next: UiPrefs = {
    ...current,
    ...patch,
    stickyNote: {
      ...current.stickyNote,
      ...(patch.stickyNote ?? {}),
    },
  };
  if (seq !== writeSeq) {
    return readStored();
  }
  writeStored(next);
  return next;
}

export function patchStickyNote(patch: Partial<StickyNotePrefs>): UiPrefs | null {
  return patchUiPrefs({ stickyNote: patch });
}
