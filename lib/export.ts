import type { Frame, PromptSegment } from "./types";

export function buildExportPayload(title: string, segments: PromptSegment[]) {
  return {
    title,
    segments: segments.map((segment) => ({
      duration: segment.duration,
      prompt: segment.prompt,
    })),
  };
}

export function buildMarkdownExport(
  title: string,
  segments: PromptSegment[],
  frames: Frame[] = [],
) {
  const heading = title.trim() || "Untitled story";
  const body = segments
    .map((segment, index) => {
      const frame = frames.find((item) => item.id === segment.id);
      const name = frame?.title || `Segment ${index + 1}`;
      return `## ${index + 1}. ${name} (${segment.duration}s)\n\n${segment.prompt.trim()}`;
    })
    .join("\n\n---\n\n");

  return `# ${heading}\n\n${body}\n`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown) {
  downloadBlob(
    filename,
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
}

export function downloadMarkdown(filename: string, markdown: string) {
  downloadBlob(filename, new Blob([markdown], { type: "text/markdown" }));
}
