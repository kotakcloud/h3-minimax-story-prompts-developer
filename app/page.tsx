"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLoggedFetch } from "@/components/debug-log";
import { IconButton, IconLink, Icons } from "@/components/icons";
import { ImportVideoFile } from "@/components/import-video-file";
import type { Project, StorySummary, StoryType } from "@/lib/types";
import { DEFAULT_PROJECT_ID, STORY_TYPES, storyPath } from "@/lib/types";

const LAST_PROJECT_KEY = "h3-last-project";

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

  async function refresh() {
    const [storyResponse, projectResponse] = await Promise.all([request("/api/stories"), request("/api/projects")]);
    const data = await storyResponse.json();
    const projectData = await projectResponse.json();
    if (!storyResponse.ok) throw new Error(data.error || "Could not load stories.");
    if (!projectResponse.ok) throw new Error(projectData.error || "Could not load projects.");
    setStories(data.stories || []);
    setProjects(projectData.projects || []);
  }

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

  async function createStory() {
    setBusy(true);
    setError("");
    try {
      const response = await request("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyType, projectId: activeProjectId }),
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
  async function duplicate(id: string) {
    setError("");
    const response = await request(`/api/stories/${id}/duplicate`, { method: "POST" });
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
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {projects.map((item) =>
            editing === item.id ? null : (
              <button
                key={item.id}
                type="button"
                onClick={() => openProject(item.id)}
                aria-pressed={item.id === activeProjectId}
                className={`rounded-full px-4 py-1.5 text-sm ${
                  item.id === activeProjectId ? "bg-foreground text-background" : "border border-line text-muted"
                }`}
              >
                {item.name} <span className="text-xs opacity-70">{countIn(item.id)}</span>
              </button>
            ),
          )}
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
            </>
          )}
        </div>
      </section>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h2 className="text-xl font-semibold tracking-tight">
          Stories in <span className="text-accent">{project?.name || "…"}</span>
        </h2>
        <div className="flex items-center gap-3">
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
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-4"
            >
              <div className="min-w-0">
                <Link href={storyPath(story.id, story.step)} className="block truncate text-base font-medium">
                  {story.title}
                </Link>
                <p className="mt-1 font-mono text-xs text-muted">
                  {story.id} · {story.imported ? "Imported" : stepLabel(story.step)} · {story.storyType === "type-1" ? "type-1 · " : ""}{story.frameCount} frames · {story.segmentCount} prompts
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
                <IconButton label="Duplicate (without videos)" onClick={() => void duplicate(story.id)}>
                  {Icons.copy}
                </IconButton>
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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
