import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { comfyViewUrl, localOutputFile, queueApiWorkflow, uploadInputFile, type ApiNode, type ComfyImage } from "./comfyui";
import { probe } from "./compare";

// A generated bridge between two takes (usually the end of one story and the start of the next). ComfyUI renders a
// short H3 clip with the first/last-frame model: the last second of the first take (picture and sound) is pinned at
// its start and the first second of the second take at its end, and H3 fills the gap. Joined as
// first take → bridge without its pinned parts → second take, both seams are H3's own motion, not a cut.
// Without a second take, the bridge ends on a picture (the next story's segment 1 picture) instead.

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FPS = 24;
// Pinned clip length: H3 anchors clips of 5, 22, 39 … frames; 22 frames is just under a second.
export const PIN_FRAMES = 22;

const MODEL = process.env.H3_FL2VA_MODEL || "minimax-h3\\minimax_h3_fl2va_pruned_w4a8_mixed.safetensors";
const TURBO_LORA = process.env.H3_FL2V_TURBO_LORA || "minimax-h3\\minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors";
const CLIP = "qwen\\qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors";
const VIDEO_VAE = "minimax-h3\\minimax_h3_video_vae_fp16.safetensors";
const AUDIO_VAE = "minimax-h3\\minimax_h3_audio_vae_fp32.safetensors";

// H3's frame grid: 17k + 5 frames.
function alignFrames(count: number): number {
  let frames = Math.max(5, Math.round(count));
  while (frames % 17 !== 5) frames += 1;
  return frames;
}

// The bridge canvas: the first take's shape at its own size, rounded to 32 and kept within H3's 768×1344 area.
function canvasFor(width: number, height: number): { width: number; height: number } {
  const maxArea = 768 * 1344;
  const scale = Math.min(1, Math.sqrt(maxArea / Math.max(1, width * height)));
  const round = (value: number) => Math.max(256, Math.round((value * scale) / 32) * 32);
  return { width: round(width), height: round(height) };
}

