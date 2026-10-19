"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLoggedFetch } from "@/components/debug-log";
import { IconButton, Icons } from "@/components/icons";
import { UpdateCommentDialog } from "@/components/update-comment-dialog";
import { TabStatus } from "@/lib/tab-status";
import { buildExportPayload, buildMarkdownExport, downloadJson, downloadMarkdown } from "@/lib/export";
import type {
  Character,
  Frame,
  PromptSegment,
  PromptRevision,
  ReferenceImage,
  Story,
  StoryLocation,
  StoryStep,
  StoryAnalysis,
  StorySummary,
  VideoRun,
} from "@/lib/types";
import { IMAGE_ASPECT_RATIOS, STORY_STEPS, effectiveGist, stepLabel, storyPath, storyRevisions } from "@/lib/types";

type Busy = "analyze" | "cast" | "imagePrompt" | "image" | "breakdown" | "prompts" | "update" | "video" | null;

const VIDEO_POLL_MS = 5000;

const BUSY_LABELS: Record<NonNullable<Busy>, string> = {
  analyze: "Story analysis",
  cast: "Cast",
  imagePrompt: "Image prompt",
  image: "Reference image",
  breakdown: "Frames",
  prompts: "H3 prompts",
  update: "Prompt update",
  video: "Sending video",
};

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function newFrameId(frames: Frame[]): string {
  return `f${Math.max(0, ...frames.map((frame) => Number(frame.id.replace(/\D/g, "")) || 0)) + 1}`;
}

