"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useLoggedFetch } from "@/components/debug-log";
import { IconButton, Icons } from "@/components/icons";
import { Lightbox, type Slide } from "@/components/lightbox";
import { LoraDialog } from "@/components/lora-dialog";
import { ModelPicker } from "@/components/model-picker";
import { framesFromAnalysis } from "@/lib/beats";
import { panelPosition, selectedGrid } from "@/lib/grid";
import { FAST_ENGINE_STEPS, VIDEO_ENGINES, engineInfo, fastStorySize, isFastEngine } from "@/lib/engines";
import { UpdateCommentDialog } from "@/components/update-comment-dialog";
import { TabStatus } from "@/lib/tab-status";
import { buildExportPayload, buildMarkdownExport, downloadJson, downloadMarkdown } from "@/lib/export";
import type {
  Comparison,
  Character,
  Frame,
  PromptSegment,
  PromptRevision,
  PromptStyle,
  ReferenceImage,
  Story,
  StoryLocation,
  StoryStep,
  StoryAnalysis,
  StorySummary,
  VideoRun,
} from "@/lib/types";
import {
  IMAGE_ASPECT_RATIOS,
  STORY_STEPS,
  STORY_V2_MAX_SEGMENT_SECONDS,
  activePromptStyle,
  effectiveGist,
  promptTimestamps,
  stepLabel,
  storyPath,
  storyRevisions,
} from "@/lib/types";

type Busy = "analyze" | "cast" | "imagePrompt" | "image" | "upload" | "translate" | "compare" | "breakdown" | "prompts" | "update" | "video" | null;

const VIDEO_POLL_MS = 5000;

// What the prompt routes need to know about a storyboard grid reference (null otherwise).
function gridForPrompts(story: Story) {
  const grid = selectedGrid(story)?.grid;
  return grid ? { rows: grid.rows, cols: grid.cols, feed: story.gridFeed } : null;
}

// Uploaded pictures are stored as PNG (the long take reads the size from the PNG header),
// scaled down to at most this many pixels.
const UPLOAD_MAX_PIXELS = 4_000_000;

// The supported aspect ratio closest to width x height.
function nearestAspectRatio(width: number, height: number): string {
  const target = Math.log(width / height);
  let best: string = IMAGE_ASPECT_RATIOS[0];
  let bestDistance = Infinity;
  for (const ratio of IMAGE_ASPECT_RATIOS) {
    const [w, h] = ratio.split(" ")[0].split(":").map(Number);
    const distance = Math.abs(Math.log(w / h) - target);
    if (distance < bestDistance) {
      best = ratio;
      bestDistance = distance;
    }
  }
  return best;
}

async function toPng(file: File): Promise<{ blob: Blob; width: number; height: number; canvas: HTMLCanvasElement }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, Math.sqrt(UPLOAD_MAX_PIXELS / (bitmap.width * bitmap.height)));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot convert the image.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not convert the image to PNG.");
  return { blob, width, height, canvas };
}

// Cuts a storyboard grid into its panels (reading order), trimming near-white gutters and margins
// from each cell's edges so the panels hold picture only.
async function cutPanels(
  canvas: HTMLCanvasElement,
  rows: number,
  cols: number,
): Promise<{ blob: Blob; width: number; height: number }[]> {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot cut the grid.");
  const cellW = canvas.width / cols;
  const cellH = canvas.height / rows;
  const isBlank = (x: number, y: number, w: number, h: number) => {
    const data = context.getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
    let light = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235) light += 1;
    }
    return light / (data.length / 4) > 0.97;
  };
  const panels: { blob: Blob; width: number; height: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let x0 = Math.round(col * cellW);
      let y0 = Math.round(row * cellH);
      let x1 = Math.round((col + 1) * cellW);
      let y1 = Math.round((row + 1) * cellH);
      const maxTrimX = Math.round(cellW * 0.08);
      const maxTrimY = Math.round(cellH * 0.08);
      for (let i = 0; i < maxTrimX && isBlank(x0, y0, 1, y1 - y0); i += 1) x0 += 1;
      for (let i = 0; i < maxTrimX && isBlank(x1 - 1, y0, 1, y1 - y0); i += 1) x1 -= 1;
      for (let i = 0; i < maxTrimY && isBlank(x0, y0, x1 - x0, 1); i += 1) y0 += 1;
      for (let i = 0; i < maxTrimY && isBlank(x0, y1 - 1, x1 - x0, 1); i += 1) y1 -= 1;
      const panel = document.createElement("canvas");
      panel.width = x1 - x0;
      panel.height = y1 - y0;
      panel.getContext("2d")?.drawImage(canvas, x0, y0, panel.width, panel.height, 0, 0, panel.width, panel.height);
      const blob = await new Promise<Blob | null>((resolve) => panel.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Could not cut the grid.");
      panels.push({ blob, width: panel.width, height: panel.height });
    }
  }
  return panels;
}

