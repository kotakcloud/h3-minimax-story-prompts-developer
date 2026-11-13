export type WindowState = "normal" | "minimized" | "maximized";
export type Dock = "left" | "center" | "right";
export type IntervalSec = 5 | 10 | 30;
export type LineCount = 5 | 10;

export type ViewerSettings = {
  autoReload: boolean;
  intervalSec: IntervalSec;
  lines: LineCount;
  windowState: WindowState;
  dock: Dock;
};

// GET /api/comfy-logs
export type LogsResponse = {
  lines: string[];
  path: string;
  fetchedAt: string;
  error?: string;
};

// GET /api/comfy-logs/settings: saved settings merged over the defaults. savedKeys says which ones were really saved,
// so the component's props can fill in the rest ("saved settings take precedence, props provide defaults").
export type SettingsResponse = ViewerSettings & { savedKeys: (keyof ViewerSettings)[] };

export type ComfyLogViewerProps = {
  defaultLines?: LineCount;
  defaultInterval?: IntervalSec;
  apiPath?: string;
  settingsApiPath?: string;
  className?: string;
  title?: string;
};
