import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fastStorySize, type FastStoryEngine, type Size } from "./engines";

export const COMFYUI_URL = (process.env.COMFYUI_URL || "http://127.0.0.1:8188").replace(/\/+$/, "");

// Node ids in comfy/z-image-turbo-t2i.json (ComfyUI API format).
const NODE = {
  save: "9",
  positive: "67",
  sampler: "70",
  negative: "71",
  resolution: "72",
} as const;

const DEFAULT_NEGATIVE = "low quality, bad anatomy, extra digits, missing digits, extra limbs, missing limbs";
const POLL_MS = 1500;
const TIMEOUT_MS = 280_000;

export type ComfyImage = { filename: string; subfolder: string; type: string };

type ApiNode = { inputs: Record<string, unknown>; class_type: string };

async function loadTemplate(): Promise<Record<string, ApiNode>> {
  const text = await readFile(path.join(process.cwd(), "comfy", "z-image-turbo-t2i.json"), "utf8");
  return JSON.parse(text) as Record<string, ApiNode>;
}

async function comfyJson(url: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(`ComfyUI is not reachable at ${COMFYUI_URL}. Start ComfyUI or set COMFYUI_URL.`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = JSON.stringify(body).slice(0, 400);
    throw new Error(`ComfyUI request failed (${response.status}): ${detail}`);
  }
  return body;
}

// A user's own reference picture (already PNG, see the Image tab), stored next to the generated
// ones in ComfyUI's output folder so both video workflows read it the same way.
export async function uploadReferenceImage(png: Blob, subfolder: string, filename: string): Promise<ComfyImage> {
  const form = new FormData();
  form.append("image", png, filename);
  form.append("type", "output");
  form.append("subfolder", subfolder);
  const uploaded = (await comfyJson(`${COMFYUI_URL}/upload/image`, { method: "POST", body: form })) as {
    name?: string;
    subfolder?: string;
    type?: string;
  };
  if (!uploaded.name) throw new Error("ComfyUI did not accept the image.");
  return { filename: uploaded.name, subfolder: uploaded.subfolder ?? subfolder, type: uploaded.type || "output" };
}

export async function generateReferenceImage(options: {
  prompt: string;
  negative: string;
  aspectRatio: string;
  megapixels: number;
  seed: number;
  filenamePrefix: string;
}): Promise<ComfyImage[]> {
  const workflow = await loadTemplate();
  workflow[NODE.positive].inputs.text = options.prompt;
  workflow[NODE.negative].inputs.text = options.negative || DEFAULT_NEGATIVE;
  workflow[NODE.sampler].inputs.seed = options.seed;
  workflow[NODE.resolution].inputs.aspect_ratio = options.aspectRatio;
  workflow[NODE.resolution].inputs.megapixels = options.megapixels;
  workflow[NODE.save].inputs.filename_prefix = options.filenamePrefix;

  const promptId = await queueWorkflow(workflow);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const entry = await historyEntry(promptId);
    if (!entry) continue;
    if (entry.status?.status_str === "error") {
      throw new Error(`ComfyUI failed: ${executionError(entry)}`);
    }
    if (entry.status?.completed) {
      const images = entry.outputs?.[NODE.save]?.images || [];
      if (images.length === 0) {
        throw new Error("ComfyUI finished but saved no image.");
      }
      return images;
    }
  }
  throw new Error("ComfyUI took too long. The image may still appear in ComfyUI's queue.");
}

type HistoryEntry = {
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, { images?: ComfyImage[] }>;
};

async function queueWorkflow(workflow: Record<string, ApiNode>): Promise<string> {
  const queued = (await comfyJson(`${COMFYUI_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: randomUUID() }),
  })) as { prompt_id?: string; node_errors?: Record<string, unknown> };

  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(queued.node_errors).slice(0, 400)}`);
  }
  if (!queued.prompt_id) {
    throw new Error("ComfyUI did not return a prompt id.");
  }
  return queued.prompt_id;
}

