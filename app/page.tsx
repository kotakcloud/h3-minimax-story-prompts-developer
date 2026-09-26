"use client";

import { useMemo, useState } from "react";
import { buildExportPayload, downloadJson } from "@/lib/export";
import type { Character, Frame, PromptSegment } from "@/lib/types";

type Busy = "breakdown" | "prompts" | null;

function newFrameId(frames: Frame[]): string {
  return `f${Math.max(0, ...frames.map((frame) => Number(frame.id.replace(/\D/g, "")) || 0)) + 1}`;
}

export default function Home() {
  const [gist, setGist] = useState("");
  const [title, setTitle] = useState("");
  const [characters, setCharacters] = useState<Character[]>([]);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [segments, setSegments] = useState<PromptSegment[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");

  const canExport = segments.length > 0;
  const step = frames.length === 0 ? 1 : 2;

  async function runBreakdown() {
    setBusy("breakdown");
    setError("");
    try {
      const response = await fetch("/api/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gist }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Breakdown failed.");
      setTitle(data.title || "");
      setCharacters(data.characters || []);
      setFrames(data.frames || []);
      setSegments([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Breakdown failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runPrompts() {
    setBusy("prompts");
    setError("");
    try {
      const response = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gist, title, characters, frames }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompt generation failed.");
      setSegments(data.segments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt generation failed.");
    } finally {
      setBusy(null);
    }
  }

  function updateFrame(id: string, patch: Partial<Frame>) {
    setFrames((current) =>
      current.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)),
    );
    setSegments([]);
  }

  function moveFrame(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= frames.length) return;
    const copy = [...frames];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    setFrames(copy);
    setSegments([]);
  }

  function addFrame() {
    setFrames((current) => [
      ...current,
      {
        id: newFrameId(current),
        title: "New frame",
        summary: "",
        duration: 8,
      },
    ]);
    setSegments([]);
  }

  function removeFrame(id: string) {
    setFrames((current) => current.filter((frame) => frame.id !== id));
    setSegments((current) => current.filter((segment) => segment.id !== id));
  }

  function updateCharacter(id: string, patch: Partial<Character>) {
    setCharacters((current) =>
      current.map((character) =>
        character.id === id ? { ...character, ...patch } : character,
      ),
    );
    setSegments([]);
  }

  async function copyPrompt(segment: PromptSegment) {
    try {
      await navigator.clipboard.writeText(segment.prompt);
      setCopiedId(segment.id);
      window.setTimeout(() => setCopiedId(""), 1500);
    } catch {
      setError("Clipboard is blocked here. Select the prompt text or use Export.");
    }
  }

  function exportFile() {
    const payload = buildExportPayload(title || "Untitled story", segments);
    const slug = (title || "story-prompts").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadJson(`${slug || "story-prompts"}.json`, payload);
  }

  const totalSeconds = useMemo(
    () => frames.reduce((sum, frame) => sum + frame.duration, 0),
    [frames],
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-5 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-accent">MiniMax H3</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Story Prompt Workshop</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Paste a gist, break it into editable frames, then generate paste-ready T2VA
            prompts. Default model: deepseek/deepseek-v4-flash-0731.
          </p>
        </div>
        <button
          type="button"
          onClick={exportFile}
          disabled={!canExport}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Export
        </button>
      </header>

      <section className="rounded-2xl border border-line bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted">
            1. Story gist
          </h2>
          <span className="text-xs text-muted">Step {step} of 2</span>
        </div>
        <textarea
          value={gist}
          onChange={(event) => setGist(event.target.value)}
          rows={8}
          placeholder="Character A is introduced… then B arrives… they do this… C enters… the story ends when…"
          className="w-full resize-y rounded-xl border border-line bg-background px-4 py-3 text-sm leading-6 outline-none focus:border-accent"
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={runBreakdown}
            disabled={busy !== null || !gist.trim()}
            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
          >
            {busy === "breakdown" ? "Breaking into frames…" : "Progress: frames"}
          </button>
          {frames.length > 0 && (
            <button
              type="button"
              onClick={runPrompts}
              disabled={busy !== null}
              className="rounded-full border border-line px-5 py-2 text-sm"
            >
              {busy === "prompts" ? "Writing H3 prompts…" : "Progress: H3 prompts"}
            </button>
          )}
          {busy && (
            <p className="self-center text-xs text-muted">
              OpenRouter can take one to two minutes.
            </p>
          )}
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {frames.length > 0 && (
        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted">
                2. Frames
              </h2>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-2 w-full max-w-md border-b border-line bg-transparent pb-1 text-xl outline-none focus:border-accent"
              />
              <p className="mt-1 text-xs text-muted">
                {frames.length} frames · {totalSeconds}s total · durations must be 4–15s
              </p>
            </div>
            <button
              type="button"
              onClick={addFrame}
              className="text-sm text-accent"
            >
              Add frame
            </button>
          </div>

          {characters.length > 0 && (
            <div className="mb-5 grid gap-3 md:grid-cols-2">
              {characters.map((character) => (
                <div key={character.id} className="rounded-xl border border-line bg-card p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                    <span>{character.id}</span>
                    <input
                      value={character.name}
                      onChange={(event) =>
                        updateCharacter(character.id, { name: event.target.value })
                      }
                      className="flex-1 bg-transparent text-sm normal-case tracking-normal text-foreground outline-none"
                    />
                  </div>
                  <textarea
                    value={character.look}
                    onChange={(event) =>
                      updateCharacter(character.id, { look: event.target.value })
                    }
                    rows={3}
                    className="w-full resize-y bg-transparent text-sm leading-6 text-muted outline-none"
                  />
                </div>
              ))}
            </div>
          )}

          <ol className="space-y-4">
            {frames.map((frame, index) => (
              <li key={frame.id} className="rounded-2xl border border-line bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{index + 1}</span>
                  <input
                    value={frame.title}
                    onChange={(event) => updateFrame(frame.id, { title: event.target.value })}
                    className="min-w-40 flex-1 bg-transparent text-sm font-medium outline-none"
                  />
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Duration
                    <input
                      type="number"
                      min={4}
                      max={15}
                      value={frame.duration}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isFinite(next)) return;
                        updateFrame(frame.id, {
                          duration: Math.min(15, Math.max(4, Math.round(next))),
                        });
                      }}
                      className="w-16 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                    />
                  </label>
                  <button type="button" onClick={() => moveFrame(index, -1)} className="text-xs text-muted">
                    Up
                  </button>
                  <button type="button" onClick={() => moveFrame(index, 1)} className="text-xs text-muted">
                    Down
                  </button>
                  <button type="button" onClick={() => removeFrame(frame.id)} className="text-xs text-muted">
                    Remove
                  </button>
                </div>
                <textarea
                  value={frame.summary}
                  onChange={(event) => updateFrame(frame.id, { summary: event.target.value })}
                  rows={4}
                  className="w-full resize-y bg-transparent text-sm leading-6 outline-none"
                />
              </li>
            ))}
          </ol>
        </section>
      )}

      {segments.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">
            3. H3 prompts
          </h2>
          <ol className="space-y-5">
            {segments.map((segment, index) => {
              const frame = frames.find((item) => item.id === segment.id);
              return (
                <li key={segment.id} className="rounded-2xl border border-line bg-card p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {index + 1}. {frame?.title || segment.id}
                      </p>
                      <p className="text-xs text-muted">{segment.duration}s</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyPrompt(segment)}
                      className="rounded-full border border-line px-3 py-1 text-xs"
                    >
                      {copiedId === segment.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-5 text-muted">
                    {segment.prompt}
                  </pre>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </main>
  );
}
