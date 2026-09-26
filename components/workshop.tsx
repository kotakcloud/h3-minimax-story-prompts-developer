"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLoggedFetch } from "@/components/debug-log";
import { buildExportPayload, downloadJson } from "@/lib/export";
import type { Character, Frame, PromptSegment, Story, StoryStep, StorySummary } from "@/lib/types";
import { STORY_STEPS, storyPath } from "@/lib/types";

type Busy = "breakdown" | "prompts" | null;

function newFrameId(frames: Frame[]): string {
  return `f${Math.max(0, ...frames.map((frame) => Number(frame.id.replace(/\D/g, "")) || 0)) + 1}`;
}

function stepLabel(step: StoryStep) {
  if (step === "gist") return "Gist";
  if (step === "frames") return "Frames";
  return "Prompts";
}

export function Workshop({
  storyId,
  step,
}: {
  storyId: string;
  step: StoryStep;
}) {
  const router = useRouter();
  const request = useLoggedFetch();
  const [story, setStory] = useState<Story | null>(null);
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [saveState, setSaveState] = useState("Saved");
  const skipSave = useRef(true);
  const storyRef = useRef<Story | null>(null);
  storyRef.current = story;

  async function persist(next: Story) {
    const response = await request(`/api/stories/${next.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Save failed.");
    return data.story as Story;
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [storyRes, listRes] = await Promise.all([
        request(`/api/stories/${storyId}`),
        request("/api/stories"),
      ]);
      const storyData = await storyRes.json();
      const listData = await listRes.json();
      if (cancelled) return;
      if (!storyRes.ok) {
        setError(storyData.error || "Story not found.");
        return;
      }
      const loaded = storyData.story as Story;
      skipSave.current = loaded.step === step;
      setStory({ ...loaded, step });
      setStories(listData.stories || []);
    }
    load().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load story.");
    });
    return () => {
      cancelled = true;
    };
  }, [storyId, step, request]);

  useEffect(() => {
    if (!story) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    setSaveState("Saving…");
    const timer = window.setTimeout(async () => {
      try {
        const saved = await persist(story);
        skipSave.current = true;
        setStory(saved);
        setSaveState("Saved");
      } catch (err) {
        setSaveState(err instanceof Error ? err.message : "Save failed.");
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [story]);

  useEffect(() => {
    return () => {
      const latest = storyRef.current;
      if (!latest) return;
      void persist(latest).catch(() => undefined);
    };
  }, [storyId]);

  function patchStory(patch: Partial<Story>) {
    setStory((current) => (current ? { ...current, ...patch } : current));
  }

  async function goTo(next: StoryStep) {
    if (story && story.step !== next) {
      patchStory({ step: next });
    }
    router.push(storyPath(storyId, next));
  }

  async function runBreakdown() {
    if (!story) return;
    setBusy("breakdown");
    setError("");
    try {
      const response = await request("/api/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gist: story.gist }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Breakdown failed.");
      const next: Story = {
        ...story,
        title: data.title || story.title,
        characters: data.characters || [],
        frames: data.frames || [],
        segments: [],
        step: "frames",
      };
      skipSave.current = true;
      setStory(await persist(next));
      router.push(storyPath(storyId, "frames"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Breakdown failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runPrompts() {
    if (!story) return;
    setBusy("prompts");
    setError("");
    try {
      const response = await request("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gist: story.gist,
          title: story.title,
          characters: story.characters,
          frames: story.frames,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompt generation failed.");
      const next: Story = {
        ...story,
        segments: data.segments || [],
        step: "prompts",
      };
      skipSave.current = true;
      setStory(await persist(next));
      router.push(storyPath(storyId, "prompts"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt generation failed.");
    } finally {
      setBusy(null);
    }
  }

  function updateFrame(id: string, next: Partial<Frame>) {
    if (!story) return;
    patchStory({
      frames: story.frames.map((frame) => (frame.id === id ? { ...frame, ...next } : frame)),
      segments: [],
    });
  }

  function moveFrame(index: number, direction: -1 | 1) {
    if (!story) return;
    const next = index + direction;
    if (next < 0 || next >= story.frames.length) return;
    const copy = [...story.frames];
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    patchStory({ frames: copy, segments: [] });
  }

  function addFrame() {
    if (!story) return;
    patchStory({
      frames: [
        ...story.frames,
        { id: newFrameId(story.frames), title: "New frame", summary: "", duration: 8 },
      ],
      segments: [],
    });
  }

  function removeFrame(id: string) {
    if (!story) return;
    patchStory({
      frames: story.frames.filter((frame) => frame.id !== id),
      segments: story.segments.filter((segment) => segment.id !== id),
    });
  }

  function updateCharacter(id: string, next: Partial<Character>) {
    if (!story) return;
    patchStory({
      characters: story.characters.map((character) =>
        character.id === id ? { ...character, ...next } : character,
      ),
      segments: [],
    });
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
    if (!story) return;
    const payload = buildExportPayload(story.title || "Untitled story", story.segments);
    const slug = (story.title || "story-prompts").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadJson(`${slug || "story-prompts"}.json`, payload);
  }

  const totalSeconds = useMemo(
    () => (story?.frames || []).reduce((sum, frame) => sum + frame.duration, 0),
    [story?.frames],
  );

  if (!story) {
    return (
      <main className="mx-auto max-w-3xl px-5 py-16 text-sm text-muted">
        {error || "Loading story…"}
      </main>
    );
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-card md:border-b-0 md:border-r">
        <div className="sticky top-0 space-y-4 p-4">
          <Link href="/" className="text-xs uppercase tracking-[0.18em] text-accent">
            All stories
          </Link>
          <div>
            <p className="text-xs text-muted">Open another</p>
            <ul className="mt-2 space-y-1">
              {stories.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <Link
                    href={storyPath(item.id, item.step)}
                    className={`block min-w-0 flex-1 truncate rounded-md px-2 py-1 text-sm ${
                      item.id === storyId ? "bg-background text-foreground" : "text-muted"
                    }`}
                  >
                    {item.title}
                    <span className="ml-1 text-xs text-muted">{stepLabel(item.step)}</span>
                  </Link>
                  <a
                    href={storyPath(item.id, item.step)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted"
                  >
                    New tab
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>

      <main className="px-5 py-8 sm:px-8">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
          <div>
            <p className="font-mono text-xs text-muted">{story.id}</p>
            <input
              value={story.title}
              onChange={(event) => patchStory({ title: event.target.value })}
              className="mt-1 w-full max-w-xl bg-transparent text-3xl font-semibold tracking-tight outline-none"
            />
            <p className="mt-2 text-xs text-muted">{saveState}</p>
          </div>
          <button
            type="button"
            onClick={exportFile}
            disabled={story.segments.length === 0}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Export
          </button>
        </header>

        <nav className="mb-6 flex flex-wrap gap-2">
          {STORY_STEPS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => goTo(item)}
              className={`rounded-full px-4 py-1.5 text-sm ${
                step === item ? "bg-foreground text-background" : "border border-line text-muted"
              }`}
            >
              {stepLabel(item)}
            </button>
          ))}
        </nav>

        {error && (
          <p className="mb-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        {step === "gist" && (
          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">
              Story gist
            </h2>
            <textarea
              value={story.gist}
              onChange={(event) => patchStory({ gist: event.target.value })}
              rows={10}
              placeholder="Character A is introduced… then B arrives… they do this… C enters… the story ends when…"
              className="w-full resize-y rounded-xl border border-line bg-background px-4 py-3 text-sm leading-6 outline-none focus:border-accent"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={runBreakdown}
                disabled={busy !== null || !story.gist.trim()}
                className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
              >
                {busy === "breakdown" ? "Breaking into frames…" : "Progress: frames"}
              </button>
              {busy && <p className="self-center text-xs text-muted">OpenRouter can take one to two minutes.</p>}
            </div>
          </section>
        )}

        {step === "frames" && (
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Frames</h2>
                <p className="mt-1 text-xs text-muted">
                  {story.frames.length} frames · {totalSeconds}s total · durations must be 4–15s
                </p>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={addFrame} className="text-sm text-accent">
                  Add frame
                </button>
                <button
                  type="button"
                  onClick={runPrompts}
                  disabled={busy !== null || story.frames.length === 0}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  {busy === "prompts" ? "Writing H3 prompts…" : "Progress: H3 prompts"}
                </button>
              </div>
            </div>
            {busy && <p className="mb-4 text-xs text-muted">OpenRouter can take one to two minutes.</p>}

            {story.characters.length > 0 && (
              <div className="mb-5 grid gap-3 md:grid-cols-2">
                {story.characters.map((character) => (
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

            {story.frames.length === 0 ? (
              <p className="text-sm text-muted">
                No frames yet. Go back to Gist and run Progress: frames.
              </p>
            ) : (
              <ol className="space-y-4">
                {story.frames.map((frame, index) => (
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
            )}
          </section>
        )}

        {step === "prompts" && (
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wider text-muted">H3 prompts</h2>
              <button
                type="button"
                onClick={runPrompts}
                disabled={busy !== null || story.frames.length === 0}
                className="rounded-full border border-line px-4 py-2 text-sm"
              >
                {busy === "prompts" ? "Writing H3 prompts…" : "Regenerate prompts"}
              </button>
            </div>
            {story.segments.length === 0 ? (
              <p className="text-sm text-muted">
                No prompts yet. Open Frames and run Progress: H3 prompts.
              </p>
            ) : (
              <ol className="space-y-5">
                {story.segments.map((segment, index) => {
                  const frame = story.frames.find((item) => item.id === segment.id);
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
            )}
          </section>
        )}
      </main>
    </div>
  );
}