async function historyEntry(promptId: string): Promise<HistoryEntry | undefined> {
  const history = (await comfyJson(`${COMFYUI_URL}/history/${promptId}`)) as Record<string, HistoryEntry>;
  return history[promptId];
}

function wasInterrupted(entry: HistoryEntry): boolean {
  return Boolean(entry.status?.messages?.some(([kind]) => kind === "execution_interrupted"));
}

// Stops only this job: a running one is interrupted by prompt id (ComfyUI ignores the call when
// another prompt is running), a pending one is removed from the queue. Other work on the GPU is untouched.
export async function cancelPrompt(promptId: string): Promise<"interrupted" | "removed" | "not-found"> {
  const queue = (await comfyJson(`${COMFYUI_URL}/queue`)) as {
    queue_running?: [number, string][];
    queue_pending?: [number, string][];
  };
  if ((queue.queue_running || []).some((item) => item[1] === promptId)) {
    await comfyJson(`${COMFYUI_URL}/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId }),
    });
    return "interrupted";
  }
  if ((queue.queue_pending || []).some((item) => item[1] === promptId)) {
    await comfyJson(`${COMFYUI_URL}/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delete: [promptId] }),
    });
    return "removed";
  }
  return "not-found";
}

function executionError(entry: HistoryEntry): string {
  const failure = entry.status?.messages?.find(([kind]) => kind === "execution_error")?.[1];
  return String(failure?.exception_message || "unknown error").trim();
}

// ---------------------------------------------------------------------------
// Enhancement LoRAs (models/loras/minimax-h3), chained right after the UNET loader of any workflow
// ---------------------------------------------------------------------------

export type LoraChoice = { name: string; strength: number };

// The H3 LoRAs ComfyUI can load, fresh on every call (ComfyUI rescans the folder when it changes).
export async function listH3Loras(): Promise<string[]> {
  const info = (await comfyJson(`${COMFYUI_URL}/object_info/LoraLoaderModelOnly`)) as Record<
    string,
    { input?: { required?: { lora_name?: unknown[] } } }
  >;
  const spec = info.LoraLoaderModelOnly?.input?.required?.lora_name || [];
  const options = Array.isArray(spec[0])
    ? (spec[0] as unknown[])
    : ((spec[1] as { options?: unknown[] } | undefined)?.options ?? []);
  return options
    .map(String)
    .filter((name) => /^minimax-h3[\\/]/i.test(name))
    .sort((a, b) => a.localeCompare(b));
}

// Inserts LoraLoaderModelOnly nodes between each UNET loader and whatever used it, in order.
export function applyLoras(workflow: Record<string, ApiNode>, loras: LoraChoice[] | undefined): void {
  if (!loras?.length) return;
  for (const unetId of Object.keys(workflow).filter((id) => workflow[id].class_type === "UNETLoader")) {
    const consumers = Object.values(workflow).flatMap((node) =>
      Object.entries(node.inputs)
        .filter(([, value]) => Array.isArray(value) && value[0] === unetId && value[1] === 0)
        .map(([key]) => ({ node, key })),
    );
    let previous: [string, number] = [unetId, 0];
    loras.forEach((lora, index) => {
      const id = `workshop_lora_${unetId.replace(/[^A-Za-z0-9]/g, "_")}_${index + 1}`;
      workflow[id] = {
        class_type: "LoraLoaderModelOnly",
        inputs: { lora_name: lora.name, strength_model: lora.strength, model: previous },
      };
      previous = [id, 0];
    });
    for (const { node, key } of consumers) node.inputs[key] = previous;
  }
}

// ---------------------------------------------------------------------------
// H3 long take (comfy/h3-long-take-ref.json, ComfyUI API format)
// ---------------------------------------------------------------------------

const LONG_TAKE = {
  project: "15",
  combine: "17",
  save: "25",
  editor: "29",
  devMode: "43",
  devProject: "50",
  finalProject: "51",
  resolutionPreset: "56",
  baseImage: "57",
} as const;

const FPS = 24;

