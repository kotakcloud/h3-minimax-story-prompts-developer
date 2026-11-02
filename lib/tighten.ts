import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { comfyViewUrl, localOutputFile } from "./comfyui";
import { comparisonDir, comparisonFile, type CompareTile } from "./compare";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

// H3 pads speech with silence: set 7 of one story was 53 s of speech in a 171 s video. Cutting it after the render needs no
// GPU. Thresholds from that video: -30 dB lost quiet sound at the edges, -34 dB lost none. The level is read in the speech
// band so low music counts less.
const SAMPLE_RATE = 16000;
const WINDOW_SECONDS = 0.05;
const SPEECH_DB = -34;
const KEEP_BEFORE_SECONDS = 0.25;
const KEEP_AFTER_SECONDS = 0.35;
const LONGEST_PAUSE_SECONDS = 0.7;

export function tightenedId(runId: string): string {
  return `tight-${runId}`;
}

function audioLevels(samples: Buffer): number[] {
  const size = Math.round(SAMPLE_RATE * WINDOW_SECONDS);
  const count = Math.floor(samples.length / 2);
  const levels: number[] = [];
  for (let start = 0; start < count; start += size) {
    const end = Math.min(count, start + size);
    let sum = 0;
    for (let index = start; index < end; index++) sum += samples.readInt16LE(index * 2) ** 2;
    levels.push(20 * Math.log10(Math.sqrt(sum / (end - start)) / 32768 + 1e-9));
  }
  return levels;
}

// The parts to keep, in whole frames, so picture and sound lose the same time at every cut.
export function rangesToKeep(levels: number[], seconds: number, fps: number): { first: number; last: number }[] {
  const keep: [number, number][] = [];
  let start = -1;
  [...levels, -99].forEach((level, index) => {
    if (level > SPEECH_DB && start < 0) start = index;
    if (level <= SPEECH_DB && start >= 0) {
      const from = Math.max(0, start * WINDOW_SECONDS - KEEP_BEFORE_SECONDS);
      const to = Math.min(seconds, index * WINDOW_SECONDS + KEEP_AFTER_SECONDS);
      const last = keep[keep.length - 1];
      if (last && from - last[1] <= LONGEST_PAUSE_SECONDS) last[1] = to;
      else keep.push([from, to]);
      start = -1;
    }
  });
  return keep.map(([from, to]) => ({ first: Math.floor(from * fps), last: Math.ceil(to * fps) }));
}

// A copy of a finished video without its dead air. The original stays untouched.
export async function tightenVideo(storyId: string, runId: string, video: CompareTile["video"]) {
  const work = await mkdtemp(path.join(os.tmpdir(), "h3-tighten-"));
  try {
    let input = await localOutputFile(video);
    if (!input) {
      const response = await fetch(comfyViewUrl(video));
      if (!response.ok) throw new Error(`ComfyUI could not return the video (${response.status}).`);
      input = path.join(work, "input.mp4");
      await writeFile(input, Buffer.from(await response.arrayBuffer()));
    }
    const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,r_frame_rate:format=duration", "-of", "json", input]);
    const info = JSON.parse(stdout) as { streams?: { codec_type?: string; r_frame_rate?: string }[]; format?: { duration?: string } };
    const [top, bottom] = (info.streams?.find((stream) => stream.codec_type === "video")?.r_frame_rate || "24/1").split("/").map(Number);
    const fps = top / (bottom || 1);
    const seconds = Number(info.format?.duration) || 0;
    if (!info.streams?.some((stream) => stream.codec_type === "audio")) throw new Error("This video has no sound to work from.");

    const pcm = path.join(work, "audio.pcm");
    await run(FFMPEG, ["-v", "error", "-y", "-i", input, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE), "-af", "highpass=f=250,lowpass=f=3500", "-f", "s16le", pcm]);
    const ranges = rangesToKeep(audioLevels(await readFile(pcm)), seconds, fps);
    if (ranges.length === 0) throw new Error("No speech found in this video.");

    // Each part is cut as a matched pair of picture and sound: selecting frames and samples separately drifted 0.5 s.
    const parts = ranges.map(
      ({ first, last }, index) =>
        `[0:v]trim=start_frame=${first}:end_frame=${last},setpts=PTS-STARTPTS[v${index}];` +
        `[0:a]atrim=start=${(first / fps).toFixed(6)}:end=${(last / fps).toFixed(6)},asetpts=PTS-STARTPTS[a${index}];`,
    );
    const pairs = ranges.map((_range, index) => `[v${index}][a${index}]`).join("");
    const script = path.join(work, "filter.txt");
    await writeFile(script, `${parts.join("")}${pairs}concat=n=${ranges.length}:v=1:a=1[v][a]`);

    await mkdir(comparisonDir(storyId), { recursive: true });
    const output = comparisonFile(storyId, tightenedId(runId));
    await run(
      FFMPEG,
      ["-v", "error", "-y", "-i", input, "-filter_complex_script", script, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    await stat(output);
    const duration = ranges.reduce((sum, { first, last }) => sum + (last - first) / fps, 0);
    return { duration: Math.round(duration * 10) / 10, originalDuration: Math.round(seconds * 10) / 10, cuts: ranges.length - 1 };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
