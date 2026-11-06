import { useState } from "react";
import {
  MAX_CLIP_SECONDS,
  clipSecondsNeeded,
  cutOffLines,
  isTight,
  parseDialogue,
  speakerProblems,
  timingFixes,
  type LineDuration,
  type LineText,
} from "@/lib/dialogue";
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
  onFixTiming,
  fixing,
  onUpdateDurations,
}: {
  segments: PromptSegment[];
  frames: Frame[];
  characters: Character[];
  selected: string[];
  onToggle: (key: string) => void;
  onFixTiming: () => void;
  fixing: boolean;
  onUpdateDurations: (edits: LineDuration[], texts: LineText[]) => void;
}) {
  const [hideUnselected, setHideUnselected] = useState(false);
  // Typed line lengths, by the same key as `selected`.
  const [durations, setDurations] = useState<Record<string, string>>({});
  // Typed line words (lines being edited), by the same key.
  const [texts, setTexts] = useState<Record<string, string>>({});
  const rows = segments.map((segment) => ({ segment, lines: parseDialogue(segment.prompt) }));
  const fixes = timingFixes(segments).length;
  const lineCount = rows.reduce((sum, row) => sum + row.lines.length, 0);
  const spoken = rows.reduce((sum, row) => sum + row.lines.reduce((total, line) => total + line.estimate, 0), 0);
  const keys = rows.flatMap(({ segment, lines }) => lines.map((line, index) => `${segment.id}:${index}:${line.text}`));
  const selectedCount = keys.filter((key) => selected.includes(key)).length;
  const edits: LineDuration[] = rows.flatMap(({ segment, lines }) =>
    lines.flatMap((line, lineIndex) => {
      const seconds = Number(durations[`${segment.id}:${lineIndex}:${line.text}`]);
      return seconds > 0 && line.start !== undefined && line.end !== undefined ? [{ segmentId: segment.id, lineIndex, seconds }] : [];
    }),
  );
  const textEdits: LineText[] = rows.flatMap(({ segment, lines }) =>
    lines.flatMap((line, lineIndex) => {
      const text = texts[`${segment.id}:${lineIndex}:${line.text}`];
      return text !== undefined && text.replace(/\s+/g, " ").trim() && text.replace(/\s+/g, " ").trim() !== line.text
        ? [{ segmentId: segment.id, lineIndex, text }]
        : [];
    }),
  );
  const changes = edits.length + textEdits.length;
  // With nothing ticked there is nothing to narrow down to, so every line shows.
  const onlySelected = hideUnselected && selectedCount > 0;
  const name = (id: string) => characters.find((character) => character.id === id)?.name || id;
  const voiceOnly = characters.filter((character) => character.voiceOnly).map((character) => character.id);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted">
        {lineCount} spoken {lineCount === 1 ? "line" : "lines"} in {segments.length} segments · about {spoken.toFixed(1)}s of speech
        (estimated at a natural pace of 2.2 words per second)
        {selectedCount > 0 && ` · ${selectedCount} selected`}.
      </p>
      <div className="flex flex-wrap gap-2">
      {Object.keys(texts).length > 0 && (
        <button type="button" onClick={() => setTexts({})} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
          Discard line edits
        </button>
      )}
      {changes > 0 && (
        <button
          type="button"
          onClick={() => {
            onUpdateDurations(edits, textEdits);
            setDurations({});
            setTexts({});
          }}
          title="New prompt set (no AI): edited lines get your words (same speaker, language and timing); each line with typed seconds gets them, everything after it moves, and the segment length follows."
          className="rounded-full bg-foreground px-3 py-1 text-xs font-semibold text-background"
        >
          Update in prompts ({changes})
        </button>
      )}
      {fixes > 0 && (
        <button
          type="button"
          onClick={onFixTiming}
          disabled={fixing}
          title="New prompt set: tight segments get longer (up to 15 s) and their lines get enough time. The rest stays the same."
          className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-ink disabled:opacity-50"
        >
          {fixing ? "Fixing timing…" : `Fix timing (${fixes} ${fixes === 1 ? "segment" : "segments"})`}
        </button>
      )}
      <button
        type="button"
        onClick={() => setHideUnselected(!onlySelected)}
        disabled={selectedCount === 0}
        className="rounded-full border border-line px-3 py-1 text-xs text-foreground disabled:opacity-50"
      >
        {onlySelected ? "Show unselected" : "Hide unselected"}
      </button>
      </div>
      </div>
      <ol className="space-y-3">
        {rows.map(({ segment, lines }, index) => {
          const needed = clipSecondsNeeded(lines);
          const tight = isTight(segment);
          const cutOff = cutOffLines(segment.prompt).map((line) => line.text);
          const visible = lines
            .map((line, lineIndex) => ({ line, lineIndex }))
            .filter(({ line, lineIndex }) => !onlySelected || selected.includes(`${segment.id}:${lineIndex}:${line.text}`));
          if (onlySelected && visible.length === 0) return null;
          return (
            <li key={segment.id} className="rounded-2xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {index + 1}. {frames.find((item) => item.id === segment.id)?.title || segment.id}
                </p>
                <p className={`text-xs ${tight ? "text-amber-300" : "text-muted"}`}>
                  {segment.duration}s
                  {tight && ` · tight: these words need about ${needed}s`}
                  {tight && needed > MAX_CLIP_SECONDS && `, more than one segment can hold: split this frame on the Frames step`}
                </p>
              </div>
              {speakerProblems(segment.prompt, voiceOnly).length > 0 && (
                <p className="mt-1 text-xs text-amber-300">
                  Wrong-speaker risk: {speakerProblems(segment.prompt, voiceOnly).join(", ")}. Regenerate the prompts to fix it.
                </p>
              )}
              {lines.length === 0 ? (
                <p className="mt-2 text-xs text-muted">No dialogue</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {visible.map(({ line, lineIndex }) => {
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
                        <div className="min-w-0 flex-1">
                        <span className="font-medium text-accent">{line.speakers.map(name).join(" & ") || "Speaker"}: </span>
                        {texts[key] === undefined ? (
                          line.text
                        ) : (
                          <textarea
                            value={texts[key]}
                            onChange={(event) => setTexts((current) => ({ ...current, [key]: event.target.value }))}
                            rows={2}
                            autoFocus
                            aria-label={`Words of line ${lineIndex + 1} of segment ${index + 1}`}
                            className={`mt-1 block w-full resize-y rounded-md border bg-background px-2 py-1 text-sm text-foreground outline-none ${
                              texts[key].replace(/\s+/g, " ").trim() !== line.text ? "border-accent" : "border-line"
                            }`}
                          />
                        )}
                        <p className="text-xs text-muted">
                          about {line.estimate}s
                          {line.language && ` · ${line.language}`}
                          {written !== null && (
                            <span className={cutOff.includes(line.text) ? "text-amber-300" : ""}>
                              {` · prompt gives ${clock(line.start!)}–${clock(line.end!)} (${written.toFixed(1)}s)`}
                              {cutOff.includes(line.text) && " · runs past the end of the clip"}
                            </span>
                          )}
                        </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setTexts((current) => {
                              if (current[key] === undefined) return { ...current, [key]: line.text };
                              const next = { ...current };
                              delete next[key];
                              return next;
                            })
                          }
                          aria-label={texts[key] === undefined ? `Edit the words of line ${lineIndex + 1}` : `Stop editing line ${lineIndex + 1}`}
                          title={texts[key] === undefined ? "Edit the words of this line" : "Stop editing (drops the change)"}
                          className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${
                            texts[key] === undefined ? "text-muted hover:text-foreground" : "bg-accent/20 text-accent"
                          }`}
                        >
                          ✎
                        </button>
                        {written !== null && (
                          <input
                            type="number"
                            min={0.5}
                            max={MAX_CLIP_SECONDS}
                            step={0.1}
                            value={durations[key] ?? ""}
                            placeholder={written.toFixed(1)}
                            aria-label={`Seconds for line ${lineIndex + 1} of segment ${index + 1}`}
                            title="Seconds this line gets. Leave empty to keep it."
                            onChange={(event) => setDurations((current) => ({ ...current, [key]: event.target.value }))}
                            className="w-16 shrink-0 rounded-md border border-line bg-background px-2 py-1 text-xs text-foreground"
                          />
                        )}
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