async function referenceImageSize(image: ComfyImage): Promise<{ width: number; height: number }> {
  const response = await fetch(comfyViewUrl(image));
  if (!response.ok) {
    throw new Error(`Could not read the reference image from ComfyUI (${response.status}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const png = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || png.some((value, index) => bytes[index] !== value)) {
    throw new Error("The reference image is not a PNG.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function queueLongTake(options: {
  loras?: LoraChoice[];
  segments: { duration: number; prompt: string }[];
  image: ComfyImage;
  devMode: boolean;
  seed: number;
  projectBase: string;
}): Promise<{ promptId: string; project: string }> {
  const text = await readFile(path.join(process.cwd(), "comfy", "h3-long-take-ref.json"), "utf8");
  const workflow = JSON.parse(text) as Record<string, ApiNode>;

  // Base canvas takes the reference image's aspect ratio; the workflow then scales it
  // to the dev/final megapixels.
  const size = await referenceImageSize(options.image);
  delete workflow[LONG_TAKE.resolutionPreset];
  workflow[LONG_TAKE.baseImage].inputs.width = size.width;
  workflow[LONG_TAKE.baseImage].inputs.height = size.height;

  const devProject = `${options.projectBase}_dev`;
  const finalProject = `${options.projectBase}_final`;
  workflow[LONG_TAKE.devMode].inputs.value = options.devMode;
  workflow[LONG_TAKE.devProject].inputs.value = devProject;
  workflow[LONG_TAKE.finalProject].inputs.value = finalProject;
  workflow[LONG_TAKE.project].inputs.seed = options.seed;
  workflow[LONG_TAKE.project].inputs.segment_start_number = 1;
  workflow[LONG_TAKE.project].inputs.segment_count = -1;
  const project = options.devMode ? devProject : finalProject;
  workflow[LONG_TAKE.combine].inputs.project_data = JSON.stringify({ project_name: project, auto_combine: true });

  const imagePath = [...options.image.subfolder.split(/[\\/]+/).filter(Boolean), options.image.filename].join("/");
  const trackData = JSON.parse(String(workflow[LONG_TAKE.editor].inputs.track_data)) as {
    tracks: { type: string; segments: unknown[] }[];
    total_length: number;
    frame_rate: number;
  };
  let start = 0;
  const segments = options.segments.map((segment, index) => {
    const frames = Math.round(segment.duration * FPS);
    const entry = {
      id: randomUUID(),
      start_frame: start,
      end_frame: start + frames,
      color: "var(--multitrack-task-bg)",
      content: {
        media_type: "none",
        task_mode: index === 0 ? "ref" : "edit",
        continuity_mode: index === 0 ? "shot" : "context_swap",
        ref_image_size: "match",
        images: [
          {
            id: randomUUID(),
            source_type: options.image.type === "input" ? "input" : "output",
            file_path: imagePath,
            file_name: options.image.filename,
            shared_reference: true,
            ...(index > 0 ? { shared_reference_copy: true } : {}),
          },
        ],
        muted: false,
        volume_db: 0,
        user_prompt: segment.prompt,
      },
    };
    start += frames;
    return entry;
  });
  const task = trackData.tracks.find((track) => track.type === "task");
  if (!task) {
    throw new Error("The long-take template has no task track.");
  }
  task.segments = segments;
  trackData.total_length = start;
  trackData.frame_rate = FPS;
  workflow[LONG_TAKE.editor].inputs.track_data = JSON.stringify(trackData);

  applyLoras(workflow, options.loras);
  const promptId = await queueWorkflow(workflow);
  return { promptId, project };
}

// ---------------------------------------------------------------------------
// H3 Story V2 (comfy/h3-story-v2-ref2va.json, ComfyUI API format), ported from the Themed
// Transformation Video Pipeline (core/h3_v2.py). Every segment is a `ref` task on the same image;
// dual-pass render (x1.25 latent upscale refine). See docs/HANDOFF_h3_story_v2_for_workshop_app.md.
// ---------------------------------------------------------------------------

// MP, steps and the project folder are links through DEV switches: set the primitives, never
// nodes 29 / 22 / 15 for those values.
const STORY_V2 = {
  project: "15",
  combine: "17",
  editor: "29",
  devMode: "40",
  megapixels: "41",
  devMegapixels: "42",
  projectName: "44",
  devProjectName: "45",
  steps: "48",
  devSteps: "49",
} as const;

// A segment of a ref2va story. join "cut" starts a fresh shot (continuity "shot"); image gives the
// segment its own reference (a storyboard panel) instead of the story's shared picture.
export type StorySegment = { duration: number; prompt: string; join?: "cut" | "continuous"; image?: ComfyImage };

export type StoryV2Options = {
  segments: StorySegment[];
  image: ComfyImage;
  devMode: boolean;
  seed: number;
  megapixels: number;
  steps: number;
  devMegapixels: number;
  devSteps: number;
  aspectRatio: string;
  projectBase: string;
  startSegment?: number;
  // Storyboard grids use "max" so the panels keep their detail.
  refImageSize?: "match" | "max";
  loras?: LoraChoice[];
};

type TrackData = { tracks: { type: string; segments: unknown[] }[]; total_length: number; frame_rate: number };

export function storyV2TrackData(
  template: string,
  segments: StoryV2Options["segments"],
  image: ComfyImage,
  refImageSize = "match",
): string {
  const trackData = JSON.parse(template) as TrackData;
  const pathOf = (item: ComfyImage) => [...item.subfolder.split(/[\\/]+/).filter(Boolean), item.filename].join("/");
  let start = 0;
  const entries = segments.map((segment, index) => {
    const frames = Math.max(1, Math.round(segment.duration * FPS));
    const own = segment.image;
    const entry = {
      id: randomUUID(),
      start_frame: start,
      end_frame: start + frames,
      color: "var(--multitrack-task-bg)",
      content: {
        media_type: "none",
        task_mode: "ref",
        // Segments continue the same take unless their join is a cut (storyboard grids).
        continuity_mode: index === 0 || segment.join === "cut" ? "shot" : "context_swap",
        ref_image_size: refImageSize,
        images: [
          own
            ? {
                id: randomUUID(),
                source_type: own.type === "input" ? "input" : "output",
                file_path: pathOf(own),
                file_name: own.filename,
              }
            : {
                id: randomUUID(),
                source_type: image.type === "input" ? "input" : "output",
                file_path: pathOf(image),
                file_name: image.filename,
                shared_reference: true,
                ...(index > 0 ? { shared_reference_copy: true } : {}),
              },
        ],
        muted: false,
        volume_db: 0,
        user_prompt: segment.prompt,
      },
    };
    start += frames;
    return entry;
  });
  if (!trackData.tracks.some((track) => track.type === "task")) {
    throw new Error("The Story V2 template has no task track.");
  }
  for (const track of trackData.tracks) {
    track.segments = track.type === "task" ? entries : [];
  }
  trackData.total_length = start;
  trackData.frame_rate = FPS;
  return JSON.stringify(trackData);
}

export async function buildStoryV2(options: StoryV2Options): Promise<{ workflow: Record<string, ApiNode>; project: string }> {
  const text = await readFile(path.join(process.cwd(), "comfy", "h3-story-v2-ref2va.json"), "utf8");
  const workflow = JSON.parse(text) as Record<string, ApiNode>;
  const editor = workflow[STORY_V2.editor].inputs;
  editor.track_data = storyV2TrackData(
    String(editor.track_data),
    options.segments,
    options.image,
    options.refImageSize || "match",
  );
  editor["resolution.aspect_ratio"] = options.aspectRatio;

  const fullProject = options.projectBase;
  const devProject = `${options.projectBase}_dev`;
  workflow[STORY_V2.devMode].inputs.value = options.devMode;
  workflow[STORY_V2.megapixels].inputs.value = options.megapixels;
  workflow[STORY_V2.devMegapixels].inputs.value = options.devMegapixels;
  workflow[STORY_V2.steps].inputs.value = options.steps;
  workflow[STORY_V2.devSteps].inputs.value = options.devSteps;
  workflow[STORY_V2.projectName].inputs.value = fullProject;
  workflow[STORY_V2.devProjectName].inputs.value = devProject;

  const project = workflow[STORY_V2.project].inputs;
  project.project_save = "override";
  project.segment_start_number = options.startSegment || 1;
  project.segment_count = -1;
  project.seed = options.seed;

  const active = options.devMode ? devProject : fullProject;
  workflow[STORY_V2.combine].inputs.project_data = JSON.stringify({ project_name: active, clips: [], auto_combine: true });
  return { workflow, project: active };
}

export async function queueStoryV2(options: StoryV2Options): Promise<{ promptId: string; project: string }> {
  const { workflow, project } = await buildStoryV2(options);
  applyLoras(workflow, options.loras);
  const promptId = await queueWorkflow(workflow);
  return { promptId, project };
}

// ---------------------------------------------------------------------------
// H3 Story fast workflows (ComfyUI "Story Speed Tests", converted to API format):
// comfy/h3-story-veda-turbo.json  ref2va w4a8 mixed + Taomate 3-step LoRA + Veda sparse attention, 4 steps
// comfy/h3-story-sage-sla.json    ref2va w4a8 mixed + ref2v turbo 8-step LoRA + Sage + H3 SLA 0.85, 10 steps
// Both: single pass, every segment a `ref` task (ref_image_size max). DEV only changes the
// canvas (editor size preset) and the project folder, both through switches fed by primitives.
// ---------------------------------------------------------------------------

const FAST_TEMPLATES: Record<FastStoryEngine, string> = {
  "veda-turbo": "h3-story-veda-turbo.json",
  "singularity-veda": "h3-story-singularity-veda.json",
  "sage-sla": "h3-story-sage-sla.json",
};

const STORY_FAST = {
  project: "32",
  combine: "29",
  editor: "33",
  steps: "21",
  devMode: "47",
  size: "48",
  devSize: "49",
  projectName: "51",
  devProjectName: "52",
} as const;

export type FastStoryOptions = {
  engine: FastStoryEngine;
  segments: StorySegment[];
  image: ComfyImage;
  devMode: boolean;
  seed: number;
  aspectRatio: string;
  projectBase: string;
  refImageSize?: "match" | "max";
  loras?: LoraChoice[];
};

export async function buildFastStory(
  options: FastStoryOptions,
): Promise<{ workflow: Record<string, ApiNode>; project: string; steps: number; size: Size }> {
  const text = await readFile(path.join(process.cwd(), "comfy", FAST_TEMPLATES[options.engine]), "utf8");
  const workflow = JSON.parse(text) as Record<string, ApiNode>;
  const editor = workflow[STORY_FAST.editor].inputs;
  const template = JSON.parse(String(editor.track_data)) as {
    tracks: { type: string; segments: { content?: { ref_image_size?: string } }[] }[];
  };
  const refImageSize =
    template.tracks.find((track) => track.type === "task")?.segments[0]?.content?.ref_image_size || "max";
  editor.track_data = storyV2TrackData(
    String(editor.track_data),
    options.segments,
    options.image,
    options.refImageSize || refImageSize,
  );

  const full = fastStorySize(options.aspectRatio, false);
  const dev = fastStorySize(options.aspectRatio, true);
  const size = (options.devMode ? dev : full).size;
  if (full.preset && dev.preset) {
    workflow[STORY_FAST.size].inputs.value = full.preset;
    workflow[STORY_FAST.devSize].inputs.value = dev.preset;
  } else {
    // No preset for this aspect ratio: give the editor a custom size directly (the switch only
    // carries preset names).
    editor.resolution = "width x height (custom)";
    editor["resolution.width"] = size.width;
    editor["resolution.height"] = size.height;
    workflow[STORY_FAST.size].inputs.value = "width x height (custom)";
    workflow[STORY_FAST.devSize].inputs.value = "width x height (custom)";
  }

  const fullProject = options.projectBase;
  const devProject = `${options.projectBase}_dev`;
  workflow[STORY_FAST.devMode].inputs.value = options.devMode;
  workflow[STORY_FAST.projectName].inputs.value = fullProject;
  workflow[STORY_FAST.devProjectName].inputs.value = devProject;

  const project = workflow[STORY_FAST.project].inputs;
  project.project_save = "override";
  project.segment_start_number = 1;
  project.segment_count = -1;
  project.seed = options.seed;

  const activeProject = options.devMode ? devProject : fullProject;
  workflow[STORY_FAST.combine].inputs.project_data = JSON.stringify({
    project_name: activeProject,
    clips: [],
    auto_combine: true,
  });
  const steps = Number(workflow[STORY_FAST.steps]?.inputs.steps) || 0;
  return { workflow, project: activeProject, steps, size };
}

export async function queueFastStory(
  options: FastStoryOptions,
): Promise<{ promptId: string; project: string; steps: number; size: Size }> {
  const { workflow, project, steps, size } = await buildFastStory(options);
  applyLoras(workflow, options.loras);
  const promptId = await queueWorkflow(workflow);
  return { promptId, project, steps, size };
}

export type LongTakeStatus = {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  queuePosition: number;
  segmentsDone: number;
  video: ComfyImage | null;
  error: string;
};

export async function longTakeStatus(
  promptId: string,
  project: string,
  segmentCount: number,
  startedAt: number,
): Promise<LongTakeStatus> {
  const entry = await historyEntry(promptId);
  if (entry?.status?.status_str === "error") {
    if (wasInterrupted(entry)) {
      return { status: "cancelled", queuePosition: 0, segmentsDone: 0, video: null, error: "" };
    }
    return { status: "error", queuePosition: 0, segmentsDone: 0, video: null, error: executionError(entry) };
  }
  if (entry?.status?.completed) {
    // Long take / Story V2 save from node 25, the fast story workflows from node 35.
    const video =
      entry.outputs?.[LONG_TAKE.save]?.images?.[0] ||
      Object.values(entry.outputs || {})
        .flatMap((output) => output.images || [])
        .find((file) => /\.(mp4|webm|mov|mkv)$/i.test(file.filename)) ||
      null;
    return {
      status: video ? "done" : "error",
      queuePosition: 0,
      segmentsDone: segmentCount,
      video,
      error: video ? "" : "ComfyUI finished but saved no video.",
    };
  }

  const queue = (await comfyJson(`${COMFYUI_URL}/queue`)) as {
    queue_running?: [number, string][];
    queue_pending?: [number, string][];
  };
  const running = (queue.queue_running || []).some((item) => item[1] === promptId);
  const pendingIndex = (queue.queue_pending || [])
    .slice()
    .sort((a, b) => a[0] - b[0])
    .findIndex((item) => item[1] === promptId);
  if (!running && pendingIndex === -1) {
    return {
      status: "error",
      queuePosition: 0,
      segmentsDone: 0,
      video: null,
      error: "The job is no longer in ComfyUI's queue (cancelled or ComfyUI restarted).",
    };
  }
  if (!running) {
    return { status: "queued", queuePosition: pendingIndex + 1, segmentsDone: 0, video: null, error: "" };
  }

  // Segment files appear in the project folder one by one while the job runs.
  let segmentsDone = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const response = await fetch(
      comfyViewUrl({ filename: `video_${index}_1.mp4`, subfolder: `easy_media/projects/${project}`, type: "output" }),
      { method: "HEAD" },
    ).catch(() => null);
    const modified = Date.parse(response?.headers.get("Last-Modified") || "");
    if (!response?.ok || !(modified >= startedAt - 2000)) break;
    segmentsDone += 1;
  }
  return { status: "running", queuePosition: 0, segmentsDone, video: null, error: "" };
}

export function comfyViewUrl(image: ComfyImage): string {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
  });
  return `${COMFYUI_URL}/view?${query}`;
}
