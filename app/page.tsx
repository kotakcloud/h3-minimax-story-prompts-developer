"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLoggedFetch } from "@/components/debug-log";
import { IconButton, IconLink, Icons } from "@/components/icons";
import { ImportVideoFile } from "@/components/import-video-file";
import { Money } from "@/components/money";
import { StoryNote } from "@/components/story-note";
import { VideoPlayer } from "@/components/video-player";
import type { Project, StoryStep, StorySummary, StoryType } from "@/lib/types";
import { DuplicateStory } from "@/components/duplicate-story";
import { ProjectCharacters } from "@/components/project-characters";
import { ProjectSeed } from "@/components/project-seed";
import { ProjectCard } from "@/components/project-card";
import { DEFAULT_PROJECT_ID, STORY_TYPES, storyPath } from "@/lib/types";
import { DEFAULT_STEP_MODELS, RECOMMENDED_MODEL, storyModelsLabel } from "@/lib/models";
import { StepModelSelect } from "@/components/step-model-select";

// v3: choices saved before the current Prompts default are not reused.
const NEW_STEP_MODELS_KEY = "h3-new-story-step-models-v3";

const LAST_PROJECT_KEY = "h3-last-project";

function videoUrl(video: { filename: string; subfolder: string; type: string }) {
  return `/api/image/view?${new URLSearchParams({ filename: video.filename, subfolder: video.subfolder, type: video.type })}`;
}

// The project to show first: the one in the address (?project=), else the last one opened here.
function startingProject(): string {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get("project");
  if (fromUrl) return fromUrl;
  try {
    return window.localStorage.getItem(LAST_PROJECT_KEY) || "";
  } catch {
    return "";
  }
}

function stepLabel(step: StorySummary["step"]) {
  if (step === "gist") return "Gist";
  if (step === "cast") return "Cast";
  if (step === "image") return "Image";
  if (step === "frames") return "Frames";
  if (step === "export") return "Export";
  if (step === "video") return "Video";
  return "Prompts";
}

