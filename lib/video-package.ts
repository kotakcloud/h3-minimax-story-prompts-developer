import { isVideoEngine } from "./engines";
import type { Character, Frame, PromptSegment, PromptStyle, ReferenceImage, Story, StoryLocation, VideoSettings } from "./types";
import { DEFAULT_VIDEO_SETTINGS, activePromptStyle, isPromptStyle } from "./types";

// The video file: everything a render needs, self-contained (images embedded), so it can be imported on another
// machine. Built to be merged later: every segment names its own image and source story, so a combined file is the
// segments of several files in order, plus all their images and sources.
export const PACKAGE_FORMAT = "h3-video-package";
export const PACKAGE_VERSION = 1;

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export type PackageImage = {
  id: string;
  name: string;
  aspectRatio: string;
  megapixels: number;
  prompt: string;
  seed: number;
  source?: "upload";
  // Base64 PNG; a storyboard grid also carries its cut-out panels.
  png: string;
  grid?: { rows: number; cols: number; panelAspectRatio: string; panels: string[] };
};

export type PackageSource = {
  storyId: string;
  title: string;
  gist: string;
  characters: Character[];
  location: StoryLocation;
  imageLayout: string;
  promptStyle: PromptStyle;
  language?: string;
};

export type PackageSegment = {
  id: string;
  title: string;
  summary: string;
  duration: number;
  prompt: string;
  panel?: number;
  join?: "cut" | "continuous";
  // PackageImage.id
  image: string;
  // Index in sources.
  source: number;
};

export type VideoPackage = {
  format: typeof PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  title: string;
  sources: PackageSource[];
  images: PackageImage[];
  segments: PackageSegment[];
  settings: VideoSettings & { gridFeed: "whole" | "panels" };
};

// What an imported story keeps of its file, for the details on the Video tab.
export type ImportedFrom = {
  fileName: string;
  exportedAt: string;
  sources: PackageSource[];
};

type ImageFile = { filename: string; subfolder: string; type: string };

