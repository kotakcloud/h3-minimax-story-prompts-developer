import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { replaceFile } from "./story-store";
import { parseCharacterCards } from "./character-cards";
import { DEFAULT_PROJECT_ID, type Project } from "./types";

// Projects group stories (data/projects.json). Stories from before projects existed belong to "unknown", which is
// always there and can be renamed like any other.

const projectsFile = path.join(process.cwd(), "data", "projects.json");
let queue: Promise<unknown> = Promise.resolve();

function cleanName(name: unknown): string {
  return typeof name === "string" ? name.replace(/\s+/g, " ").trim().slice(0, 80) : "";
}

async function readProjects(): Promise<Project[]> {
  let list: Project[] = [];
  try {
    const raw = JSON.parse(await readFile(projectsFile, "utf8")) as unknown;
    list = Array.isArray(raw) ? (raw as Project[]).filter((item) => item && typeof item.id === "string") : [];
  } catch {
    list = [];
  }
  if (!list.some((project) => project.id === DEFAULT_PROJECT_ID)) {
    list.unshift({ id: DEFAULT_PROJECT_ID, name: "unknown", createdAt: "2026-10-01T00:00:00.000Z" });
  }
  return list;
}

async function saveProjects(list: Project[]) {
  await mkdir(path.dirname(projectsFile), { recursive: true });
  const temp = `${projectsFile}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(temp, JSON.stringify(list, null, 2), "utf8");
  await replaceFile(temp, projectsFile);
}

// One change at a time, so two quick edits cannot overwrite each other.
function change<T>(task: (list: Project[]) => Promise<T>): Promise<T> {
  const next = queue.then(async () => task(await readProjects()));
  queue = next.catch(() => {});
  return next;
}

export async function readProject(id: string): Promise<Project | null> {
  return (await readProjects()).find((project) => project.id === id) || null;
}

// The project's video seed (a whole number of 0 or more), or null to have none.
export function setProjectSeed(id: string, seed: unknown): Promise<Project | null> {
  const value = seed === null || seed === "" ? null : Number(seed);
  if (value !== null && !(Number.isSafeInteger(value) && value >= 0)) {
    return Promise.reject(new Error("The seed is a whole number of 0 or more."));
  }
  return change(async (list) => {
    const project = list.find((item) => item.id === id);
    if (!project) return null;
    if (value === null) delete project.videoSeed;
    else project.videoSeed = value;
    await saveProjects(list);
    return project;
  });
}

// Archives (or brings back) a project. "unknown" stays, since new stories without a project go there.
export function setProjectArchived(id: string, archived: unknown): Promise<Project | null> {
  if (id === DEFAULT_PROJECT_ID && archived === true) return Promise.reject(new Error("The unknown project cannot be archived."));
  return change(async (list) => {
    const project = list.find((item) => item.id === id);
    if (!project) return null;
    if (archived === true) project.archived = true;
    else delete project.archived;
    await saveProjects(list);
    return project;
  });
}

export function listProjects(): Promise<Project[]> {
  return readProjects();
}

export async function projectExists(id: string): Promise<boolean> {
  return (await readProjects()).some((project) => project.id === id);
}

export function createProject(name: unknown): Promise<Project> {
  const clean = cleanName(name);
  if (!clean) return Promise.reject(new Error("Give the project a name."));
  return change(async (list) => {
    const project = { id: randomUUID(), name: clean, createdAt: new Date().toISOString() };
    await saveProjects([...list, project]);
    return project;
  });
}

// Saves the pasted character designs and the cards read from them.
export function setProjectCharacters(id: string, text: unknown): Promise<Project | null> {
  const characterText = typeof text === "string" ? text.slice(0, 50_000) : "";
  return change(async (list) => {
    const project = list.find((item) => item.id === id);
    if (!project) return null;
    project.characterText = characterText;
    project.characters = parseCharacterCards(characterText);
    await saveProjects(list);
    return project;
  });
}

export function renameProject(id: string, name: unknown): Promise<Project | null> {
  const clean = cleanName(name);
  if (!clean) return Promise.reject(new Error("Give the project a name."));
  return change(async (list) => {
    const project = list.find((item) => item.id === id);
    if (!project) return null;
    project.name = clean;
    await saveProjects(list);
    return project;
  });
}