async function fetchVideo(video: ComfyImage, target: string) {
  const local = await localOutputFile(video);
  if (local) {
    await copyFile(local, target);
    return;
  }
  const response = await fetch(comfyViewUrl(video));
  if (!response.ok) throw new Error(`ComfyUI could not return the video (${response.status}).`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function fetchImage(image: ComfyImage, target: string) {
  const local = await localOutputFile(image);
  if (local) {
    await copyFile(local, target);
    return;
  }
  const response = await fetch(comfyViewUrl(image));
  if (!response.ok) throw new Error(`ComfyUI could not return the picture (${response.status}).`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

export type BridgePlan = {
  promptId: string;
  width: number;
  height: number;
  // Frames of the rendered bridge, and how many of them at each end are the pinned takes (cut off when joined).
  frames: number;
  pinnedHead: number;
  pinnedTail: number;
};

export async function queueBridge(options: {
  id: string;
  from: ComfyImage;
  to: { video: ComfyImage } | { image: ComfyImage };
  prompt: string;
  // New frames between the pinned parts, in seconds.
  seconds: number;
  steps: number;
  seed: number;
  // How the end is held: the second take's first second as a clip (picture and sound), or only its first frame
  // (H3 then has room to move the camera into it instead of cutting).
  endPin?: "clip" | "frame";
}): Promise<BridgePlan> {
  const work = await mkdtemp(path.join(os.tmpdir(), "h3-bridge-"));
  try {
    await fetchVideo(options.from, path.join(work, "from.mp4"));
    const from = await probe(path.join(work, "from.mp4"));
    if (from.duration * FPS < PIN_FRAMES + 2) throw new Error("The first take is too short to continue from.");
    const { width, height } = canvasFor(from.width, from.height);
    const tag = options.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);

    // The first take's last 22 frames with their sound (the bridge starts as this).
    const startAt = Math.max(0, from.duration - PIN_FRAMES / FPS);
    await run(
      FFMPEG,
      ["-y", "-v", "error", "-ss", startAt.toFixed(4), "-i", "from.mp4", "-frames:v", String(PIN_FRAMES), "-r", String(FPS),
        "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "head.mp4"],
      { cwd: work },
    );
    const headName = await uploadInputFile(new Blob([new Uint8Array(await readFile(path.join(work, "head.mp4")))]), `h3bridge_${tag}_from.mp4`);

    let tailName = "";
    let endImage = "";
    if ("video" in options.to && options.endPin === "frame") {
      await fetchVideo(options.to.video, path.join(work, "to.mp4"));
      await run(FFMPEG, ["-y", "-v", "error", "-i", "to.mp4", "-frames:v", "1", "to.png"], { cwd: work });
      endImage = await uploadInputFile(new Blob([new Uint8Array(await readFile(path.join(work, "to.png")))]), `h3bridge_${tag}_to.png`);
    } else if ("video" in options.to) {
      await fetchVideo(options.to.video, path.join(work, "to.mp4"));
      // The second take's first 22 frames with their sound (the bridge ends as this).
      await run(
        FFMPEG,
        ["-y", "-v", "error", "-i", "to.mp4", "-frames:v", String(PIN_FRAMES), "-r", String(FPS),
          "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
          "-t", (PIN_FRAMES / FPS).toFixed(4), "tail.mp4"],
        { cwd: work },
      );
      tailName = await uploadInputFile(new Blob([new Uint8Array(await readFile(path.join(work, "tail.mp4")))]), `h3bridge_${tag}_to.mp4`);
    } else {
      await fetchImage(options.to.image, path.join(work, "to.png"));
      endImage = await uploadInputFile(new Blob([new Uint8Array(await readFile(path.join(work, "to.png")))]), `h3bridge_${tag}_to.png`);
    }

    const pinnedTail = tailName ? PIN_FRAMES : 1;
    const frames = alignFrames(PIN_FRAMES + Math.round(Math.max(1, options.seconds) * FPS) + pinnedTail);
    const workflow: Record<string, ApiNode> = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: MODEL, weight_dtype: "default" } },
      "2": { class_type: "MiniMaxH3TurboLoRA", inputs: { model: ["1", 0], lora_name: TURBO_LORA, strength: 0.85, low_vram: false } },
      "3": { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["2", 0], shift_video: 12, shift_audio: 3 } },
      "4": { class_type: "PathchSageAttentionKJ", inputs: { model: ["3", 0], sage_attention: "auto", allow_compile: false } },
      "5": { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "minimax", device: "default" } },
      "6": { class_type: "VAELoader", inputs: { vae_name: VIDEO_VAE } },
      "7": { class_type: "VAELoader", inputs: { vae_name: AUDIO_VAE } },
      "8": { class_type: "LoadVideo", inputs: { file: headName } },
      "9": { class_type: "GetVideoComponents", inputs: { video: ["8", 0] } },
      "10": {
        class_type: "MiniMaxH3ImageToVideo",
        inputs: {
          clip: ["5", 0],
          vae: ["6", 0],
          prompt: options.prompt,
          width,
          height,
          length: frames,
          ...(endImage ? { last_frame: ["21", 0] } : {}),
        },
      },
      // The first take's last second (picture and sound) at the start.
      "11": {
        class_type: "MiniMaxH3AddGuide",
        inputs: { positive: ["10", 0], vae: ["6", 0], audio_vae: ["7", 0], latent: ["10", 1], image: ["9", 0], audio: ["9", 1], frame_idx: 0 },
      },
      "13": { class_type: "RandomNoise", inputs: { noise_seed: Math.max(0, Math.floor(options.seed)) } },
      "14": { class_type: "KSamplerSelect", inputs: { sampler_name: "euler" } },
      "15": { class_type: "BasicScheduler", inputs: { model: ["4", 0], scheduler: "simple", steps: options.steps, denoise: 1 } },
      "16": { class_type: "BasicGuider", inputs: { model: ["4", 0], conditioning: [tailName ? "12" : "11", 0] } },
      "17": {
        class_type: "SamplerCustomAdvanced",
        inputs: { noise: ["13", 0], guider: ["16", 0], sampler: ["14", 0], sigmas: ["15", 0], latent_image: ["10", 1] },
      },
      "18": { class_type: "VAEDecode", inputs: { samples: ["17", 0], vae: ["6", 0] } },
      "19": { class_type: "VAEDecodeAudio", inputs: { samples: ["17", 0], vae: ["7", 0] } },
      "20": {
        class_type: "VHS_VideoCombine",
        inputs: {
          images: ["18", 0],
          audio: ["19", 0],
          frame_rate: FPS,
          loop_count: 0,
          filename_prefix: `h3-bridge/${tag}`,
          format: "video/h264-mp4",
          pix_fmt: "yuv420p",
          crf: 16,
          save_metadata: true,
          trim_to_audio: false,
          pingpong: false,
          save_output: true,
        },
      },
    };
    if (tailName) {
      workflow["22"] = { class_type: "LoadVideo", inputs: { file: tailName } };
      workflow["23"] = { class_type: "GetVideoComponents", inputs: { video: ["22", 0] } };
      // The second take's first second (picture and sound) at the end.
      workflow["12"] = {
        class_type: "MiniMaxH3AddGuide",
        inputs: {
          positive: ["11", 0], vae: ["6", 0], audio_vae: ["7", 0], latent: ["10", 1], image: ["23", 0], audio: ["23", 1],
          frame_idx: -PIN_FRAMES,
        },
      };
    } else {
      workflow["21"] = { class_type: "LoadImage", inputs: { image: endImage } };
    }
    const promptId = await queueApiWorkflow(workflow);
    // Ending on the second take's first frame: that frame is cut off too, as the take itself starts with it.
    return { promptId, width, height, frames, pinnedHead: PIN_FRAMES, pinnedTail: tailName ? PIN_FRAMES : "video" in options.to ? 1 : 0 };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
