import type { PromptSegment } from "./types";

export function buildExportPayload(title: string, segments: PromptSegment[]) {
  return {
    title,
    segments: segments.map((segment) => ({
      duration: segment.duration,
      prompt: segment.prompt,
    })),
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
