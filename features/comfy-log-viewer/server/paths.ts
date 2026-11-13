import path from "node:path";

// Where the ComfyUI log is. All path resolution lives here, so a project only has to change this one function.
// The env vars win, so they work as overrides; without them the path comes from the project's own config
// (COMFYUI_OUTPUT_DIR is <ComfyUI>/output, so the log is <ComfyUI>/user/comfyui.log).
export function resolveLogPath(): string | null {
  const logPath = process.env.COMFYUI_LOG_PATH?.trim();
  if (logPath) return logPath;
  const comfyPath = process.env.COMFYUI_PATH?.trim();
  if (comfyPath) return path.join(comfyPath, "user", "comfyui.log");
  const outputDir = process.env.COMFYUI_OUTPUT_DIR?.trim();
  if (outputDir) return path.join(path.dirname(path.resolve(outputDir)), "user", "comfyui.log");
  return null;
}
