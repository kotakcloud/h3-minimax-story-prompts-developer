import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fastStorySize, isFastEngine } from "./engines";
import type { Story } from "./types";

// A filled-in copy of the comfyui-obvpm-timeline workflow, to try a story segment by segment in ComfyUI. The template is read
// from the installed pack, so it always matches the pack. The workflow has one prompt box: segment 1 starts in it, and every
// segment is on a Note beside it.
const TEMPLATE = "h3_obvpm_timeline_r2v_v0.1.4-007A.json";

// Node ids in that template.
const NODE = {
  input: 761, // prompt, aspect ratio, megapixels, project
  seed: 765,
  picture: 1280,
  model: 725,
  clipVae: 752,
  upscaleVae: 1526,
  loras: 708,
  generation: 1290,
  upscale: 1335,
  modelOverride: 1531,
  timeline: 1221,
  compatibility: 1520,
} as const;
// Positions in the Timeline's saved widget values.
const TIMELINE_AUTO_ADD = 5;
const TIMELINE_DURATION = 17;

type UiNode = { id: number; type: string; widgets_values?: unknown[]; [key: string]: unknown };
type UiWorkflow = { id: string; nodes: UiNode[]; last_node_id: number; [key: string]: unknown };
type ApiGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

function templatePath(): string {
  const output = process.env.COMFYUI_OUTPUT_DIR;
  if (!output) throw new Error("Set COMFYUI_OUTPUT_DIR in .env.local: the export reads the timeline workflow from ComfyUI's folder.");
  return path.join(output, "..", "custom_nodes", "comfyui-obvpm-timeline", "workflows", TEMPLATE);
}

// The model settings of the story's own fast workflow.
async function engineSettings(engine: string) {
  const text = await readFile(path.join(process.cwd(), "comfy", `h3-story-${engine}.json`), "utf8");
  const graph = JSON.parse(text) as ApiGraph;
  const find = (type: string) => Object.values(graph).filter((node) => node.class_type === type);
  const [video, audio] = find("VAELoader").map((node) => String(node.inputs.vae_name));
  const shift = find("MiniMaxH3SigmaShift")[0]?.inputs;
  const lora = find("LoraLoaderModelOnly")[0]?.inputs;
  return {
    clip: String(find("CLIPLoader")[0]?.inputs.clip_name),
    video,
    audio,
    values: {
      model: String(find("UNETLoader")[0]?.inputs.unet_name),
      attention: "pytorch",
      // The nearest the timeline's presets get to Veda sparse attention.
      sparse_attention: "vsa",
      spectrum: false,
      turbo_loader: "normal",
      turbo_lora: String(lora?.lora_name),
      turbo_strength: Number(lora?.strength_model) || 1,
      steps: Number(graph["21"]?.inputs.steps) || 4,
      sampler: String(graph["20"]?.inputs.sampler_name || "euler"),
      scheduler: String(graph["21"]?.inputs.scheduler || "beta"),
      shift_video: Number(shift?.shift_video) || 12,
      shift_audio: Number(shift?.shift_audio) || 3,
    },
  };
}

function noteNode(id: number, order: number, title: string, text: string, y: number): UiNode {
  return {
    id,
    type: "Note",
    title,
    pos: [-1760, y],
    size: [480, 400],
    flags: {},
    order,
    mode: 0,
    inputs: [],
    outputs: [],
    properties: {},
    widgets_values: [text],
    color: "#432",
    bgcolor: "#653",
  };
}