function imageSrc(image: ReferenceImage) {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  return `/api/image/view?${query}`;
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
  const [updateOpen, setUpdateOpen] = useState(false);
  const [castCommentOpen, setCastCommentOpen] = useState(false);
  const [castComment, setCastComment] = useState("");
  const [queuePositions, setQueuePositions] = useState<Record<string, number>>({});
  const [clock, setClock] = useState(0);
  const [saveState, setSaveState] = useState("Saved");
  const skipSave = useRef(true);
  const storyRef = useRef<Story | null>(null);
  const persistTail = useRef(Promise.resolve());

  useEffect(() => {
    storyRef.current = story;
  }, [story]);

  function persist(next: Story) {
    storyRef.current = next;
    const task = persistTail.current.then(async () => {
      const payload = storyRef.current;
      if (!payload) throw new Error("Story is not loaded.");
      const response = await request(`/api/stories/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed.");
      const saved = data.story as Story;
      if (
        storyRef.current &&
        storyRef.current.promptRevisions.length > saved.promptRevisions.length
      ) {
        return storyRef.current;
      }
      if (storyRef.current === payload || storyRef.current === next) {
        storyRef.current = saved;
      }
      return storyRef.current || saved;
    });
    persistTail.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
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
        const latest = storyRef.current;
        if (!latest) return;
        const saved = await persist(latest);
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

  async function runAnalyze(): Promise<Story | null> {
    const current = storyRef.current || story;
    if (!current) return null;
    const response = await request("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gist: current.gist }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Story analysis failed.");
    const next: Story = { ...current, analysis: data.analysis as StoryAnalysis, useOriginalGist: false };
    skipSave.current = true;
    const saved = await persist(next);
    setStory(saved);
    return saved;
  }

  // Gist button: analyse the story first, then extract the cast from the (possibly corrected) gist.
  async function runAnalyzeAndCast() {
    if (!story) return;
    setBusy("analyze");
    setError("");
    try {
      const analysed = await runAnalyze();
      if (analysed) await runCast("", analysed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Story analysis failed.");
      setBusy(null);
    }
  }

  async function reanalyze() {
    setBusy("analyze");
    setError("");
    try {
      await runAnalyze();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Story analysis failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runCast(comment = "", base?: Story) {
    const source = base || storyRef.current || story;
    if (!source) return;
    setBusy("cast");
    setError("");
    try {
      const response = await request("/api/cast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gist: effectiveGist(source),
          comment: comment.trim(),
          previous: { characters: source.characters, location: source.location },
          analysis: source.analysis,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cast extraction failed.");
      const next: Story = {
        ...source,
        title: data.title || source.title,
        characters: data.characters || [],
        location: data.location || source.location,
        step: "cast",
      };
      skipSave.current = true;
      setStory(await persist(next));
      setCastCommentOpen(false);
      setCastComment("");
      router.push(storyPath(storyId, "cast"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cast extraction failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runImagePrompt() {
    if (!story) return;
    setBusy("imagePrompt");
    setError("");
    try {
      const response = await request("/api/image-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gist: effectiveGist(story),
          title: story.title,
          characters: story.characters,
          location: story.location,
          analysis: story.analysis,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Image prompt generation failed.");
      const next: Story = {
        ...story,
        imagePrompt: data.prompt || "",
        imageNegative: data.negative || "",
        imageLayout: data.layout || "",
        imageSettings: { ...story.imageSettings, aspectRatio: data.aspectRatio || story.imageSettings.aspectRatio },
        step: "image",
      };
      skipSave.current = true;
      setStory(await persist(next));
      router.push(storyPath(storyId, "image"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image prompt generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runImage() {
    if (!story) return;
    setBusy("image");
    setError("");
    try {
      const settings = story.imageSettings;
      const response = await request("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: story.id,
          prompt: story.imagePrompt,
          negative: story.imageNegative,
          aspectRatio: settings.aspectRatio,
          megapixels: settings.megapixels,
          seed: settings.seed,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Image generation failed.");
      const current = storyRef.current || story;
      const image: ReferenceImage = {
        id: crypto.randomUUID(),
        filename: data.image.filename,
        subfolder: data.image.subfolder,
        type: data.image.type,
        prompt: current.imagePrompt,
        seed: settings.seed,
        aspectRatio: settings.aspectRatio,
        megapixels: settings.megapixels,
        createdAt: new Date().toISOString(),
      };
      const next: Story = {
        ...current,
        referenceImages: [image, ...current.referenceImages],
        selectedImageId: image.id,
      };
      skipSave.current = true;
      setStory(await persist(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runVideo() {
    const current = storyRef.current || story;
    if (!current) return;
    const image = current.referenceImages.find((item) => item.id === current.selectedImageId);
    if (!image) {
      setError("Select a reference image on the Image step first.");
      return;
    }
    setBusy("video");
    setError("");
    try {
      const settings = current.videoSettings;
      const response = await request("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: current.id,
          segments: current.segments.map((segment) => ({ duration: segment.duration, prompt: segment.prompt })),
          image: { filename: image.filename, subfolder: image.subfolder, type: image.type },
          devMode: settings.devMode,
          seed: settings.seed,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the video.");
      const run: VideoRun = {
        id: crypto.randomUUID(),
        promptId: data.promptId,
        project: data.project,
        devMode: settings.devMode,
        seed: settings.seed,
        segmentCount: current.segments.length,
        revisionId: current.activeRevisionId,
        status: "queued",
        segmentsDone: 0,
        error: "",
        video: null,
        createdAt: new Date().toISOString(),
        finishedAt: "",
      };
      const latest = storyRef.current || current;
      const next: Story = { ...latest, videos: [run, ...latest.videos], step: "video" };
      skipSave.current = true;
      setStory(await persist(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the video.");
    } finally {
      setBusy(null);
    }
  }

  function updateVideoSettings(next: Partial<Story["videoSettings"]>) {
    if (!story) return;
    patchStory({ videoSettings: { ...story.videoSettings, ...next } });
  }

  const activeRunId = story?.videos.find((run) => run.status === "queued" || run.status === "running")?.id;

  useEffect(() => {
    if (!activeRunId) return;
    let stopped = false;
    async function tick() {
      const run = storyRef.current?.videos.find((item) => item.id === activeRunId);
      if (!run) return;
      const query = new URLSearchParams({
        promptId: run.promptId,
        project: run.project,
        segments: String(run.segmentCount),
        startedAt: run.createdAt,
      });
      try {
        const response = await fetch(`/api/video/status?${query}`);
        const data = await response.json();
        if (stopped || !response.ok) return;
        setQueuePositions((positions) => ({ ...positions, [run.id]: data.queuePosition || 0 }));
        if (
          data.status === run.status &&
          data.segmentsDone === run.segmentsDone &&
          (data.error || "") === run.error
        ) {
          return;
        }
        const finished = data.status === "done" || data.status === "error";
        setStory((current) =>
          current
            ? {
                ...current,
                videos: current.videos.map((item) =>
                  item.id === run.id
                    ? {
                        ...item,
                        status: data.status,
                        segmentsDone: data.segmentsDone,
                        video: data.video || null,
                        error: data.error || "",
                        finishedAt: finished ? new Date().toISOString() : "",
                      }
                    : item,
                ),
              }
            : current,
        );
      } catch {
        // ComfyUI or the app was briefly unreachable; try again on the next tick.
      }
    }
    void tick();
    const timer = window.setInterval(() => void tick(), VIDEO_POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeRunId]);

  // Tab title + favicon: progress while something runs, a quiet done/failed marker when it ends.
  // Only a running -> not running transition seen by this page fires the marker, never a finished state on load.
  const activeRun = story?.videos.find((run) => run.id === activeRunId);
  const tabTask = busy
    ? { key: `busy:${busy}`, label: BUSY_LABELS[busy], percent: null }
    : activeRun
      ? {
          key: `video:${activeRun.id}`,
          label: activeRun.status === "queued" ? "Video queued" : "Video",
          percent: activeRun.status === "running" ? (activeRun.segmentsDone / activeRun.segmentCount) * 100 : null,
        }
      : null;
  const lastTabTask = useRef<{ key: string; label: string } | null>(null);
  useEffect(() => {
    if (tabTask) {
      TabStatus.running(tabTask.label, tabTask.percent);
    } else if (lastTabTask.current) {
      const { key, label } = lastTabTask.current;
      const run = key.startsWith("video:") ? story?.videos.find((item) => `video:${item.id}` === key) : undefined;
      const failed = run ? run.status === "error" : Boolean(error);
      TabStatus.finished(failed ? "failed" : "done", run ? "Video" : label);
    } else {
      TabStatus.idle();
    }
    lastTabTask.current = tabTask ? { key: tabTask.key, label: tabTask.label } : null;
  }, [tabTask?.key, tabTask?.label, tabTask?.percent]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => TabStatus.idle(), []);

  useEffect(() => {
    if (!activeRunId) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeRunId]);

  function updateLocation(next: Partial<StoryLocation>) {
    if (!story) return;
    patchStory({ location: { ...story.location, ...next } });
  }

  function updateImageSettings(next: Partial<Story["imageSettings"]>) {
    if (!story) return;
    patchStory({ imageSettings: { ...story.imageSettings, ...next } });
  }

  async function runBreakdown() {
    if (!story) return;
    setBusy("breakdown");
    setError("");
    try {
      const response = await request("/api/breakdown", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gist: effectiveGist(story),
          characters: story.characters,
          location: story.location,
          layout: story.imageLayout,
          analysis: story.analysis,
        }),
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
          gist: effectiveGist(story),
          title: story.title,
          characters: story.characters,
          frames: story.frames,
          reference: Boolean(story.selectedImageId),
          location: story.location,
          layout: story.imageLayout,
          analysis: story.analysis,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompt generation failed.");
      const segments = (data.segments || []) as PromptSegment[];
      await saveRevision(segments);
      router.push(storyPath(storyId, "prompts"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveRevision(segments: PromptSegment[], activate = true) {
    const current = storyRef.current;
    if (!current) return;
    const prior = current.promptRevisions.length
      ? current.promptRevisions
      : current.segments.length
        ? [
            {
              id: current.activeRevisionId || "1",
              createdAt: current.updatedAt,
              segments: current.segments,
            },
          ]
        : [];
    const revision: PromptRevision = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      segments,
    };
    const next: Story = {
      ...current,
      segments: activate ? segments : current.segments,
      promptRevisions: [...prior, revision],
      activeRevisionId: activate ? revision.id : current.activeRevisionId || prior[0]?.id || revision.id,
      step: "prompts",
    };
    skipSave.current = true;
    storyRef.current = next;
    setStory(next);
    const saved = await persist(next);
    skipSave.current = true;
    setStory(saved);
  }

  async function previewUpdate(comment: string, ids: string[]) {
    if (!story) throw new Error("Story is not loaded.");
    setBusy("update");
    setError("");
    try {
      const targets = story.segments
        .map((segment, index) => {
          const frame = story.frames.find((item) => item.id === segment.id);
          return {
            id: segment.id,
            number: index + 1,
            duration: segment.duration,
            prompt: segment.prompt,
            title: frame?.title || `Prompt ${index + 1}`,
            summary: frame?.summary || "",
          };
        })
        .filter((target) => ids.includes(target.id));
      const response = await request("/api/prompts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gist: effectiveGist(story),
          title: story.title,
          comment,
          characters: story.characters,
          frames: story.frames,
          targets,
          reference: Boolean(story.selectedImageId),
          analysis: story.analysis,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompt update failed.");
      return (data.segments || []) as PromptSegment[];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt update failed.");
      throw err;
    } finally {
      setBusy(null);
    }
  }

  async function applyUpdate(updated: PromptSegment[]) {
    const current = storyRef.current;
    if (!current) return;
    setUpdateOpen(false);
    setBusy("update");
    setError("");
    try {
      const byId = new Map(updated.map((segment) => [segment.id, segment]));
      const segments = current.segments.map((segment) => byId.get(segment.id) || segment);
      await saveRevision(segments, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt update failed.");
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

  function exportSlug() {
    return (story?.title || "story-prompts").toLowerCase().replace(/[^a-z0-9]+/g, "-") || "story-prompts";
  }

  function exportJson() {
    if (!story) return;
    downloadJson(`${exportSlug()}.json`, buildExportPayload(story.title || "Untitled story", story.segments));
  }

  function exportMarkdown() {
    if (!story) return;
    downloadMarkdown(
      `${exportSlug()}.md`,
      buildMarkdownExport(story.title || "Untitled story", story.segments, story.frames),
    );
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

  const revisions = storyRevisions(story);
  const activeRevisionId =
    story.activeRevisionId || revisions[revisions.length - 1]?.id || "";

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
                  <IconButton
                    label="Open in new tab"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted hover:text-foreground"
                    onClick={() => window.open(storyPath(item.id, item.step), "_blank", "noopener,noreferrer")}
                  >
                    {Icons.external}
                  </IconButton>
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
          <div className="flex gap-2">
            <IconButton
              label="Export JSON"
              onClick={exportJson}
              disabled={story.segments.length === 0}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink disabled:opacity-50"
            >
              {Icons.download}
            </IconButton>
            <IconButton
              label="Export Markdown"
              onClick={exportMarkdown}
              disabled={story.segments.length === 0}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-line text-foreground disabled:opacity-50"
            >
              {Icons.markdown}
            </IconButton>
          </div>
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
                onClick={runAnalyzeAndCast}
                disabled={busy !== null || !story.gist.trim()}
                className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
              >
                {busy === "analyze"
                  ? "Analysing the story…"
                  : busy === "cast"
                    ? "Extracting cast and location…"
                    : "Progress: analyse, cast & location"}
              </button>
              {busy && <p className="self-center text-xs text-muted">OpenRouter can take one to two minutes.</p>}
            </div>
          </section>
        )}

        {step === "cast" && (
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Cast & location</h2>
                <p className="mt-1 text-xs text-muted">
                  Edit anything before writing the reference image prompt. These stay locked for frames.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <IconButton
                  label={busy === "cast" ? "Extracting cast" : "Extract again from gist"}
                  onClick={() => setCastCommentOpen((open) => !open)}
                  disabled={busy !== null || !story.gist.trim()}
                >
                  {Icons.refresh}
                </IconButton>
                <button
                  type="button"
                  onClick={runImagePrompt}
                  disabled={busy !== null || story.characters.length === 0 || !story.location.description.trim()}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  {busy === "imagePrompt" ? "Writing image prompt…" : "Progress: reference image prompt"}
                </button>
              </div>
            </div>
            {story.analysis ? (
              <div className="mb-5 rounded-2xl border border-line bg-card p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs uppercase tracking-wider text-muted">Story analysis</span>
                    <span className="rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-accent-ink">
                      {story.analysis.format.replace(/_/g, " ")}
                    </span>
                    {story.analysis.narrator && (
                      <span className="rounded-full border border-line px-3 py-0.5 text-xs text-muted">narrator</span>
                    )}
                  </div>
                  <IconButton
                    label={busy === "analyze" ? "Analysing" : "Analyse again"}
                    onClick={reanalyze}
                    disabled={busy !== null || !story.gist.trim()}
                  >
                    {Icons.refresh}
                  </IconButton>
                </div>
                <p className="text-sm leading-6">{story.analysis.formatReason}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  <span className="uppercase tracking-wider">Payoff · </span>
                  {story.analysis.payoff}
                </p>
                {story.analysis.sensitivity && (
                  <p className="mt-1 text-xs leading-5 text-amber-300">{story.analysis.sensitivity}</p>
                )}

                {!story.analysis.logicOk && story.analysis.suggestedGist && (
                  <div className="mt-3 rounded-xl border border-amber-700/60 bg-amber-950/30 p-3 text-sm">
                    <p className="text-amber-200">
                      <span className="font-semibold">Logic check: </span>
                      {story.analysis.logicIssue}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-wider text-muted">Corrected version</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6">{story.analysis.suggestedGist}</p>
                    <label className="mt-3 flex items-center gap-2 text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={!story.useOriginalGist}
                        onChange={(event) => patchStory({ useOriginalGist: !event.target.checked })}
                      />
                      Use the corrected version for everything after this step (untick to keep your original gist)
                    </label>
                  </div>
                )}

                <ol className="mt-3 space-y-1 text-xs leading-5 text-muted">
                  {story.analysis.beats.map((beat, index) => (
                    <li key={beat.id}>
                      <span className="text-foreground">
                        {index + 1}. {beat.purpose}
                      </span>{" "}
                      · {beat.delivery} · ~{beat.seconds}s — {beat.content}
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              story.characters.length > 0 && (
                <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-card p-4 text-sm">
                  <p className="text-muted">This story has no format analysis yet.</p>
                  <button
                    type="button"
                    onClick={reanalyze}
                    disabled={busy !== null || !story.gist.trim()}
                    className="rounded-full border border-line px-4 py-1.5 text-sm"
                  >
                    {busy === "analyze" ? "Analysing…" : "Analyse story"}
                  </button>
                </div>
              )
            )}

            {castCommentOpen && (
              <div className="mb-5 rounded-2xl border border-line bg-card p-4">
                <label className="block text-xs uppercase tracking-wider text-muted">
                  Extract again · comment (optional)
                  <textarea
                    value={castComment}
                    onChange={(event) => setCastComment(event.target.value)}
                    rows={3}
                    autoFocus
                    placeholder="What to change or take care of, e.g. make S2 older with a beard, keep the living room but make it night, add the neighbour as S3…"
                    className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm normal-case leading-6 tracking-normal text-foreground outline-none focus:border-accent"
                  />
                </label>
                <p className="mt-2 text-xs text-muted">
                  With a comment, the current cast and location are kept and only what you mention changes.
                  Without one, everything is extracted fresh from the gist.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => runCast(castComment)}
                    disabled={busy !== null}
                    className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
                  >
                    {busy === "cast" ? "Extracting…" : castComment.trim() ? "Apply comment" : "Extract fresh"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCastCommentOpen(false)}
                    disabled={busy === "cast"}
                    className="rounded-full border border-line px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {busy && <p className="mb-4 text-xs text-muted">OpenRouter can take one to two minutes.</p>}

            {story.characters.length === 0 ? (
              <p className="text-sm text-muted">No cast yet. Go back to Gist and run Progress: cast & location.</p>
            ) : (
              <>
                <h3 className="mb-2 text-xs uppercase tracking-wider text-muted">Characters</h3>
                <div className="mb-6 grid gap-3 md:grid-cols-2">
                  {story.characters.map((character) => (
                    <div key={character.id} className="rounded-xl border border-line bg-card p-4">
                      <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wider text-muted">
                        <span>{character.id}</span>
                        <input
                          value={character.name}
                          onChange={(event) => updateCharacter(character.id, { name: event.target.value })}
                          className="flex-1 bg-transparent text-sm normal-case tracking-normal text-foreground outline-none"
                        />
                      </div>
                      <textarea
                        value={character.look}
                        onChange={(event) => updateCharacter(character.id, { look: event.target.value })}
                        rows={4}
                        className="w-full resize-y bg-transparent text-sm leading-6 text-muted outline-none"
                      />
                    </div>
                  ))}
                </div>

                <h3 className="mb-2 text-xs uppercase tracking-wider text-muted">
                  Location {story.location.generated ? "· generated (not in gist)" : "· from gist"}
                </h3>
                <div className="rounded-xl border border-line bg-card p-4">
                  <input
                    value={story.location.name}
                    onChange={(event) => updateLocation({ name: event.target.value })}
                    className="mb-2 w-full bg-transparent text-sm font-medium outline-none"
                  />
                  <textarea
                    value={story.location.description}
                    onChange={(event) => updateLocation({ description: event.target.value })}
                    rows={5}
                    className="w-full resize-y bg-transparent text-sm leading-6 text-muted outline-none"
                  />
                </div>
              </>
            )}
          </section>
        )}

        {step === "image" && (
          <section>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Reference image</h2>
                <p className="mt-1 text-xs text-muted">
                  Generated with Z-Image Turbo in ComfyUI. The selected image becomes the H3 reference.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <IconButton
                  label={busy === "imagePrompt" ? "Writing image prompt" : "Rewrite image prompt"}
                  onClick={runImagePrompt}
                  disabled={busy !== null || story.characters.length === 0}
                >
                  {Icons.refresh}
                </IconButton>
                <button
                  type="button"
                  onClick={runBreakdown}
                  disabled={busy !== null || !story.gist.trim() || !story.selectedImageId}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  {busy === "breakdown" ? "Breaking into frames…" : "Progress: frames"}
                </button>
              </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-4 rounded-2xl border border-line bg-card p-4">
                <label className="block text-xs uppercase tracking-wider text-muted">
                  Prompt
                  <textarea
                    value={story.imagePrompt}
                    onChange={(event) => patchStory({ imagePrompt: event.target.value })}
                    rows={9}
                    className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm normal-case leading-6 tracking-normal text-foreground outline-none focus:border-accent"
                  />
                </label>
                <label className="block text-xs uppercase tracking-wider text-muted">
                  Negative
                  <textarea
                    value={story.imageNegative}
                    onChange={(event) => patchStory({ imageNegative: event.target.value })}
                    rows={2}
                    className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-sm normal-case leading-6 tracking-normal text-foreground outline-none focus:border-accent"
                  />
                </label>
                {story.imageLayout && (
                  <p className="text-xs leading-5 text-muted">
                    <span className="uppercase tracking-wider">Layout · </span>
                    {story.imageLayout}
                  </p>
                )}
                <div className="flex flex-wrap items-end gap-3 text-xs text-muted">
                  <label className="flex flex-col gap-1">
                    Aspect
                    <select
                      value={story.imageSettings.aspectRatio}
                      onChange={(event) => updateImageSettings({ aspectRatio: event.target.value })}
                      className="rounded-md border border-line bg-background px-2 py-1 text-foreground"
                    >
                      {IMAGE_ASPECT_RATIOS.map((ratio) => (
                        <option key={ratio} value={ratio}>
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    Megapixels
                    <input
                      type="number"
                      min={0.1}
                      max={4}
                      step={0.1}
                      value={story.imageSettings.megapixels}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) updateImageSettings({ megapixels: next });
                      }}
                      className="w-20 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Seed
                    <input
                      type="number"
                      min={0}
                      value={story.imageSettings.seed}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) updateImageSettings({ seed: Math.max(0, Math.floor(next)) });
                      }}
                      className="w-36 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => updateImageSettings({ seed: Math.floor(Math.random() * 2 ** 32) })}
                    className="rounded-full border border-line px-3 py-1 text-foreground"
                  >
                    New seed
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={runImage}
                    disabled={busy !== null || !story.imagePrompt.trim()}
                    className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                  >
                    {busy === "image" ? "Generating in ComfyUI…" : "Generate image"}
                  </button>
                  {busy === "image" && (
                    <p className="text-xs text-muted">The first run loads the model and can take a minute.</p>
                  )}
                </div>
              </div>

              <div>
                {story.referenceImages.length === 0 ? (
                  <p className="text-sm text-muted">No images yet. Generate one from the prompt.</p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const selected =
                        story.referenceImages.find((image) => image.id === story.selectedImageId) ||
                        story.referenceImages[0];
                      return (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={imageSrc(selected)}
                          alt="Selected reference image"
                          className="w-full rounded-2xl border border-line"
                        />
                      );
                    })()}
                    <div className="flex flex-wrap gap-2">
                      {story.referenceImages.map((image) => (
                        <button
                          key={image.id}
                          type="button"
                          title={`Seed ${image.seed}`}
                          onClick={() => patchStory({ selectedImageId: image.id })}
                          className={`overflow-hidden rounded-lg border-2 ${
                            image.id === story.selectedImageId ? "border-accent" : "border-transparent opacity-70"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={imageSrc(image)} alt={`Seed ${image.seed}`} className="h-16 w-auto" />
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-muted">
                      Saved in ComfyUI output:{" "}
                      {(() => {
                        const selected =
                          story.referenceImages.find((image) => image.id === story.selectedImageId) ||
                          story.referenceImages[0];
                        return `${selected.subfolder}/${selected.filename}`;
                      })()}
                    </p>
                  </div>
                )}
              </div>
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
              <div className="flex items-center gap-3">
                <IconButton label="Add frame" onClick={addFrame}>
                  {Icons.plus}
                </IconButton>
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
                      <IconButton label="Move up" onClick={() => moveFrame(index, -1)}>
                        {Icons.up}
                      </IconButton>
                      <IconButton label="Move down" onClick={() => moveFrame(index, 1)}>
                        {Icons.down}
                      </IconButton>
                      <IconButton label="Remove frame" onClick={() => removeFrame(frame.id)}>
                        {Icons.trash}
                      </IconButton>
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
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted">H3 prompts</h2>
                {revisions.map((revision, index) => {
                  const active = revision.id === activeRevisionId;
                  return (
                    <button
                      key={revision.id}
                      type="button"
                      title={`Prompt set ${index + 1}`}
                      aria-label={`Prompt set ${index + 1}`}
                      onClick={() =>
                        patchStory({
                          activeRevisionId: revision.id,
                          segments: revision.segments,
                        })
                      }
                      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-xs ${
                        active
                          ? "bg-foreground text-background"
                          : "border border-line text-muted"
                      }`}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUpdateOpen(true)}
                  disabled={busy !== null || story.segments.length === 0}
                  className="rounded-full border border-line px-4 py-2 text-sm"
                >
                  Update with comment
                </button>
                <IconButton
                  label={busy === "prompts" ? "Writing H3 prompts" : "Regenerate prompts"}
                  onClick={runPrompts}
                  disabled={busy !== null || story.frames.length === 0}
                >
                  {Icons.refresh}
                </IconButton>
                <button
                  type="button"
                  onClick={() => goTo("video")}
                  disabled={story.segments.length === 0}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  Progress: video
                </button>
              </div>
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
                        <IconButton
                          label={copiedId === segment.id ? "Copied" : "Copy prompt"}
                          onClick={() => copyPrompt(segment)}
                        >
                          {copiedId === segment.id ? Icons.check : Icons.copy}
                        </IconButton>
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

        {step === "video" && (
          <section>
            {(() => {
              const image = story.referenceImages.find((item) => item.id === story.selectedImageId);
              const refPrompts = story.segments.every((segment) =>
                segment.prompt.trimStart().startsWith("subject_definitions"),
              );
              const running = story.videos.some((run) => run.status === "queued" || run.status === "running");
              const totalVideoSeconds = story.segments.reduce((sum, segment) => sum + segment.duration, 0);
              return (
                <>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Video</h2>
                      <p className="mt-1 text-xs text-muted">
                        Runs the H3 long-take workflow in ComfyUI with the current prompt set ({story.segments.length}{" "}
                        segments · {totalVideoSeconds}s) and the selected reference image.
                      </p>
                    </div>
                  </div>

                  <div className="mb-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-4 rounded-2xl border border-line bg-card p-4">
                      <div className="flex items-center gap-3">
                        {image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageSrc(image)} alt="Reference image" className="h-20 w-auto rounded-lg border border-line" />
                        ) : (
                          <p className="text-sm text-red-200">No reference image selected. Pick one on the Image step.</p>
                        )}
                        <div className="text-xs leading-5 text-muted">
                          <p>{story.segments.length} segments: {story.segments.map((segment) => `${segment.duration}s`).join(" · ")}</p>
                          {!refPrompts && story.segments.length > 0 && (
                            <p className="text-amber-300">
                              These prompts are not in the reference-image format. Regenerate them on the Prompts step.
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-end gap-4 text-xs text-muted">
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={story.videoSettings.devMode}
                            onChange={(event) => updateVideoSettings({ devMode: event.target.checked })}
                          />
                          DEV MODE
                          <span className="text-xs text-muted">
                            {story.videoSettings.devMode
                              ? "fast draft · 0.47 MP · 10 steps"
                              : "final · 0.8 MP · 16 steps · RTX VSR"}
                          </span>
                        </label>
                        <label className="flex flex-col gap-1">
                          Seed
                          <input
                            type="number"
                            min={0}
                            value={story.videoSettings.seed}
                            onChange={(event) => {
                              const next = Number(event.target.value);
                              if (Number.isFinite(next)) updateVideoSettings({ seed: Math.max(0, Math.floor(next)) });
                            }}
                            className="w-44 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => updateVideoSettings({ seed: Math.floor(Math.random() * 2 ** 48) })}
                          className="rounded-full border border-line px-3 py-1 text-foreground"
                        >
                          New seed
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={runVideo}
                          disabled={busy !== null || running || !image || story.segments.length === 0}
                          className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
                        >
                          {busy === "video" ? "Sending to ComfyUI…" : running ? "Video in progress…" : "Generate video"}
                        </button>
                        <p className="text-xs text-muted">
                          {story.videoSettings.devMode ? "A draft takes about 11–14 min." : "A final takes about 29 min."}
                        </p>
                      </div>
                    </div>

                    <div>
                      {story.videos.length === 0 ? (
                        <p className="text-sm text-muted">No videos yet.</p>
                      ) : (
                        <ol className="space-y-4">
                          {story.videos.map((run) => {
                            const started = Date.parse(run.createdAt);
                            const ended = run.finishedAt ? Date.parse(run.finishedAt) : clock || started;
                            const active = run.status === "queued" || run.status === "running";
                            return (
                              <li key={run.id} className="rounded-2xl border border-line bg-card p-4">
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                                  <span>
                                    {run.devMode ? "Draft" : "Final"} · seed {run.seed} ·{" "}
                                    {new Date(run.createdAt).toLocaleString()}
                                  </span>
                                  <span
                                    className={
                                      run.status === "done"
                                        ? "text-emerald-300"
                                        : run.status === "error"
                                          ? "text-red-300"
                                          : "text-amber-300"
                                    }
                                  >
                                    {run.status === "queued" &&
                                      `Queued${queuePositions[run.id] ? ` · position ${queuePositions[run.id]}` : ""}`}
                                    {run.status === "running" &&
                                      `Running · ${run.segmentsDone}/${run.segmentCount} segments done`}
                                    {run.status === "done" && "Done"}
                                    {run.status === "error" && "Failed"}
                                    {" · "}
                                    {formatDuration(ended - started)}
                                  </span>
                                </div>
                                {active && (
                                  <div className="h-1.5 overflow-hidden rounded-full bg-background">
                                    <div
                                      className="h-full bg-accent transition-all"
                                      style={{ width: `${Math.max(4, (run.segmentsDone / run.segmentCount) * 100)}%` }}
                                    />
                                  </div>
                                )}
                                {run.error && <p className="mt-2 text-xs text-red-200">{run.error}</p>}
                                {run.video && (
                                  <>
                                    <video
                                      src={imageSrc({ ...run.video, id: run.id } as ReferenceImage)}
                                      controls
                                      className="mt-2 w-full rounded-xl border border-line"
                                    />
                                    <p className="mt-2 text-xs text-muted">
                                      ComfyUI output: {run.video.subfolder}\{run.video.filename}
                                    </p>
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  </div>
                </>
              );
            })()}
          </section>
        )}
      </main>
      <UpdateCommentDialog
        open={updateOpen}
        segments={story.segments}
        options={story.segments.map((segment, index) => ({
          id: segment.id,
          number: index + 1,
          title: story.frames.find((frame) => frame.id === segment.id)?.title || `Prompt ${index + 1}`,
        }))}
        busy={busy === "update"}
        onClose={() => {
          if (busy !== "update") setUpdateOpen(false);
        }}
        onPreview={previewUpdate}
        onApply={applyUpdate}
      />
    </div>
  );
}