export async function buildVideoPackage(
  story: Story,
  readPng: (image: ImageFile) => Promise<Buffer>,
): Promise<VideoPackage> {
  const image = story.referenceImages.find((item) => item.id === story.selectedImageId);
  if (!image) throw new Error("Select a reference image on the Image step first.");
  if (story.segments.length === 0) throw new Error("Write the prompts first.");
  const base64 = async (file: ImageFile) => (await readPng(file)).toString("base64");
  const revision = story.promptRevisions.find((item) => item.id === story.activeRevisionId);
  return {
    format: PACKAGE_FORMAT,
    version: PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    title: story.title,
    sources: [
      {
        storyId: story.id,
        title: story.title,
        gist: story.gist,
        characters: story.characters,
        location: story.location,
        imageLayout: story.imageLayout,
        promptStyle: activePromptStyle(story),
        ...(revision?.language ? { language: revision.language } : {}),
      },
    ],
    images: [
      {
        id: image.id,
        name: image.originalName || image.filename,
        aspectRatio: image.aspectRatio,
        megapixels: image.megapixels,
        prompt: image.prompt,
        seed: image.seed,
        ...(image.source ? { source: image.source } : {}),
        png: await base64(image),
        ...(image.grid
          ? {
              grid: {
                rows: image.grid.rows,
                cols: image.grid.cols,
                panelAspectRatio: image.grid.panelAspectRatio,
                panels: await Promise.all(image.grid.panels.map(base64)),
              },
            }
          : {}),
      },
    ],
    segments: story.segments.map((segment) => {
      const frame = story.frames.find((item) => item.id === segment.id);
      const panel = segment.panel ?? frame?.panel;
      const join = segment.join ?? frame?.join;
      return {
        id: segment.id,
        title: frame?.title || "",
        summary: frame?.summary || "",
        duration: segment.duration,
        prompt: segment.prompt,
        ...(panel ? { panel } : {}),
        ...(join ? { join } : {}),
        image: image.id,
        source: 0,
      };
    }),
    settings: { ...story.videoSettings, gridFeed: story.gridFeed },
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodePng(value: unknown): Buffer {
  const bytes = Buffer.from(text(value), "base64");
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    throw new Error("The file has an image that is not a valid PNG.");
  }
  return bytes;
}

function parseSettings(value: unknown): VideoPackage["settings"] {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<VideoPackage["settings"]>;
  const number = (item: unknown, fallback: number) => (typeof item === "number" && Number.isFinite(item) ? item : fallback);
  const base = DEFAULT_VIDEO_SETTINGS;
  return {
    devMode: raw.devMode !== false,
    seed: Math.max(0, Math.floor(number(raw.seed, base.seed))),
    engine: isVideoEngine(raw.engine) ? raw.engine : base.engine,
    v2Megapixels: number(raw.v2Megapixels, base.v2Megapixels),
    v2Steps: number(raw.v2Steps, base.v2Steps),
    v2DevMegapixels: number(raw.v2DevMegapixels, base.v2DevMegapixels),
    v2DevSteps: number(raw.v2DevSteps, base.v2DevSteps),
    loras: (Array.isArray(raw.loras) ? raw.loras : [])
      .filter((lora) => typeof lora?.name === "string")
      .map((lora) => ({ name: lora.name, strength: number(lora.strength, 1), enabled: lora.enabled !== false })),
    onlyFirst: Math.max(0, Math.floor(number(raw.onlyFirst, 0))),
    gridFeed: raw.gridFeed === "panels" ? "panels" : "whole",
  };
}

// Checks an uploaded file; everything used later comes from here, never from the raw JSON.
export function parseVideoPackage(value: unknown): VideoPackage {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<VideoPackage>;
  if (raw.format !== PACKAGE_FORMAT) throw new Error("This is not an H3 video file.");
  if (typeof raw.version !== "number" || raw.version > PACKAGE_VERSION) {
    throw new Error("This file comes from a newer version of the app.");
  }
  const images: PackageImage[] = (Array.isArray(raw.images) ? raw.images : []).map((image) => {
    decodePng(image.png);
    (image.grid?.panels || []).forEach(decodePng);
    return {
      id: text(image.id),
      name: text(image.name),
      aspectRatio: text(image.aspectRatio) || "16:9 (Widescreen)",
      megapixels: Number(image.megapixels) || 0,
      prompt: text(image.prompt),
      seed: Number(image.seed) || 0,
      ...(image.source === "upload" ? { source: "upload" as const } : {}),
      png: image.png,
      ...(image.grid
        ? {
            grid: {
              rows: Number(image.grid.rows) || 1,
              cols: Number(image.grid.cols) || 1,
              panelAspectRatio: text(image.grid.panelAspectRatio) || "16:9 (Widescreen)",
              panels: image.grid.panels,
            },
          }
        : {}),
    };
  });
  const sources: PackageSource[] = (Array.isArray(raw.sources) ? raw.sources : []).map((source) => ({
    storyId: text(source.storyId),
    title: text(source.title),
    gist: text(source.gist),
    characters: Array.isArray(source.characters) ? source.characters : [],
    location: { name: text(source.location?.name), description: text(source.location?.description), generated: source.location?.generated === true },
    imageLayout: text(source.imageLayout),
    promptStyle: isPromptStyle(source.promptStyle) ? source.promptStyle : "long-take",
    ...(source.language ? { language: text(source.language) } : {}),
  }));
  const segments: PackageSegment[] = (Array.isArray(raw.segments) ? raw.segments : []).map((segment, index) => {
    const duration = Number(segment.duration);
    if (!text(segment.prompt).trim() || !(duration >= 4 && duration <= 15)) {
      throw new Error(`Segment ${index + 1} needs a prompt and a 4–15 s duration.`);
    }
    if (!images.some((image) => image.id === segment.image)) {
      throw new Error(`Segment ${index + 1} names an image that is not in the file.`);
    }
    const panel = Math.round(Number(segment.panel) || 0);
    return {
      id: text(segment.id) || `S${index + 1}`,
      title: text(segment.title),
      summary: text(segment.summary),
      duration,
      prompt: segment.prompt,
      ...(panel >= 1 ? { panel } : {}),
      ...(segment.join === "cut" || segment.join === "continuous" ? { join: segment.join } : {}),
      image: segment.image,
      source: Math.max(0, Math.round(Number(segment.source) || 0)),
    };
  });
  if (segments.length === 0 || sources.length === 0) throw new Error("The file has no segments to render.");
  // The render path takes one reference image per run, so a file with more needs per-segment images first.
  if (new Set(segments.map((segment) => segment.image)).size > 1) {
    throw new Error("This file uses several reference images, which a single video cannot render yet.");
  }
  return {
    format: PACKAGE_FORMAT,
    version: raw.version,
    exportedAt: text(raw.exportedAt),
    title: text(raw.title) || sources[0].title || "Imported video",
    sources,
    images,
    segments,
    settings: parseSettings(raw.settings),
  };
}

export function packagePngs(image: PackageImage): { suffix: string; bytes: Buffer }[] {
  return [
    { suffix: "", bytes: decodePng(image.png) },
    ...(image.grid?.panels || []).map((panel, index) => ({ suffix: `_p${index + 1}`, bytes: decodePng(panel) })),
  ];
}

// The story fields of an imported file: a story that only has a Video step. `files[0]` is the image, then its panels.
export function storyFromPackage(pkg: VideoPackage, fileName: string, files: ImageFile[]): Partial<Story> {
  const image = pkg.images.find((item) => item.id === pkg.segments[0].image)!;
  const { gridFeed, ...videoSettings } = pkg.settings;
  const source = pkg.sources[0];
  const reference: ReferenceImage = {
    id: image.id,
    ...files[0],
    prompt: image.prompt,
    seed: image.seed,
    aspectRatio: image.aspectRatio,
    megapixels: image.megapixels,
    createdAt: pkg.exportedAt,
    ...(image.source ? { source: image.source, originalName: image.name } : {}),
    ...(image.grid
      ? {
          grid: {
            rows: image.grid.rows,
            cols: image.grid.cols,
            panelAspectRatio: image.grid.panelAspectRatio,
            panels: files.slice(1),
          },
        }
      : {}),
  };
  const segments: PromptSegment[] = pkg.segments.map((segment) => ({
    id: segment.id,
    duration: segment.duration,
    prompt: segment.prompt,
    ...(segment.panel ? { panel: segment.panel } : {}),
    ...(segment.join ? { join: segment.join } : {}),
  }));
  const frames: Frame[] = pkg.segments.map((segment) => ({
    id: segment.id,
    title: segment.title,
    summary: segment.summary,
    duration: segment.duration,
    ...(segment.panel ? { panel: segment.panel } : {}),
    ...(segment.join ? { join: segment.join } : {}),
  }));
  return {
    title: `${pkg.title} (imported)`,
    step: "video",
    gist: source.gist,
    characters: source.characters,
    location: source.location,
    imageLayout: source.imageLayout,
    referenceImages: [reference],
    selectedImageId: reference.id,
    videoSettings,
    gridFeed,
    promptStyle: source.promptStyle,
    frames,
    segments,
    promptRevisions: [
      {
        id: "1",
        createdAt: pkg.exportedAt,
        segments,
        promptStyle: source.promptStyle,
        ...(source.language ? { language: source.language } : {}),
      },
    ],
    activeRevisionId: "1",
    imported: { fileName, exportedAt: pkg.exportedAt, sources: pkg.sources },
  };
}