export async function buildTimelineWorkflow(story: Story): Promise<UiWorkflow> {
  const settings = story.videoSettings;
  if (!isFastEngine(settings.engine)) {
    throw new Error("The timeline export needs a Veda Turbo, Singularity Veda or Sage SLA workflow. Pick one on the Video tab.");
  }
  const image = story.referenceImages.find((item) => item.id === story.selectedImageId);
  if (!image) throw new Error("Select a reference image on the Image step first.");
  if (story.segments.length === 0) throw new Error("Write the prompts first.");

  const text = await readFile(templatePath(), "utf8").catch(() => {
    throw new Error("comfyui-obvpm-timeline's workflow was not found in ComfyUI's custom_nodes folder.");
  });
  const workflow = JSON.parse(text) as UiWorkflow;
  // The ComfyUI frontend reopens a saved tab with the same id instead of this file.
  workflow.id = randomUUID();
  const node = (id: number) => {
    const found = workflow.nodes.find((item) => item.id === id);
    if (!found?.widgets_values) throw new Error(`The timeline workflow changed: node ${id} is gone. Update the export.`);
    return found as UiNode & { widgets_values: unknown[] };
  };

  const engine = await engineSettings(settings.engine);
  const first = story.segments[0];
  const longest = Math.max(...story.segments.map((segment) => segment.duration));
  const aspectRatio = image.grid?.panelAspectRatio ?? image.aspectRatio;
  const ultra = settings.ultraFast && settings.devMode;
  const { width, height } = fastStorySize(aspectRatio, settings.devMode, ultra, longest).size;
  const project = story.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "h3_story";

  node(NODE.input).widgets_values = [first.prompt, aspectRatio, Math.max(0.1, Math.round((width * height) / 100_000) / 10), project];
  node(NODE.seed).widgets_values[0] = settings.seed;
  const subfolder = image.subfolder.split(/[\\/]+/).filter(Boolean).join("/");
  node(NODE.picture).widgets_values[0] = JSON.stringify([{ image: `${subfolder}/${image.filename} [${image.type}]` }]);
  node(NODE.model).widgets_values[0] = engine.values.model;
  node(NODE.clipVae).widgets_values = [engine.clip, engine.video, engine.audio];
  node(NODE.upscaleVae).widgets_values = [engine.video, engine.audio];
  node(NODE.timeline).widgets_values[TIMELINE_DURATION] = first.duration;
  // Each finished take lands on the Timeline, ready to extend.
  node(NODE.timeline).widgets_values[TIMELINE_AUTO_ADD] = true;

  // The check stops every run when a listed pack is missing, and the latent upscaler is optional: only the upscale step,
  // which is off, uses it.
  const compatibility = node(NODE.compatibility).widgets_values;
  compatibility[0] = String(compatibility[0])
    .split("\n")
    .filter((line) => !/MinimaxH3LatentUpscaler3D/.test(line))
    .join("\n");

  // 'custom' runs the values held in the file; a preset name is only a label on them.
  const generation = node(NODE.generation).widgets_values;
  generation[1] = "custom";
  generation[2] = JSON.stringify(engine.values);
  const upscale = node(NODE.upscale).widgets_values;
  upscale[2] = JSON.stringify({ ...(JSON.parse(String(upscale[2])) as object), model: engine.values.model });
  const override = JSON.parse(String(node(NODE.modelOverride).widgets_values[0])) as { values: Record<string, unknown> };
  override.values.model = engine.values.model;
  node(NODE.modelOverride).widgets_values[0] = JSON.stringify(override);

  const loras = (settings.loras || [])
    .filter((lora) => lora.enabled)
    .map((lora) => ({ on: true, lora: lora.name, strength: lora.strength, strengthTwo: null }));
  const [start, header, ...rest] = node(NODE.loras).widgets_values;
  node(NODE.loras).widgets_values = [start, header, ...loras, ...rest];

  let id = workflow.last_node_id;
  let y = 3160;
  const notes = [
    noteNode(
      ++id,
      workflow.nodes.length,
      "How to use",
      [
        `${story.title}: ${story.segments.length} segments.`,
        "",
        "1. Segment 1 is already in the prompt box, with its length on the Timeline. Queue it. The take lands on the Timeline.",
        "2. Next segment: click the last clip on the Timeline and press extend clip. Paste the segment's prompt from the notes below over the old one, set the Timeline's duration_seconds to the seconds in the note's title, and queue.",
        "3. Not happy with a take? Remove it from the Timeline, change the seed, extend from the same clip again and queue.",
        "",
        "Lengths and settings come from the app. Veda sparse attention is not available here: this runs with vsa, so results and speed differ from the app.",
      ].join("\n"),
      y,
    ),
  ];
  story.segments.forEach((segment, index) => {
    y += 440;
    const title = story.frames.find((frame) => frame.id === segment.id)?.title || segment.id;
    notes.push(noteNode(++id, workflow.nodes.length + index + 1, `Segment ${index + 1} · ${segment.duration}s · ${title}`, segment.prompt, y));
  });
  workflow.nodes.push(...notes);
  workflow.last_node_id = id;
  return workflow;
}