const BUSY_LABELS: Record<NonNullable<Busy>, string> = {
  analyze: "Story analysis",
  cast: "Cast",
  imagePrompt: "Image prompt",
  image: "Reference image",
  upload: "Uploading image",
  translate: "Translating dialogue",
  compare: "Building comparison",
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

// The lines that describe a generation in a comparison (burned into the video and listed under it).
function runLabelLines(run: VideoRun, story: Story, letter: string): string[] {
  const revisions = storyRevisions(story);
  const setNumber = revisions.findIndex((revision) => revision.id === run.revisionId) + 1;
  const revision = revisions[setNumber - 1];
  const durations = run.durations || revision?.segments.map((segment) => segment.duration) || [];
  const quality = [
    run.devMode ? "DEV" : run.engine === "long-take" || !run.engine ? "Final" : "FULL",
    run.width && run.height ? `${run.width}×${run.height}` : run.megapixels ? `${run.megapixels} MP` : "",
    run.steps ? `${run.steps} steps` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    `${letter} · ${engineInfo(run.engine).short} · ${quality}`,
    [
      setNumber > 0 ? `set ${setNumber}${revision?.language ? ` (${revision.language})` : ""}` : "set deleted",
      durations.length ? `${durations.reduce((sum, value) => sum + value, 0)} s` : "",
      run.totalSegments && run.totalSegments > run.segmentCount ? `first ${run.segmentCount} of ${run.totalSegments}` : "",
      `seed ${run.seed}`,
    ]
      .filter(Boolean)
      .join(" · "),
    run.loras?.length
      ? `LoRA: ${run.loras.map((lora) => `${lora.name.replace(/^minimax-h3[\\/]/i, "").replace(/\.safetensors$/i, "")} ${lora.strength}`).join(", ")}`
      : "no LoRA",
  ];
}

// Viewer slides for a reference image: the picture itself, then its storyboard panels if it is a grid.
function imageSlides(image: ReferenceImage): Slide[] {
  const name = image.originalName || image.filename;
  return [
    {
      src: imageSrc(image),
      title: image.grid ? `${name} · storyboard ${image.grid.rows}×${image.grid.cols}` : name,
      caption: image.prompt || undefined,
    },
    ...(image.grid?.panels || []).map((panel, index) => ({
      src: imageSrc({ ...image, ...panel }),
      title: `${name} · panel ${index + 1}`,
    })),
  ];
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
  const [gridUpload, setGridUpload] = useState({ on: false, rows: 2, cols: 2 });
  const [dialogueLanguage, setDialogueLanguage] = useState("Gujarati");
  const [loraOpen, setLoraOpen] = useState(false);
  const [viewer, setViewer] = useState<{ slides: Slide[]; index: number } | null>(null);
  // Compare mode: the picked generations, in pick order (A, B, C, D), and whose audio the comparison keeps.
  const [compareMode, setCompareMode] = useState(false);
  const [comparePick, setComparePick] = useState<string[]>([]);
  const [compareAudio, setCompareAudio] = useState(0);
  const [videoSort, setVideoSort] = useState<"newest" | "rating">("newest");
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
      body: JSON.stringify({ gist: current.gist, model: current.aiModel }),
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
          model: storyRef.current?.aiModel ?? "",
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
          model: storyRef.current?.aiModel ?? "",
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image prompt generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function uploadImage(file: File) {
    if (!story) return;
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (PNG, JPG, WebP…).");
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const png = await toPng(file);
      const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
      const send = async (blob: Blob, suffix = "") => {
        const form = new FormData();
        form.append("storyId", story.id);
        form.append("image", blob, "upload.png");
        form.append("stamp", stamp);
        if (suffix) form.append("suffix", suffix);
        const response = await request("/api/image/upload", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed.");
        return data.image as { filename: string; subfolder: string; type: string };
      };
      const data = { image: await send(png.blob) };
      let grid: ReferenceImage["grid"];
      if (gridUpload.on) {
        const rows = Math.max(1, Math.min(4, gridUpload.rows));
        const cols = Math.max(1, Math.min(4, gridUpload.cols));
        if (rows * cols < 2) throw new Error("A storyboard grid needs at least 2 panels.");
        const cut = await cutPanels(png.canvas, rows, cols);
        const panels = [];
        for (const [index, panel] of cut.entries()) panels.push(await send(panel.blob, `_p${index + 1}`));
        grid = { rows, cols, panelAspectRatio: nearestAspectRatio(cut[0].width, cut[0].height), panels };
      }
      const current = storyRef.current || story;
      const image: ReferenceImage = {
        id: crypto.randomUUID(),
        filename: data.image.filename,
        subfolder: data.image.subfolder,
        type: data.image.type,
        prompt: "",
        seed: 0,
        aspectRatio: nearestAspectRatio(png.width, png.height),
        megapixels: Math.round((png.width * png.height) / 10_000) / 100,
        createdAt: new Date().toISOString(),
        source: "upload",
        originalName: file.name,
        ...(grid ? { grid } : {}),
      };
      const next: Story = {
        ...current,
        referenceImages: [image, ...current.referenceImages],
        selectedImageId: image.id,
      };
      skipSave.current = true;
      setStory(await persist(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
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

  // The owner's rating (1-5, 0 = none) and note on a finished video, saved with the story.
  function rateVideo(runId: string, patch: { rating?: number; note?: string; collapsed?: boolean }) {
    const current = storyRef.current;
    if (!current) return;
    patchStory({ videos: current.videos.map((item) => (item.id === runId ? { ...item, ...patch } : item)) });
  }

  // Removes a finished (or failed / cancelled) generation from the story. The files stay in ComfyUI's
  // output folder: ComfyUI has no delete call.
  function deleteVideo(run: VideoRun) {
    const current = storyRef.current;
    if (!current) return;
    const where = run.video ? `

The file stays in ComfyUI output: ${run.video.subfolder}\${run.video.filename}` : "";
    if (!window.confirm(`Delete this generation from the story?${where}`)) return;
    patchStory({ videos: current.videos.filter((item) => item.id !== run.id) });
  }

  async function createComparison() {
    const current = storyRef.current;
    if (!current || comparePick.length < 2) return;
    const runs = comparePick
      .map((id) => current.videos.find((run) => run.id === id))
      .filter((run): run is VideoRun => Boolean(run?.video));
    if (runs.length < 2) return;
    const id = crypto.randomUUID();
    const items = runs.map((run, index) => ({
      letter: "ABCD"[index],
      runId: run.id,
      lines: runLabelLines(run, current, "ABCD"[index]),
    }));
    setBusy("compare");
    setError("");
    try {
      const response = await request("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: current.id,
          id,
          tiles: runs.map((run, index) => ({ video: run.video, lines: items[index].lines })),
          audioFrom: Math.min(compareAudio, runs.length - 1),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not build the comparison.");
      const comparison: Comparison = {
        id,
        createdAt: new Date().toISOString(),
        items,
        audioFrom: Math.min(compareAudio, runs.length - 1),
        duration: data.duration,
        width: data.width,
        height: data.height,
        note: "",
      };
      const latest = storyRef.current || current;
      skipSave.current = true;
      setStory(await persist({ ...latest, comparisons: [comparison, ...(latest.comparisons || [])] }));
      setCompareMode(false);
      setComparePick([]);
      setCompareAudio(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the comparison.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteComparison(comparison: Comparison) {
    const current = storyRef.current;
    if (!current) return;
    if (!window.confirm("Delete this comparison and its video file?")) return;
    const response = await request(
      `/api/compare?${new URLSearchParams({ storyId: current.id, id: comparison.id })}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Could not delete the comparison.");
      return;
    }
    const latest = storyRef.current || current;
    patchStory({ comparisons: (latest.comparisons || []).filter((item) => item.id !== comparison.id) });
  }

  function noteComparison(id: string, note: string) {
    const current = storyRef.current;
    if (!current) return;
    patchStory({ comparisons: (current.comparisons || []).map((item) => (item.id === id ? { ...item, note } : item)) });
  }

  async function cancelVideo(run: VideoRun) {
    if (
      !window.confirm(
        run.status === "queued"
          ? "Remove this video from the ComfyUI queue?"
          : "Stop this video now? Segments already finished stay in its ComfyUI project folder; nothing else on the GPU is stopped.",
      )
    ) {
      return;
    }
    setError("");
    try {
      const response = await request("/api/video/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptId: run.promptId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not stop the video.");
      if (data.result === "not-found") {
        setError("ComfyUI no longer has this job (it may have just finished); its status updates on the next check.");
        return;
      }
      const latest = storyRef.current;
      if (!latest) return;
      const next: Story = {
        ...latest,
        videos: latest.videos.map((item) =>
          item.id === run.id
            ? {
                ...item,
                status: "cancelled",
                error: "",
                finishedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
      skipSave.current = true;
      setStory(await persist(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop the video.");
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
      // Test mode: only the first N segments; enhancement LoRAs from the LoRA popup.
      const limit = settings.onlyFirst > 0 ? Math.min(settings.onlyFirst, current.segments.length) : current.segments.length;
      const renderSegments = current.segments.slice(0, limit);
      const loras = (settings.loras || [])
        .filter((lora) => lora.enabled)
        .map((lora) => ({ name: lora.name, strength: lora.strength }));
      const response = await request("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyId: current.id,
          segments: renderSegments.map((segment) => {
            const frame = current.frames.find((item) => item.id === segment.id);
            return {
              duration: segment.duration,
              prompt: segment.prompt,
              join: segment.join ?? frame?.join,
              panel: segment.panel ?? frame?.panel,
            };
          }),
          image: { filename: image.filename, subfolder: image.subfolder, type: image.type },
          // Storyboard grid: the video takes the panel's aspect ratio, not the grid's.
          grid: image.grid ? { feed: current.gridFeed, panels: image.grid.panels } : undefined,
          loras,
          devMode: settings.devMode,
          seed: settings.seed,
          engine: settings.engine,
          aspectRatio: image.grid?.panelAspectRatio ?? image.aspectRatio,
          megapixels: settings.v2Megapixels,
          steps: settings.v2Steps,
          devMegapixels: settings.v2DevMegapixels,
          devSteps: settings.v2DevSteps,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not start the video.");
      const v2 = settings.engine === "story-v2";
      // Long take: the workflow's fixed DEV / FINAL resolution and steps.
      const longTake = settings.devMode ? { megapixels: 0.47, steps: 10 } : { megapixels: 0.8, steps: 16 };
      // Veda Turbo / Sage SLA: the canvas the server picked and the workflow's steps.
      const fast =
        data.size && typeof data.size.width === "number"
          ? {
              megapixels: Math.round((data.size.width * data.size.height) / 10_000) / 100,
              steps: Number(data.steps) || 0,
              width: data.size.width as number,
              height: data.size.height as number,
            }
          : null;
      const run: VideoRun = {
        id: crypto.randomUUID(),
        promptId: data.promptId,
        project: data.project,
        devMode: settings.devMode,
        seed: settings.seed,
        engine: settings.engine,
        ...(v2
          ? {
              megapixels: settings.devMode ? settings.v2DevMegapixels : settings.v2Megapixels,
              steps: settings.devMode ? settings.v2DevSteps : settings.v2Steps,
            }
          : fast || longTake),
        segmentCount: renderSegments.length,
        totalSegments: current.segments.length,
        ...(loras.length ? { loras } : {}),
        revisionId: current.activeRevisionId,
        promptStyle: activePromptStyle(current),
        durations: renderSegments.map((segment) => segment.duration),
        aspectRatio: image.grid?.panelAspectRatio ?? image.aspectRatio,
        imageId: image.id,
        ...(image.grid ? { gridFeed: current.gridFeed } : {}),
        imageFilename: image.filename,
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
        const finished = data.status === "done" || data.status === "error" || data.status === "cancelled";
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
      if (run?.status === "cancelled") TabStatus.idle();
      else TabStatus.finished(failed ? "failed" : "done", run ? "Video" : label);
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

  // Storyboard grid: one frame per panel, written by a model that looks at the picture.
  async function runGridFrames() {
    if (!story) return;
    const grid = selectedGrid(story);
    if (!grid?.grid) return;
    setBusy("breakdown");
    setError("");
    try {
      const response = await request("/api/grid/frames", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: storyRef.current?.aiModel ?? "",
          gist: effectiveGist(story),
          title: story.title,
          characters: story.characters,
          location: story.location,
          analysis: story.analysis,
          image: { filename: grid.filename, subfolder: grid.subfolder, type: grid.type },
          rows: grid.grid.rows,
          cols: grid.grid.cols,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Reading the grid failed.");
      const current = storyRef.current || story;
      // The grid decides how the characters look: take the looks the model read from the panels.
      const looks = new Map<string, string>(
        ((data.looks || []) as { id: string; look: string }[]).map((item) => [item.id, item.look]),
      );
      const next: Story = {
        ...current,
        characters: current.characters.map((character) =>
          looks.has(character.id) ? { ...character, look: looks.get(character.id) as string } : character,
        ),
        frames: data.frames || [],
        segments: [],
        step: "frames",
      };
      skipSave.current = true;
      setStory(await persist(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reading the grid failed.");
    } finally {
      setBusy(null);
    }
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
          model: storyRef.current?.aiModel ?? "",
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Breakdown failed.");
    } finally {
      setBusy(null);
    }
  }

  async function runPrompts() {
    if (!story) return;
    if (!story.selectedImageId && !window.confirm("No reference image is selected, so the prompts will be text-only (T2VA). The video workflows need a reference image and reference-image prompts. Generate and select an image on the Image tab first, or write text-only prompts anyway?")) return;
    setBusy("prompts");
    setError("");
    try {
      // The Frames step is optional: without frames, write one prompt per analysis beat
      // (short beats merged), and keep those frames on the story.
      let frames = story.frames;
      if (frames.length === 0) {
        frames = framesFromAnalysis(story.analysis);
        if (frames.length === 0) throw new Error("No frames and no analysis beats. Run the analysis on Cast or break into frames first.");
        if (storyRef.current) storyRef.current = { ...storyRef.current, frames };
      }
      const response = await request("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: storyRef.current?.aiModel ?? "",
          gist: effectiveGist(story),
          title: story.title,
          characters: story.characters,
          frames,
          reference: Boolean(story.selectedImageId),
          location: story.location,
          layout: story.imageLayout,
          analysis: story.analysis,
          promptStyle: story.promptStyle,
          tips: story.h3Tips,
          grid: gridForPrompts(story),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Prompt generation failed.");
      const segments = (data.segments || []) as PromptSegment[];
      await saveRevision(segments, true, story.selectedImageId ? story.promptStyle : undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prompt generation failed.");
    } finally {
      setBusy(null);
    }
  }

  // A copy of the current prompt set with only the spoken lines translated: same shots, camera and panels,
  // so a render with the same seed gives the same film in another language.
  async function runTranslate() {
    const current = storyRef.current || story;
    if (!current || current.segments.length === 0) return;
    const language = dialogueLanguage.trim();
    if (!language) return;
    setBusy("translate");
    setError("");
    try {
      const response = await request("/api/prompts/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: current.aiModel,
          language,
          segments: current.segments,
          context: effectiveGist(current),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Translation failed.");
      if (!data.lines) throw new Error("These prompts have no spoken lines to translate.");
      await saveRevision(data.segments as PromptSegment[], true, activePromptStyle(current), language);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function saveRevision(
    segments: PromptSegment[],
    activate = true,
    promptStyle?: PromptStyle,
    language?: string,
  ) {
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
      ...(promptStyle ? { promptStyle } : {}),
      ...(language ? { language } : {}),
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
            ...(segment.panel ?? frame?.panel ? { panel: segment.panel ?? frame?.panel } : {}),
            ...(segment.join ?? frame?.join ? { join: segment.join ?? frame?.join } : {}),
          };
        })
        .filter((target) => ids.includes(target.id));
      const response = await request("/api/prompts/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: storyRef.current?.aiModel ?? "",
          gist: effectiveGist(story),
          title: story.title,
          comment,
          characters: story.characters,
          frames: story.frames,
          targets,
          reference: Boolean(story.selectedImageId),
          analysis: story.analysis,
          promptStyle: activePromptStyle(story),
          tips: story.h3Tips,
          grid: gridForPrompts(story),
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
      await saveRevision(segments, true, current.selectedImageId ? activePromptStyle(current) : undefined);
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
    <div className="min-h-[calc(100vh-var(--nav-h))] md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-line bg-card md:border-b-0 md:border-r">
        <div className="sticky top-[var(--nav-h)] space-y-4 p-4">
          <Link href="/" className="text-xs uppercase tracking-[0.18em] text-accent">
            All stories
          </Link>
          <ModelPicker value={story.aiModel} onChange={(aiModel) => patchStory({ aiModel })} />
          <div>
            <p className="text-xs text-muted">Open another</p>
            <ul className="mt-2 space-y-1">
              {stories
                .filter((item) => !item.archived || item.id === storyId)
                .map((item) => (
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

      <main className="px-5 pb-8 sm:px-8">
        {/* Title row and step tabs stay pinned under the fixed top bar. */}
        <div className="sticky top-[var(--nav-h)] z-30 -mx-5 mb-6 border-b border-line bg-background px-5 pt-4 shadow-[0_6px_14px_rgba(0,0,0,0.35)] sm:-mx-8 sm:px-8">
          <header className="mb-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-muted">
                {story.id} · {saveState}
              </p>
              <input
                value={story.title}
                onChange={(event) => patchStory({ title: event.target.value })}
                className="mt-1 w-full max-w-xl truncate bg-transparent text-2xl font-semibold tracking-tight outline-none"
              />
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

          <nav className="flex flex-wrap gap-2 pb-3">
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
        </div>

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
                onClick={() => goTo("cast")}
                className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
              >
                Progress: cast & location
              </button>
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
                  onClick={runAnalyzeAndCast}
                  disabled={busy !== null || !story.gist.trim()}
                  className="rounded-full border border-line px-4 py-2 text-sm"
                >
                  {busy === "analyze"
                    ? "Analysing the story…"
                    : busy === "cast"
                      ? "Extracting cast and location…"
                      : story.characters.length > 0
                        ? "Analyse & extract again"
                        : "Analyse & extract cast"}
                </button>
                <button
                  type="button"
                  onClick={() => goTo("image")}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  Progress: reference image
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
              <p className="text-sm text-muted">No cast yet. Run Analyse & extract cast above.</p>
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
                  Generate one with Z-Image Turbo in ComfyUI or upload your own. The selected image becomes the H3 reference.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={runImagePrompt}
                  disabled={busy !== null || story.characters.length === 0}
                  className="rounded-full border border-line px-4 py-2 text-sm"
                >
                  {busy === "imagePrompt"
                    ? "Writing image prompt…"
                    : story.imagePrompt.trim()
                      ? "Rewrite image prompt"
                      : "Write image prompt"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      story.selectedImageId ||
                      window.confirm(
                        "No reference image is selected. The video workflows need one, and prompts written without it are text-only. Continue to Frames anyway?",
                      )
                    ) {
                      goTo("frames");
                    }
                  }}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  Progress: frames
                </button>
              </div>
            </div>
            {!story.selectedImageId && (
              <p className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs text-amber-300">
                {story.referenceImages.length > 0
                  ? "No reference image is selected. Select one below: the H3 prompts and the video use it."
                  : story.imagePrompt.trim()
                    ? "No reference image yet. Generate one below and select it: the H3 prompts and the video use it."
                    : "No reference image yet. Write the image prompt, then generate and select an image: the H3 prompts and the video use it."}
              </p>
            )}

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
                <label className="block text-xs uppercase tracking-wider text-muted">
                  Layout (who stands where in the picture; the H3 prompts use it)
                  <textarea
                    value={story.imageLayout}
                    onChange={(event) => patchStory({ imageLayout: event.target.value })}
                    rows={3}
                    placeholder="e.g. S1 left third facing right, S2 right third facing left, camera at eye level"
                    className="mt-2 w-full resize-y rounded-xl border border-line bg-background px-3 py-2 text-xs normal-case leading-5 tracking-normal text-foreground outline-none focus:border-accent"
                  />
                </label>
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

              <div
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                }}
                onDrop={(event) => {
                  const file = event.dataTransfer.files[0];
                  if (!file) return;
                  event.preventDefault();
                  if (busy === null) void uploadImage(file);
                }}
              >
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <label
                    className={`inline-flex cursor-pointer items-center rounded-full border border-line px-4 py-1.5 text-sm ${
                      busy !== null ? "pointer-events-none opacity-50" : ""
                    }`}
                  >
                    {busy === "upload" ? "Uploading…" : "Upload image"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={busy !== null}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void uploadImage(file);
                      }}
                    />
                  </label>
                  <p className="text-xs text-muted">
                    or drop a picture here. Best: everyone visible, calm, in the video&apos;s aspect ratio.
                  </p>
                </div>
                <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted">
                  <label
                    className="flex items-center gap-2"
                    title="The picture is a grid of scenes (a storyboard). Each panel becomes a shot; the panels are also cut out."
                  >
                    <input
                      type="checkbox"
                      checked={gridUpload.on}
                      disabled={busy !== null}
                      onChange={(event) => setGridUpload((grid) => ({ ...grid, on: event.target.checked }))}
                    />
                    Storyboard grid of scenes
                  </label>
                  {gridUpload.on && (
                    <>
                      <label className="flex items-center gap-1">
                        rows
                        <input
                          type="number"
                          min={1}
                          max={4}
                          value={gridUpload.rows}
                          onChange={(event) => setGridUpload((grid) => ({ ...grid, rows: Number(event.target.value) || 1 }))}
                          className="w-12 rounded-md border border-line bg-background px-1 py-0.5 text-foreground"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        columns
                        <input
                          type="number"
                          min={1}
                          max={4}
                          value={gridUpload.cols}
                          onChange={(event) => setGridUpload((grid) => ({ ...grid, cols: Number(event.target.value) || 1 }))}
                          className="w-12 rounded-md border border-line bg-background px-1 py-0.5 text-foreground"
                        />
                      </label>
                      <span>
                        Panels read left to right, top to bottom. Use clean panels without captions or numbers, the same
                        characters in each, and the video&apos;s aspect ratio per panel.
                      </span>
                    </>
                  )}
                </div>
                {story.referenceImages.length === 0 ? (
                  <p className="text-sm text-muted">No images yet. Generate one from the prompt or upload your own.</p>
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
                          title="View full screen"
                          onClick={() => {
                            const slides = story.referenceImages.flatMap((image) => imageSlides(image));
                            const index = slides.findIndex((slide) => slide.src === imageSrc(selected));
                            setViewer({ slides, index: Math.max(0, index) });
                          }}
                          className="w-full cursor-zoom-in rounded-2xl border border-line"
                        />
                      );
                    })()}
                    <div className="flex flex-wrap gap-2">
                      {story.referenceImages.map((image) => (
                        <button
                          key={image.id}
                          type="button"
                          title={image.source === "upload" ? `Uploaded: ${image.originalName || image.filename}` : `Seed ${image.seed}`}
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
                        return `${selected.subfolder}/${selected.filename}${
                          selected.source === "upload"
                            ? ` (uploaded${selected.originalName ? ` from ${selected.originalName}` : ""}, ${selected.aspectRatio}). Check that the Layout on the left matches this picture.`
                            : ""
                        }`;
                      })()}
                    </p>
                    {(() => {
                      const grid = selectedGrid(story)?.grid;
                      if (!grid) return null;
                      return (
                        <div className="space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-3 text-xs text-muted">
                          <p className="text-foreground">
                            Storyboard grid {grid.rows}×{grid.cols} · {grid.rows * grid.cols} panels · panels{" "}
                            {grid.panelAspectRatio.split(" ")[0]}, so the video is {grid.panelAspectRatio.split(" ")[0]}.
                            Make the frames with Frames from grid on the Frames tab.
                          </p>
                          <p>Give H3 on each segment:</p>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="grid-feed"
                              checked={story.gridFeed === "whole"}
                              onChange={() => patchStory({ gridFeed: "whole" })}
                            />
                            the whole grid, naming the segment&apos;s panel (default; tested)
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="grid-feed"
                              checked={story.gridFeed === "panels"}
                              onChange={() => patchStory({ gridFeed: "panels" })}
                            />
                            only the segment&apos;s own panel (faster; tested)
                          </label>
                          <p>Write the H3 prompts after changing this: the prompts name the picture differently.</p>
                        </div>
                      );
                    })()}
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
                <PromptStyleSelect
                  value={story.promptStyle}
                  reference={Boolean(story.selectedImageId)}
                  disabled={busy !== null}
                  onChange={(promptStyle) => patchStory({ promptStyle })}
                />
                <H3TipsCheckbox checked={story.h3Tips} disabled={busy !== null} onChange={(h3Tips) => patchStory({ h3Tips })} />
                <IconButton label="Add frame" onClick={addFrame}>
                  {Icons.plus}
                </IconButton>
                {selectedGrid(story) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        story.frames.length === 0 ||
                        window.confirm(
                          "Replace the current frames with one frame per grid panel? This clears the prompts and updates the character looks to match the grid.",
                        )
                      ) {
                        void runGridFrames();
                      }
                    }}
                    disabled={busy !== null}
                    title="One frame per storyboard panel; the AI looks at the grid (needs an image-capable model such as google/gemini-3.7-flash)"
                    className="rounded-full border border-accent px-4 py-2 text-sm text-accent"
                  >
                    {busy === "breakdown" ? "Reading the grid…" : "Frames from grid"}
                  </button>
                )}
                {story.analysis?.beats?.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        story.frames.length === 0 ||
                        window.confirm("Replace the current frames with the analysis beats? This clears the prompts.")
                      ) {
                        patchStory({ frames: framesFromAnalysis(story.analysis), segments: [] });
                      }
                    }}
                    disabled={busy !== null}
                    title="One frame per analysis beat, short beats merged, no AI call"
                    className="rounded-full border border-line px-4 py-2 text-sm"
                  >
                    Use analysis beats
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (
                      story.frames.length === 0 ||
                      window.confirm("Break the story into frames again? This replaces the current frames and clears the prompts.")
                    ) {
                      void runBreakdown();
                    }
                  }}
                  disabled={busy !== null || !story.gist.trim()}
                  className="rounded-full border border-line px-4 py-2 text-sm"
                >
                  {busy === "breakdown"
                    ? "Breaking into frames…"
                    : story.frames.length > 0
                      ? "Break into frames again"
                      : "Break into frames"}
                </button>
                <button
                  type="button"
                  onClick={() => goTo("prompts")}
                  className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
                >
                  Progress: H3 prompts
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
                No frames yet. Run Break into frames (AI) or Use analysis beats above, or skip this step: Write H3 prompts on Prompts uses the analysis beats.
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
                      {(() => {
                        const grid = selectedGrid(story)?.grid;
                        if (!grid) return null;
                        const count = grid.rows * grid.cols;
                        return (
                          <>
                            <label className="flex items-center gap-2 text-xs text-muted">
                              Panel
                              <select
                                value={frame.panel ?? ""}
                                onChange={(event) =>
                                  updateFrame(frame.id, { panel: event.target.value ? Number(event.target.value) : undefined })
                                }
                                title={frame.panel ? panelPosition(frame.panel, grid.rows, grid.cols) : "No panel"}
                                className="rounded-md border border-line bg-background px-2 py-1 text-foreground"
                              >
                                <option value="">none</option>
                                {Array.from({ length: count }, (_, i) => (
                                  <option key={i + 1} value={i + 1}>
                                    {i + 1} · {panelPosition(i + 1, grid.rows, grid.cols).replace(" panel", "")}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {index > 0 && (
                              <label className="flex items-center gap-2 text-xs text-muted">
                                Join
                                <select
                                  value={frame.join || "continuous"}
                                  onChange={(event) =>
                                    updateFrame(frame.id, { join: event.target.value === "cut" ? "cut" : "continuous" })
                                  }
                                  title="Cut: a new shot that opens on its panel. Continue: carries on the previous shot."
                                  className="rounded-md border border-line bg-background px-2 py-1 text-foreground"
                                >
                                  <option value="cut">Cut</option>
                                  <option value="continuous">Continue</option>
                                </select>
                              </label>
                            )}
                          </>
                        );
                      })()}
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
                      title={`Prompt set ${index + 1}${revision.language ? ` · dialogue in ${revision.language}` : ""}`}
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
              <div className="flex flex-wrap items-center gap-2">
                <PromptStyleSelect
                  value={story.promptStyle}
                  reference={Boolean(story.selectedImageId)}
                  disabled={busy !== null}
                  onChange={(promptStyle) => patchStory({ promptStyle })}
                />
                <H3TipsCheckbox checked={story.h3Tips} disabled={busy !== null} onChange={(h3Tips) => patchStory({ h3Tips })} />
                <span className="flex items-center gap-1">
                  <input
                    value={dialogueLanguage}
                    onChange={(event) => setDialogueLanguage(event.target.value)}
                    list="dialogue-languages"
                    aria-label="Dialogue language"
                    className="w-28 rounded-full border border-line bg-background px-3 py-2 text-sm"
                  />
                  <datalist id="dialogue-languages">
                    {["Gujarati", "Hindi", "English", "Marathi", "Tamil", "Telugu", "Bengali", "Punjabi", "Spanish", "French"].map(
                      (language) => (
                        <option key={language} value={language} />
                      ),
                    )}
                  </datalist>
                  <button
                    type="button"
                    onClick={() => void runTranslate()}
                    disabled={busy !== null || story.segments.length === 0 || !dialogueLanguage.trim()}
                    title="New prompt set with only the spoken lines translated; shots, camera and panels stay the same. Render with the same seed to compare."
                    className="rounded-full border border-line px-4 py-2 text-sm"
                  >
                    {busy === "translate" ? "Translating…" : "Language version"}
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => setUpdateOpen(true)}
                  disabled={busy !== null || story.segments.length === 0}
                  className="rounded-full border border-line px-4 py-2 text-sm"
                >
                  Update with comment
                </button>
                {story.segments.length === 0 ? (
                  <button
                    type="button"
                    onClick={runPrompts}
                    disabled={busy !== null || (story.frames.length === 0 && !story.analysis?.beats?.length)}
                    title={
                      story.frames.length === 0
                        ? "No frames yet: one prompt per analysis beat (short beats merged)."
                        : undefined
                    }
                    className="rounded-full border border-line px-4 py-2 text-sm"
                  >
                    {busy === "prompts"
                      ? "Writing H3 prompts…"
                      : story.frames.length === 0
                        ? "Write H3 prompts from beats"
                        : "Write H3 prompts"}
                  </button>
                ) : (
                  <IconButton
                    label={busy === "prompts" ? "Writing H3 prompts" : "Regenerate prompts"}
                    onClick={runPrompts}
                    disabled={busy !== null || story.frames.length === 0}
                  >
                    {Icons.refresh}
                  </IconButton>
                )}
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
            {!story.selectedImageId ? (
              <p className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs text-amber-300">
                No reference image is selected, so prompts are written as text-only T2VA, which the video workflows cannot
                render. Generate and select an image on the Image tab, then write the prompts.
              </p>
            ) : (
              story.segments.length > 0 &&
              !story.segments.every((segment) => segment.prompt.trimStart().startsWith("subject_definitions")) && (
                <p className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-2 text-xs text-amber-300">
                  These prompts were written without a reference image (text-only). Regenerate them to get reference-image
                  prompts for the video.
                </p>
              )
            )}
            {story.selectedImageId &&
              story.segments.length > 0 &&
              activePromptStyle(story) !== story.promptStyle && (
                <p className="mb-4 text-xs text-amber-300">
                  This prompt set is written in the {activePromptStyle(story) === "story-v2" ? "Story V2" : "long-take"} style.
                  Regenerate to write it in the {story.promptStyle === "story-v2" ? "Story V2" : "long-take"} style.
                </p>
              )}
            {story.segments.length === 0 ? (
              <p className="text-sm text-muted">
                No prompts yet. Run Write H3 prompts above. Frames are optional: without them, each analysis beat becomes one segment.
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
              const settings = story.videoSettings;
              const v2 = settings.engine === "story-v2";
              const fastEngine = isFastEngine(settings.engine) ? settings.engine : null;
              const videoAspect = image?.grid?.panelAspectRatio ?? image?.aspectRatio ?? "16:9";
              const fastCanvas = fastStorySize(videoAspect, settings.devMode).size;
              const gridLongTake = Boolean(image?.grid) && settings.engine === "long-take";
              // Fast workflows: learn the time from this story's finished runs (same workflow and mode).
              const fastRuns = story.videos.filter(
                (run) =>
                  run.status === "done" &&
                  run.engine === settings.engine &&
                  run.devMode === settings.devMode &&
                  run.finishedAt &&
                  (run.durations?.length || 0) > 0,
              );
              const fastSecondsPerOutput = fastRuns.length
                ? fastRuns.reduce(
                    (sum, run) =>
                      sum +
                      (Date.parse(run.finishedAt) - Date.parse(run.createdAt)) /
                        1000 /
                        (run.durations || []).reduce((a, b) => a + b, 0),
                    0,
                  ) / fastRuns.length
                : 0;
              const v2Mp = settings.devMode ? settings.v2DevMegapixels : settings.v2Megapixels;
              const v2Steps = settings.devMode ? settings.v2DevSteps : settings.v2Steps;
              const longSegments = story.segments.filter((segment) => segment.duration > STORY_V2_MAX_SEGMENT_SECONDS);
              const timestamped = story.segments
                .filter((segment) => promptTimestamps(segment.prompt).length > 0)
                .map((segment) => segment.id);
              // Measured in the Pipeline: ~44 s of compute per output second at 0.3 MP / 10 steps; scaled by MP x steps.
              const v2Minutes = Math.max(1, Math.round((totalVideoSeconds * 44 * (v2Mp / 0.3) * (v2Steps / 10)) / 60));
              return (
                <>
                  <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-medium uppercase tracking-wider text-muted">Video</h2>
                      <p className="mt-1 text-xs text-muted">
                        Runs the H3 {engineInfo(settings.engine).short} workflow in ComfyUI with the current prompt set ({story.segments.length}{" "}
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
                        <label className="flex flex-col gap-1">
                          Workflow
                          <select
                            value={settings.engine}
                            onChange={(event) => updateVideoSettings({ engine: event.target.value as typeof settings.engine })}
                            className="rounded-md border border-line bg-background px-2 py-1 text-sm text-foreground"
                          >
                            {VIDEO_ENGINES.map((engine) => (
                              <option key={engine.id} value={engine.id}>
                                {engine.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {gridLongTake && (
                        <p className="text-xs text-amber-300">
                          The reference is a storyboard grid: pick Veda Turbo, Singularity Veda, Sage SLA or Story V2. The long take cannot cut
                          between panels.
                        </p>
                      )}
                      {v2 && timestamped.length > 0 && (
                        <p className="text-xs text-amber-300">
                          These prompts use long-take timestamps ({timestamped.join(", ")}). Story V2 is proven only with
                          timestamp-free prompts: switch the prompt style to Story V2 on the Prompts step and regenerate.
                        </p>
                      )}
                      {settings.engine === "long-take" && refPrompts && story.segments.length > 0 && timestamped.length === 0 && (
                        <p className="text-xs text-amber-300">
                          These prompts are written in the Story V2 style (no timestamps); the long take expects timestamped
                          continuation segments.
                        </p>
                      )}
                      {v2 && longSegments.length > 0 && (
                        <p className="text-xs text-amber-300">
                          Story V2 is proven with segments of {STORY_V2_MAX_SEGMENT_SECONDS}s or less;{" "}
                          {longSegments.map((segment) => `${segment.id} (${segment.duration}s)`).join(", ")} may drift.
                        </p>
                      )}

                      <div className="flex flex-wrap items-end gap-4 text-xs text-muted">
                        <label className="flex items-center gap-2 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={story.videoSettings.devMode}
                            onChange={(event) => updateVideoSettings({ devMode: event.target.checked })}
                          />
                          DEV MODE
                          <span className="text-xs text-muted">
                            {fastEngine
                              ? `${settings.devMode ? "draft" : "full"} · ${fastCanvas.width}×${fastCanvas.height} · ${FAST_ENGINE_STEPS[fastEngine]} steps · single pass`
                              : v2
                              ? `${settings.devMode ? "draft" : "full"} · ${v2Mp} MP · ${v2Steps} steps · x1.25 refine`
                              : settings.devMode
                                ? "fast draft · 0.47 MP · 10 steps"
                                : "final · 0.8 MP · 16 steps · RTX VSR"}
                          </span>
                        </label>
                        {v2 && (
                          <>
                            <label className="flex flex-col gap-1">
                              {settings.devMode ? "DEV" : "FULL"} megapixels
                              <input
                                type="number"
                                min={0.1}
                                max={2}
                                step={0.1}
                                value={v2Mp}
                                onChange={(event) => {
                                  const next = Math.round(Number(event.target.value) * 10) / 10;
                                  if (!Number.isFinite(next) || next <= 0) return;
                                  updateVideoSettings(settings.devMode ? { v2DevMegapixels: next } : { v2Megapixels: next });
                                }}
                                className="w-20 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                              />
                            </label>
                            <label className="flex flex-col gap-1">
                              {settings.devMode ? "DEV" : "FULL"} steps
                              <input
                                type="number"
                                min={4}
                                max={60}
                                value={v2Steps}
                                onChange={(event) => {
                                  const next = Math.round(Number(event.target.value));
                                  if (!Number.isFinite(next) || next < 1) return;
                                  updateVideoSettings(settings.devMode ? { v2DevSteps: next } : { v2Steps: next });
                                }}
                                className="w-16 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                              />
                            </label>
                          </>
                        )}
                        <label className="flex flex-col gap-1">
                          LoRAs
                          <button
                            type="button"
                            onClick={() => setLoraOpen(true)}
                            title={
                              settings.loras.filter((lora) => lora.enabled).map((lora) => `${lora.name} @ ${lora.strength}`).join("\n") ||
                              "No enhancement LoRAs"
                            }
                            className="rounded-md border border-line bg-background px-2 py-1 text-sm text-foreground"
                          >
                            {settings.loras.filter((lora) => lora.enabled).length
                              ? `${settings.loras.filter((lora) => lora.enabled).length} on`
                              : "none"}{" "}
                            · edit
                          </button>
                        </label>
                        <label
                          className="flex flex-col gap-1"
                          title="Test mode: render only the first N segments of the prompt set (0 or off = all)."
                        >
                          <span className="flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={settings.onlyFirst > 0}
                              onChange={(event) =>
                                updateVideoSettings({ onlyFirst: event.target.checked ? Math.min(2, story.segments.length || 2) : 0 })
                              }
                            />
                            Skip segments after
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={Math.max(1, story.segments.length)}
                            disabled={settings.onlyFirst === 0}
                            value={settings.onlyFirst || ""}
                            placeholder="all"
                            onChange={(event) => {
                              const next = Math.round(Number(event.target.value));
                              if (Number.isFinite(next) && next >= 1) updateVideoSettings({ onlyFirst: next });
                            }}
                            className="w-20 rounded-md border border-line bg-background px-2 py-1 text-foreground disabled:opacity-50"
                          />
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
                          disabled={busy !== null || running || !image || story.segments.length === 0 || gridLongTake}
                          className="rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
                        >
                          {busy === "video" ? "Sending to ComfyUI…" : running ? "Video in progress…" : "Generate video"}
                        </button>
                        <p className="text-xs text-muted">
                          {fastEngine
                            ? fastSecondsPerOutput > 0
                              ? `About ${Math.max(1, Math.round((totalVideoSeconds * fastSecondsPerOutput) / 60))} min, from ${fastRuns.length} earlier run${fastRuns.length > 1 ? "s" : ""} of this workflow in this story.`
                              : "No timing measured yet for this workflow here; the first run sets the estimate."
                            : v2
                            ? `About ${v2Minutes} min at these settings. A different MP or step count gives a different take.`
                            : story.videoSettings.devMode
                              ? "A draft takes about 11–14 min."
                              : "A final takes about 29 min."}
                        </p>
                      </div>
                    </div>

                    <div>
                      {story.videos.filter((run) => run.video).length > 1 && (
                        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <button
                            type="button"
                            onClick={() => {
                              setCompareMode((on) => !on);
                              setComparePick([]);
                              setCompareAudio(0);
                            }}
                            className={`rounded-full px-3 py-1 ${compareMode ? "bg-accent text-accent-ink" : "border border-line"}`}
                          >
                            {compareMode ? "Cancel compare" : "Compare"}
                          </button>
                          {compareMode && (
                            <>
                              <span>
                                {comparePick.length} of 2–4 picked
                                {comparePick.length ? ` (${comparePick.map((_, index) => "ABCD"[index]).join(", ")})` : ""}
                              </span>
                              {comparePick.length > 1 && (
                                <label className="flex items-center gap-1">
                                  audio from
                                  <select
                                    value={Math.min(compareAudio, comparePick.length - 1)}
                                    onChange={(event) => setCompareAudio(Number(event.target.value))}
                                    className="rounded-md border border-line bg-background px-1 py-0.5 text-foreground"
                                  >
                                    {comparePick.map((_, index) => (
                                      <option key={index} value={index}>
                                        {"ABCD"[index]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              <button
                                type="button"
                                onClick={() => void createComparison()}
                                disabled={comparePick.length < 2 || busy !== null}
                                className="rounded-full bg-foreground px-3 py-1 font-medium text-background"
                              >
                                {busy === "compare" ? "Stitching…" : "Create comparison"}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {story.videos.length > 1 && (
                        <div className="mb-3 flex items-center justify-end gap-2 text-xs text-muted">
                          Sort
                          {(["newest", "rating"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setVideoSort(mode)}
                              className={`rounded-full px-3 py-1 ${
                                videoSort === mode ? "bg-foreground text-background" : "border border-line"
                              }`}
                            >
                              {mode === "newest" ? "Newest" : "Best rated"}
                            </button>
                          ))}
                        </div>
                      )}
                      {story.videos.length === 0 ? (
                        <p className="text-sm text-muted">No videos yet.</p>
                      ) : (
                        <ol className="space-y-4">
                          {(videoSort === "rating"
                            ? [...story.videos].sort(
                                (a, b) => (b.rating || 0) - (a.rating || 0) || b.createdAt.localeCompare(a.createdAt),
                              )
                            : story.videos
                          ).map((run) => {
                            const started = Date.parse(run.createdAt);
                            const ended = run.finishedAt ? Date.parse(run.finishedAt) : clock || started;
                            const active = run.status === "queued" || run.status === "running";
                            const v2Run = run.engine === "story-v2";
                            const fastRun = isFastEngine(run.engine);
                            // Rated videos start collapsed; a manual expand/collapse sticks.
                            const collapsed = run.collapsed ?? (Boolean(run.rating) && !active);
                            const revisionIndex = revisions.findIndex((revision) => revision.id === run.revisionId);
                            const revision = revisions[revisionIndex];
                            const durations = run.durations || revision?.segments.map((segment) => segment.duration) || [];
                            const style =
                              run.promptStyle ||
                              revision?.promptStyle ||
                              (revision
                                ? revision.segments.some((segment) => promptTimestamps(segment.prompt).length > 0)
                                  ? "long-take"
                                  : "story-v2"
                                : undefined);
                            const runImage = story.referenceImages.find((item) => item.id === run.imageId);
                            const megapixels = run.megapixels ?? (v2Run || fastRun ? undefined : run.devMode ? 0.47 : 0.8);
                            const steps = run.steps ?? (v2Run || fastRun ? undefined : run.devMode ? 10 : 16);
                            const details: [string, ReactNode][] = [
                              [
                                "Workflow",
                                engineInfo(run.engine).detail,
                              ],
                              [
                                "Quality",
                                [
                                  v2Run || fastRun ? (run.devMode ? "DEV" : "FULL") : run.devMode ? "Draft (DEV)" : "Final",
                                  run.width && run.height ? `${run.width}×${run.height}` : "",
                                  megapixels !== undefined ? `${megapixels} MP` : "",
                                  steps !== undefined ? `${steps} steps` : "",
                                  run.aspectRatio || "",
                                ]
                                  .filter(Boolean)
                                  .join(" · "),
                              ],
                              [
                                "Prompts",
                                [
                                  revisionIndex >= 0
                                    ? `set ${revisionIndex + 1}${run.revisionId === activeRevisionId ? " (current)" : ""}`
                                    : "set no longer exists",
                                  style ? (style === "story-v2" ? "Story V2 style" : "long-take style") : "",
                                  durations.length
                                    ? `${durations.length} segments (${durations.join(" + ")} = ${durations.reduce((sum, value) => sum + value, 0)} s)`
                                    : `${run.segmentCount} segments`,
                                  run.totalSegments && run.totalSegments > run.segmentCount
                                    ? `test: first ${run.segmentCount} of ${run.totalSegments}`
                                    : "",
                                ]
                                  .filter(Boolean)
                                  .join(" · "),
                              ],
                              [
                                "Reference",
                                runImage ? (
                                  <span className="inline-flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setViewer({ slides: imageSlides(runImage), index: 0 })}
                                      title="View full screen"
                                      className="cursor-zoom-in"
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img src={imageSrc(runImage)} alt="" className="h-8 w-auto rounded border border-line" />
                                    </button>
                                    {runImage.filename}
                                    {runImage.id === story.selectedImageId ? " (selected)" : ""}
                                    {runImage.grid
                                      ? ` · storyboard ${runImage.grid.rows}×${runImage.grid.cols}, ${
                                          run.gridFeed === "panels" ? "one panel per segment" : "whole grid per segment"
                                        }`
                                      : ""}
                                  </span>
                                ) : (
                                  run.imageFilename || "not recorded"
                                ),
                              ],
                              ["Seed", String(run.seed)],
                              [
                                "ComfyUI",
                                <span key="comfy" className="break-all font-mono">
                                  {run.project} · {run.promptId.slice(0, 8)}
                                </span>,
                              ],
                              [
                                "LoRAs",
                                run.loras?.length
                                  ? run.loras
                                      .map((lora) => `${lora.name.replace(/^minimax-h3[\\/]/i, "").replace(/\.safetensors$/i, "")} @ ${lora.strength}`)
                                      .join(" · ")
                                  : "none",
                              ],
                              [
                                "Started",
                                `${new Date(run.createdAt).toLocaleString()}${
                                  run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleTimeString()}` : ""
                                }`,
                              ],
                            ];
                            return (
                              <li key={run.id} className={`rounded-2xl border border-line bg-card ${collapsed ? "px-4 py-3" : "p-4"}`}>
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                                  {compareMode && run.video && !active && (
                                    <label className="flex items-center gap-1.5 rounded-full border border-accent/50 px-2 py-0.5 text-accent">
                                      <input
                                        type="checkbox"
                                        checked={comparePick.includes(run.id)}
                                        disabled={!comparePick.includes(run.id) && comparePick.length >= 4}
                                        onChange={(event) =>
                                          setComparePick((picked) =>
                                            event.target.checked ? [...picked, run.id] : picked.filter((id) => id !== run.id),
                                          )
                                        }
                                      />
                                      {comparePick.includes(run.id) ? "ABCD"[comparePick.indexOf(run.id)] : "pick"}
                                    </label>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => rateVideo(run.id, { collapsed: !collapsed })}
                                    aria-expanded={!collapsed}
                                    title={collapsed ? "Expand" : "Collapse"}
                                    className="flex items-center gap-1.5 font-medium text-foreground"
                                  >
                                    <span className="inline-block w-3 text-muted">{collapsed ? "▸" : "▾"}</span>
                                    {engineInfo(run.engine).short} · {run.devMode ? "DEV" : v2Run || fastRun ? "FULL" : "Final"}
                                  </button>
                                  <span
                                    className={
                                      run.status === "done"
                                        ? "text-emerald-300"
                                        : run.status === "error"
                                          ? "text-red-300"
                                          : run.status === "cancelled"
                                            ? "text-muted"
                                            : "text-amber-300"
                                    }
                                  >
                                    {run.status === "queued" &&
                                      `Queued${queuePositions[run.id] ? ` · position ${queuePositions[run.id]}` : ""}`}
                                    {run.status === "running" &&
                                      `Running · ${run.segmentsDone}/${run.segmentCount} segments done`}
                                    {run.status === "done" && "Done"}
                                    {run.status === "error" && "Failed"}
                                    {run.status === "cancelled" && "Cancelled"}
                                    {" · "}
                                    {formatDuration(ended - started)}
                                    {active && (
                                      <button
                                        type="button"
                                        onClick={() => void cancelVideo(run)}
                                        className="ml-2 rounded-full border border-red-400/50 px-2.5 py-0.5 text-red-300 hover:bg-red-400/10"
                                      >
                                        {run.status === "queued" ? "Remove" : "Stop"}
                                      </button>
                                    )}
                                    {!active && (
                                      <IconButton
                                        label="Delete generation"
                                        onClick={() => deleteVideo(run)}
                                        className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-red-300"
                                      >
                                        {Icons.trash}
                                      </IconButton>
                                    )}
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
                                {collapsed ? (
                                  <p className="truncate text-xs text-muted">
                                    {[
                                      revisionIndex >= 0 ? `set ${revisionIndex + 1}` : "",
                                      durations.length ? `${durations.length} seg · ${durations.reduce((a, b) => a + b, 0)} s` : "",
                                      run.loras?.length ? `${run.loras.length} LoRA${run.loras.length > 1 ? "s" : ""}` : "",
                                      `seed ${run.seed}`,
                                      new Date(run.createdAt).toLocaleString(),
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                ) : (
                                <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                                  {details.map(([label, value]) => (
                                    <Fragment key={label}>
                                      <dt className="text-muted">{label}</dt>
                                      <dd className="min-w-0 text-foreground/90">{value}</dd>
                                    </Fragment>
                                  ))}
                                </dl>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                                  <span>Rating</span>
                                  {[1, 2, 3, 4, 5].map((stars) => (
                                    <button
                                      key={stars}
                                      type="button"
                                      aria-label={`${stars} star${stars > 1 ? "s" : ""}`}
                                      onClick={() =>
                                        rateVideo(run.id, { rating: run.rating === stars ? 0 : stars, collapsed: undefined })
                                      }
                                      className={`text-base leading-none ${
                                        (run.rating || 0) >= stars ? "text-accent" : "text-muted/50 hover:text-muted"
                                      }`}
                                    >
                                      ★
                                    </button>
                                  ))}
                                  <input
                                    defaultValue={run.note || ""}
                                    onBlur={(event) => {
                                      if (event.target.value !== (run.note || "")) rateVideo(run.id, { note: event.target.value });
                                    }}
                                    placeholder="note (what worked, what didn't)"
                                    className="min-w-40 flex-1 rounded-md border border-line bg-background px-2 py-1 text-foreground"
                                  />
                                </div>
                                {!collapsed && run.error && <p className="mt-2 text-xs text-red-200">{run.error}</p>}
                                {!collapsed && run.video && (
                                  <>
                                    <video
                                      src={imageSrc({ ...run.video, id: run.id } as ReferenceImage)}
                                      controls
                                      className="mt-2 w-full rounded-xl border border-line"
                                    />
                                    <p className="mt-2 break-all text-xs text-muted">
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
                  {(story.comparisons || []).length > 0 && (
                    <div className="mb-6">
                      <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted">Comparisons</h2>
                      <ol className="space-y-4">
                        {(story.comparisons || []).map((comparison) => (
                          <li key={comparison.id} className="rounded-2xl border border-line bg-card p-4">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                              <span className="font-medium text-foreground">
                                {comparison.items.map((item) => item.letter).join(" vs ")}
                              </span>
                              <span>
                                {new Date(comparison.createdAt).toLocaleString()} · {Math.round(comparison.duration)} s · audio from{" "}
                                {comparison.items[comparison.audioFrom]?.letter || "A"}
                                <IconButton
                                  label="Delete comparison"
                                  onClick={() => void deleteComparison(comparison)}
                                  className="ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-red-300"
                                >
                                  {Icons.trash}
                                </IconButton>
                              </span>
                            </div>
                            <video
                              src={`/api/compare/file?${new URLSearchParams({ storyId: story.id, id: comparison.id })}`}
                              controls
                              preload="metadata"
                              className="w-full rounded-xl border border-line bg-black"
                            />
                            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                              {comparison.items.map((item) => {
                                const run = story.videos.find((candidate) => candidate.id === item.runId);
                                return (
                                  <Fragment key={item.letter}>
                                    <dt className="font-medium text-accent">{item.letter}</dt>
                                    <dd className="min-w-0 text-foreground/90">
                                      {item.lines.map((line) => line.replace(/^[A-D] · /, "")).join(" · ")}
                                      <span className="ml-2 text-muted">
                                        {run
                                          ? run.rating
                                            ? `${"★".repeat(run.rating)} ${run.note || ""}`
                                            : run.note || ""
                                          : "(generation deleted)"}
                                      </span>
                                    </dd>
                                  </Fragment>
                                );
                              })}
                            </dl>
                            <input
                              defaultValue={comparison.note}
                              onBlur={(event) => {
                                if (event.target.value !== comparison.note) noteComparison(comparison.id, event.target.value);
                              }}
                              placeholder="note: which one wins and why"
                              className="mt-3 w-full rounded-md border border-line bg-background px-2 py-1 text-xs text-foreground"
                            />
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              );
            })()}
          </section>
        )}
      </main>
      {viewer && (
        <Lightbox
          slides={viewer.slides}
          index={viewer.index}
          onIndex={(index) => setViewer((current) => (current ? { ...current, index } : current))}
          onClose={() => setViewer(null)}
        />
      )}
      <LoraDialog
        open={loraOpen}
        value={story.videoSettings.loras || []}
        onClose={() => setLoraOpen(false)}
        onSave={(loras) => {
          updateVideoSettings({ loras });
          setLoraOpen(false);
        }}
      />
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

// Ref2VA prompts come in two styles: timestamped beats for the long take, or the
// timestamp-free style the Story V2 workflow was proven with.
function PromptStyleSelect({
  value,
  reference,
  disabled,
  onChange,
}: {
  value: PromptStyle;
  reference: boolean;
  disabled: boolean;
  onChange: (value: PromptStyle) => void;
}) {
  return (
    <label
      className="flex items-center gap-2 text-xs text-muted"
      title={
        reference
          ? "Style used the next time prompts are written. Story V2: no timestamps, continuous segments open already in progress, absent characters left out."
          : "Prompt styles apply to reference-image prompts only. Select a reference image on the Image step."
      }
    >
      Prompt style
      <select
        value={reference ? value : "long-take"}
        disabled={disabled || !reference}
        onChange={(event) => onChange(event.target.value as PromptStyle)}
        className="rounded-md border border-line bg-background px-2 py-1 text-sm text-foreground"
      >
        <option value="long-take">Long take (timestamped)</option>
        <option value="story-v2">Story V2 (no timestamps)</option>
      </select>
    </label>
  );
}

// The optional H3 prompting tips (comedy timing, chaining, continuity, emotion, things H3
// does badly). The format, dialogue and no-on-screen-text rules always apply.
function H3TipsCheckbox({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-2 text-xs text-muted"
      title="Include the H3 prompting tips (comedy timing, segment chaining, continuity, emotion, things H3 does badly) when writing or updating prompts. The prompt format, dialogue and no-on-screen-text rules always apply."
    >
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      H3 tips
    </label>
  );
}
