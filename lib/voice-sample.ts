import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { comfyViewUrl, localOutputFile, uploadInputFile, type ComfyImage } from "./comfyui";
import { VOICE_SAMPLE_MAX_SECONDS, VOICE_SAMPLE_MIN_SECONDS, type VoiceSample } from "./voice-references";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const FADE_SECONDS = 0.1;

async function makeSample(
  storyId: string,
  speaker: string,
  input: string,
  start: number,
  seconds: number,
  work: string,
): Promise<VoiceSample> {
  const output = path.join(work, "sample.wav");
  const length = Math.min(VOICE_SAMPLE_MAX_SECONDS, Math.max(VOICE_SAMPLE_MIN_SECONDS, seconds));
  await run(FFMPEG, [
    "-v", "error", "-y", "-ss", String(Math.max(0, start)), "-t", String(length), "-i", input,
    "-vn", "-ac", "1", "-ar", "44100", "-af", `afade=t=out:st=${length - FADE_SECONDS}:d=${FADE_SECONDS}`, output,
  ]);
  const probe = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", output]);
  const measured = Number(probe.stdout.trim());
  if (!(measured >= VOICE_SAMPLE_MIN_SECONDS - FADE_SECONDS)) {
    throw new Error("The sample came out empty: pick a spot that has speech.");
  }
  // A new name each time: Easy-Media caches media by path.
  const filename = `${speaker}-${Date.now()}.wav`;
  const stored = await uploadInputFile(new Blob([await readFile(output)]), `h3-voices/${storyId}`, filename);
  return { speaker, filename: stored.filename, subfolder: stored.subfolder, seconds: Math.round(measured * 10) / 10 };
}

async function withWorkFolder<T>(work: (folder: string) => Promise<T>): Promise<T> {
  const folder = await mkdtemp(path.join(os.tmpdir(), "h3-voice-"));
  try {
    return await work(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export function sampleFromUpload(storyId: string, speaker: string, audio: Blob, seconds: number): Promise<VoiceSample> {
  return withWorkFolder(async (folder) => {
    const input = path.join(folder, "upload");
    await writeFile(input, Buffer.from(await audio.arrayBuffer()));
    return makeSample(storyId, speaker, input, 0, seconds, folder);
  });
}

export function sampleFromVideo(
  storyId: string,
  speaker: string,
  video: ComfyImage,
  start: number,
  seconds: number,
): Promise<VoiceSample> {
  return withWorkFolder(async (folder) => {
    let input = await localOutputFile(video);
    if (!input) {
      const response = await fetch(comfyViewUrl(video));
      if (!response.ok) throw new Error("Could not read the video from ComfyUI.");
      input = path.join(folder, "video.mp4");
      await writeFile(input, Buffer.from(await response.arrayBuffer()));
    }
    return makeSample(storyId, speaker, input, start, seconds, folder);
  });
}