// Local date and time, e.g. 20 Oct 2026, 09:12 (the list renders client-side after its fetch).
function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Home() {
  const router = useRouter();
  const request = useLoggedFetch();
  const [stories, setStories] = useState<StorySummary[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [storyType, setStoryType] = useState<StoryType>("type-1");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState(startingProject);
  // "new" while naming a new project, a project id while renaming it.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  // The .env default model chain, named for stories that have no model of their own.
  const [defaultModels, setDefaultModels] = useState<string[]>([]);
  // Stories whose latest video file is gone from ComfyUI's output folder.
  const [missingVideos, setMissingVideos] = useState<string[]>([]);

  async function refresh() {
    const [storyResponse, projectResponse] = await Promise.all([request("/api/stories"), request("/api/projects")]);
    fetch("/api/openrouter-models")
      .then((response) => response.json())
      .then((data: { defaultModels?: unknown }) => {
        if (Array.isArray(data.defaultModels)) setDefaultModels(data.defaultModels.filter((id): id is string => typeof id === "string"));
      })
      .catch(() => {});
    const data = await storyResponse.json();
    const projectData = await projectResponse.json();
    if (!storyResponse.ok) throw new Error(data.error || "Could not load stories.");
    if (!projectResponse.ok) throw new Error(projectData.error || "Could not load projects.");
    setStories(data.stories || []);
    setProjects(projectData.projects || []);
  }

  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const archivedProjects = projects.filter((item) => item.archived);
  // A project that no longer exists (or none chosen yet) falls back to the first one.
  const project = projects.find((item) => item.id === projectId) || projects[0];
  const activeProjectId = project?.id || DEFAULT_PROJECT_ID;

  function openProject(id: string) {
    setProjectId(id);
    setShowArchived(false);
    window.history.replaceState(null, "", `/?project=${encodeURIComponent(id)}`);
    try {
      window.localStorage.setItem(LAST_PROJECT_KEY, id);
    } catch {
      // Storage blocked: the address still says which project is open.
    }
  }

  async function saveProjectName() {
    const name = draftName.trim();
    if (!name || !editing) return;
    setError("");
    const response = await request(editing === "new" ? "/api/projects" : `/api/projects/${encodeURIComponent(editing)}`, {
      method: editing === "new" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not save the project.");
      return;
    }
    setEditing(null);
    await refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load projects."));
    if (editing === "new") openProject(data.project.id);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load stories."));
  }, []);

  async function archiveProject(id: string, archived: boolean) {
    const target = projects.find((item) => item.id === id);
    if (archived && !window.confirm(`Archive the project "${target?.name || id}"? It is folded away in the list; its stories stay.`)) return;
    setError("");
    const response = await request(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not archive the project.");
      return;
    }
    const next = projects.map((item) => (item.id === id ? data.project : item));
    setProjects(next);
    // An archived project closes: the first project still shown opens instead.
    if (archived && id === activeProjectId) openProject(next.find((item) => !item.archived)?.id || DEFAULT_PROJECT_ID);
  }

  async function saveProjectSeed(id: string, videoSeed: number | null) {
    setError("");
    const response = await request(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoSeed }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not save the seed.");
      return;
    }
    setProjects((list) => list.map((item) => (item.id === id ? data.project : item)));
  }

  async function applyProjectSeed(id: string) {
    setError("");
    const response = await request(`/api/projects/${encodeURIComponent(id)}/apply-seed`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) setError(data.error || "Could not apply the seed.");
  }

  async function saveProjectCharacters(id: string, characterText: string) {
    setError("");
    const response = await request(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterText }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not save the characters.");
      throw new Error(data.error || "Could not save the characters.");
    }
    setProjects((list) => list.map((item) => (item.id === id ? data.project : item)));
  }

  // The new story's Frames / Prompts models: "" = the story's model. Remembered on this computer for the next story.
  const [newStepModels, setNewStepModels] = useState<{ frames: string; prompts: string }>(DEFAULT_STEP_MODELS);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(NEW_STEP_MODELS_KEY);
      if (!stored) return;
      const saved = JSON.parse(stored) as { frames?: unknown; prompts?: unknown };
      const text = (value: unknown) => (typeof value === "string" ? value : "");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser after the first render
      setNewStepModels({ frames: text(saved.frames), prompts: text(saved.prompts) });
    } catch {
      // No storage here: start on the story's model.
    }
  }, []);
  function chooseNewStepModel(step: "frames" | "prompts", model: string) {
    const next = { ...newStepModels, [step]: model };
    setNewStepModels(next);
    try {
      window.localStorage.setItem(NEW_STEP_MODELS_KEY, JSON.stringify(next));
    } catch {
      // Not remembered; still used for this story.
    }
  }

  async function createStory() {
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyType, projectId: activeProjectId, stepModels: newStepModels }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a story.");
      router.push(storyPath(data.story.id, "gist"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create a story.");
      setBusy(false);
    }
  }

  async function setArchived(id: string, archived: boolean) {
    const response = await request(`/api/stories/${id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not archive the story.");
      return;
    }
    setStories((current) => current.map((story) => (story.id === id ? { ...story, archived } : story)));
  }

  // Copy without the generated videos; the copy shows up at the top of the list.
  async function duplicate(id: string, upTo: StoryStep) {
    setError("");
    const response = await request(`/api/stories/${id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upTo }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not duplicate the story.");
      return;
    }
    await refresh().catch((err) => setError(err instanceof Error ? err.message : "Could not load stories."));
  }

  async function moveStory(id: string, target: string) {
    setError("");
    const response = await request(`/api/stories/${id}/project`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: target }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not move the story.");
      return;
    }
    setStories((current) => current.map((story) => (story.id === id ? { ...story, projectId: target } : story)));
  }

  async function removeStory(id: string) {
    if (!window.confirm("Delete this story from this machine?")) return;
    const response = await request(`/api/stories/${id}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Could not delete story.");
      return;
    }
    setStories((current) => current.filter((story) => story.id !== id));
  }

  const inProject = stories.filter((story) => story.projectId === activeProjectId);
  const archivedCount = inProject.filter((story) => story.archived).length;
  const visible = inProject.filter((story) => story.archived === showArchived);
  const countIn = (id: string) => stories.filter((story) => story.projectId === id && !story.archived).length;

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-10 sm:px-8">
      <section className="mb-8 border-b border-line pb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-accent">MiniMax H3</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Projects</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Stories are stored on the computer running this server. Open this same address from any device on the Wi-Fi to see
          the same list.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {projects
            .filter((item) => !item.archived || item.id === activeProjectId)
            .map((item) => (
              <ProjectCard
                key={item.id}
                project={item}
                stories={stories.filter((story) => story.projectId === item.id)}
                active={item.id === activeProjectId}
                onOpen={() => openProject(item.id)}
              />
            ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {editing ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProjectName();
              }}
            >
              <input
                autoFocus
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => event.key === "Escape" && setEditing(null)}
                placeholder="Project name"
                maxLength={80}
                className="w-48 rounded-full border border-accent bg-background px-4 py-1.5 text-sm outline-none"
              />
              <button type="submit" disabled={!draftName.trim()} className="rounded-full bg-accent px-4 py-1.5 text-sm text-accent-ink disabled:opacity-50">
                {editing === "new" ? "Create" : "Rename"}
              </button>
              <button type="button" onClick={() => setEditing(null)} className="px-2 py-1.5 text-sm text-muted">
                Cancel
              </button>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setDraftName("");
                  setEditing("new");
                }}
                className="rounded-full border border-dashed border-line px-4 py-1.5 text-sm text-muted hover:text-foreground"
              >
                + New project
              </button>
              {project && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftName(project.name);
                    setEditing(project.id);
                  }}
                  className="px-2 py-1.5 text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  Rename
                </button>
              )}
              {project && project.id !== DEFAULT_PROJECT_ID && (
                <button
                  type="button"
                  onClick={() => void archiveProject(project.id, !project.archived)}
                  title={project.archived ? "Show this project in the list again" : "Fold this project away in the list; its stories stay as they are"}
                  className="px-2 py-1.5 text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
                >
                  {project.archived ? "Unarchive" : "Archive"}
                </button>
              )}
              {archivedProjects.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowArchivedProjects(!showArchivedProjects)}
                  aria-expanded={showArchivedProjects}
                  className="ml-auto px-2 py-1.5 text-sm text-muted hover:text-foreground"
                >
                  {showArchivedProjects ? "▾" : "▸"} Archived projects ({archivedProjects.length})
                </button>
              )}
            </>
          )}
        </div>
        {showArchivedProjects && archivedProjects.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {archivedProjects.map((item) => (
              <span key={item.id} className="flex items-center gap-1 rounded-full border border-dashed border-line px-3 py-1 text-sm text-muted">
                <button type="button" onClick={() => openProject(item.id)} className="hover:text-foreground">
                  {item.name} <span className="text-xs opacity-70">{countIn(item.id)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void archiveProject(item.id, false)}
                  className="ml-1 text-xs text-accent hover:underline"
                >
                  Unarchive
                </button>
              </span>
            ))}
          </div>
        )}
        {project && (
          <ProjectSeed
            key={`seed-${project.id}`}
            project={project}
            storyCount={stories.filter((story) => story.projectId === project.id).length}
            onSave={(seed) => saveProjectSeed(project.id, seed)}
            onApply={() => applyProjectSeed(project.id)}
          />
        )}
        {project && (
          <ProjectCharacters key={project.id} project={project} projects={projects} onSave={(text) => saveProjectCharacters(project.id, text)} />
        )}
      </section>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Stories in <span className="text-accent">{project?.name || "…"}</span>
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <ImportVideoFile onError={setError} projectId={activeProjectId} />
          <label className="flex items-center gap-2 text-xs text-muted">
            New story type
            <select
              value={storyType}
              onChange={(event) => setStoryType(event.target.value as StoryType)}
              className="rounded-md border border-line bg-background px-2 py-1 text-sm text-foreground"
            >
              {STORY_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <StepModelSelect
            step="Frames"
            label="Frames model"
            value={newStepModels.frames}
            storyModel={RECOMMENDED_MODEL}
            defaults={defaultModels}
            onChange={(model) => chooseNewStepModel("frames", model)}
          />
          <StepModelSelect
            step="Prompts"
            label="Prompts model"
            value={newStepModels.prompts}
            storyModel={RECOMMENDED_MODEL}
            defaults={defaultModels}
            onChange={(model) => chooseNewStepModel("prompts", model)}
          />
          <IconButton
            label={busy ? "Creating story" : "New story"}
            onClick={createStory}
            disabled={busy}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink"
          >
            {Icons.plus}
          </IconButton>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {archivedCount > 0 && (
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={() => setShowArchived((show) => !show)}
            className="rounded-full border border-line px-4 py-1.5 text-sm text-muted"
          >
            {showArchived ? "Back to stories" : `Archived (${archivedCount})`}
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted">
          {showArchived
            ? "No archived stories."
            : inProject.length > 0
              ? "All stories in this project are archived."
              : "No stories in this project yet. Create one with the + button to start a gist."}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((story) => (
            <li
              key={story.id}
              className="flex flex-col gap-4 rounded-2xl border border-line bg-card px-4 py-4 sm:flex-row sm:items-start"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-3">
              <div className="min-w-0">
                <Link href={storyPath(story.id, story.step)} className="block truncate text-base font-medium">
                  {story.title}
                </Link>
                <p className="truncate text-xs text-accent/80" title={story.aiModel || "The .env default model"}>
                  {storyModelsLabel(story, defaultModels)}
                </p>
                <p className="text-xs text-muted" title="What this story's AI calls have cost so far (counted since 3 Nov 2026)">
                  AI cost <Money usd={story.aiCostUsd ?? 0} />
                </p>
                {story.latestVideo && (
                  <p className="text-xs text-muted" title="The stars you gave the latest video (on its Video tab)">
                    Latest video{" "}
                    {story.latestVideo.rating > 0 ? (
                      <span className="text-amber-300" aria-label={`${story.latestVideo.rating} of 5 stars`}>
                        {"★".repeat(story.latestVideo.rating)}
                        <span className="text-muted/50">{"★".repeat(5 - story.latestVideo.rating)}</span>
                      </span>
                    ) : (
                      "not rated"
                    )}
                  </p>
                )}
                <p className="mt-1 font-mono text-xs text-muted">
                  <span className="text-foreground" title={`Story number (id ${story.id})`}>#{story.code || story.id}</span> · {story.imported ? "Imported" : stepLabel(story.step)} · {story.storyType === "type-1" ? "type-1 · " : ""}{story.frameCount} frames · {story.segmentCount} prompts
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  <span title={story.createdAt}>Created {formatDate(story.createdAt)}</span>
                  {" · "}
                  <span title={story.updatedAt}>Updated {formatDate(story.updatedAt)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {projects.length > 1 && (
                  <select
                    value=""
                    onChange={(event) => event.target.value && void moveStory(story.id, event.target.value)}
                    aria-label="Move to another project"
                    title="Move to another project"
                    className="max-w-36 rounded-full border border-line bg-background px-3 py-1.5 text-xs text-muted"
                  >
                    <option value="">Move to…</option>
                    {projects
                      .filter((item) => item.id !== story.projectId)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                )}
                <IconLink
                  href={storyPath(story.id, story.step)}
                  label="Open"
                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-foreground text-background"
                >
                  {Icons.open}
                </IconLink>
                <IconLink href={storyPath(story.id, story.step)} label="Open in new tab" target="_blank">
                  {Icons.external}
                </IconLink>
                <DuplicateStory
                  storyType={story.storyType}
                  imported={story.imported}
                  onDuplicate={(upTo) => void duplicate(story.id, upTo)}
                />
                <IconButton
                  label={story.archived ? "Unarchive" : "Archive"}
                  onClick={() => setArchived(story.id, !story.archived)}
                >
                  {story.archived ? Icons.unarchive : Icons.archive}
                </IconButton>
                <IconButton label="Delete" onClick={() => removeStory(story.id)}>
                  {Icons.trash}
                </IconButton>
              </div>
              <StoryNote storyId={story.id} initial={story.note} />
              </div>
              {story.latestVideo && (
                <div className="w-full shrink-0 sm:w-72">
                  {missingVideos.includes(story.id) ? (
                    <p className="flex aspect-video w-full items-center justify-center rounded-xl border border-dashed border-line px-4 text-center text-xs text-muted">
                      The video file is no longer in ComfyUI&apos;s output folder.
                    </p>
                  ) : (
                    <VideoPlayer
                      src={videoUrl(story.latestVideo)}
                      preload="metadata"
                      onError={() => setMissingVideos((ids) => (ids.includes(story.id) ? ids : [...ids, story.id]))}
                      className="aspect-video w-full rounded-xl border border-line bg-black"
                    />
                  )}
                  <p className="mt-1 text-xs text-muted">
                    Latest video · {story.latestVideo.ultraFast ? "Ultra fast" : story.latestVideo.devMode ? "DEV" : "FULL"} ·{" "}
                    {formatDate(story.latestVideo.createdAt)}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
