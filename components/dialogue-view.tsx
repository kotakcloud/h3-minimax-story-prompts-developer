import { clipSecondsNeeded, parseDialogue } from "@/lib/dialogue";
import type { Character, Frame, PromptSegment } from "@/lib/types";

function clock(value: number) {
  return `${Math.floor(value / 60)}:${(value % 60).toFixed(1).padStart(4, "0")}`;
}

// Prompts tab: only the spoken lines of the current prompt set, with their timing, for review.
// `selected` holds ticked lines (debugging only, kept in memory): the key has the text, so another prompt set starts clear.
export function DialogueView({
  segments,
  frames,
  characters,
  selected,
  onToggle,
}: {
  segments: PromptSegment[];
  frames: Frame[];
  characters: Character[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const rows = segments.map((segment) => ({ segment, lines: parseDialogue(segment.prompt) }));
  const lineCount = rows.reduce((sum, row) => sum + row.lines.length, 0);
  const spoken = rows.reduce((sum, row) => sum + row.lines.reduce((total, line) => total + line.estimate, 0), 0);
  const keys = rows.flatMap(({ segment, lines }) => lines.map((line, index) => `${segment.id}:${index}:${line.text}`));
  const selectedCount = keys.filter((key) => selected.includes(key)).length;
  const name = (id: string) => characters.find((character) => character.id === id)?.name || id;

  return (
    <>
      <p className="mb-3 text-xs text-muted">
        {lineCount} spoken {lineCount === 1 ? "line" : "lines"} in {segments.length} segments · about {spoken.toFixed(1)}s of speech
        (estimated at a natural pace of 2.2 words per second)
        {selectedCount > 0 && ` · ${selectedCount} selected`}.
      </p>
      <ol className="space-y-3">
        {rows.map(({ segment, lines }, index) => {
          const needed = clipSecondsNeeded(lines);
          return (
            <li key={segment.id} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {index + 1}. {frames.find((item) => item.id === segment.id)?.title || segment.id}
                </p>
                <p className={`text-xs ${needed > segment.duration ? "text-amber-300" : "text-muted"}`}>
                  {segment.duration}s
                  {needed > segment.duration && ` · tight: these words need about ${needed}s`}
                </p>
              </div>
              {lines.length === 0 ? (
                <p className="mt-2 text-xs text-muted">No dialogue</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {lines.map((line, lineIndex) => {
                    const written = line.start !== undefined && line.end !== undefined ? line.end - line.start : null;
                    const key = `${segment.id}:${lineIndex}:${line.text}`;
                    return (
                      <li key={lineIndex} className="flex items-start gap-2 text-sm leading-6">
                        <input
                          type="checkbox"
                          aria-label={`Select line ${lineIndex + 1} of segment ${index + 1}`}
                          checked={selected.includes(key)}
                          onChange={() => onToggle(key)}
                          className="mt-1.5"
                        />
                        <div className="min-w-0">
                        <span className="font-medium text-accent">{line.speakers.map(name).join(" & ") || "Speaker"}: </span>
                        {line.text}
                        <p className="text-xs text-muted">
                          about {line.estimate}s
                          {line.language && ` · ${line.language}`}
                          {written !== null && (
                            <span className={written < line.estimate ? "text-amber-300" : ""}>
                              {` · prompt gives ${clock(line.start!)}–${clock(line.end!)} (${written.toFixed(1)}s)`}
                            </span>
                          )}
                        </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
